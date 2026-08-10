import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4176";
const CDP_PORT = 9225;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const QA_DIR = "qa-screenshots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopProcess(child, timeoutMs = 1800) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish();
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { finish(); }
  });
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH or install a browser.");
}

async function waitFor(url, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(125);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Chrome DevTools WebSocket failed.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener);
    this.listeners.set(method, list);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
  }

  close() { this.ws?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function navigate(client, url, settleMs = 500) {
  const loaded = new Promise((resolve) => {
    const off = client.on("Page.loadEventFired", () => { off(); resolve(); });
    setTimeout(() => { off(); resolve(); }, 6000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(settleMs);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-offline-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4176"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;

  try {
    await waitFor(`${HOST}/`);
    browser = spawn(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    await waitFor(`${CDP_HOST}/json/version`);
    const targetResponse = await fetch(`${CDP_HOST}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Could not create browser target: ${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable"), client.call("Network.enable")]);
    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

    await navigate(client, `${HOST}/directory`, 800);
    const primed = await evaluate(client, `(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker ready timeout")), 7000))
      ]);
      for (let attempt = 0; attempt < 80 && !navigator.serviceWorker.controller; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const input = document.querySelector("[data-directory-query]");
      input?.focus();
      await fetch("/data/search-index.json", { credentials: "same-origin" });
      const keys = await caches.keys();
      return { supported: true, active: Boolean(ready.active), controlled: Boolean(navigator.serviceWorker.controller), cache: keys.some((key) => key.startsWith("rwn-offline-")) };
    })()`);
    if (!primed.supported || !primed.active || !primed.controlled || !primed.cache) {
      throw new Error(`Offline directory did not prime correctly: ${JSON.stringify(primed)}`);
    }

    await client.call("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none"
    });

    await navigate(client, `${HOST}/directory/help/food`, 700);
    const offline = await evaluate(client, `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const input = document.querySelector("[data-directory-query]");
      const list = document.querySelector("[data-global-list]");
      const count = document.querySelector("[data-directory-count]");
      if (!input || !list || !count) return { ok: false, reason: "cached directory controls missing" };
      input.value = "food";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      for (let attempt = 0; attempt < 100 && list.children.length === 0; attempt += 1) await sleep(30);
      let apiCached = true;
      try { await fetch("/api/rum", { cache: "no-store" }); } catch { apiCached = false; }
      return {
        ok: true,
        controlled: Boolean(navigator.serviceWorker.controller),
        results: list.children.length,
        status: count.textContent || "",
        apiCached,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    await capture(client, "directory-offline.png");
    if (!offline.ok || !offline.controlled || offline.results < 1 || !/matching listings/i.test(offline.status) || offline.apiCached || offline.overflow > 8) {
      throw new Error(`Offline directory/search failed: ${JSON.stringify(offline)}`);
    }

    console.log(`RWN offline browser QA passed: service worker controls the directory, cached navigation survives a fully offline network, catalog search still returns ${offline.results} result(s), API requests are not cached, and mobile overflow remains bounded.`);
  } finally {
    try {
      await client?.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    } catch {}
    client?.close();
    await stopProcess(browser);
    await stopProcess(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 125 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
