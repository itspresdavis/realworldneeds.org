import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4177";
const CDP_PORT = 9226;
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

async function navigate(client, url) {
  const loaded = new Promise((resolve) => {
    const off = client.on("Page.loadEventFired", () => { off(); resolve(); });
    setTimeout(() => { off(); resolve(); }, 6000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(550);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-handoff-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4177"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;

  try {
    await waitFor(`${HOST}/`);
    const payload = await (await fetch(`${HOST}/data/resources.json`)).json();
    const resource = payload.resources.find((item) => item.kind === "direct" && item.phone) || payload.resources[0];
    if (!resource) throw new Error("No service exists for handoff QA.");

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
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")]);
    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

    await navigate(client, `${HOST}/service/${encodeURIComponent(resource.id)}`);
    const result = await evaluate(client, `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const utility = document.querySelector("[data-service-utility]");
      const buttons = [...(utility?.querySelectorAll("button") || [])];
      if (!utility || buttons.length !== 3) return { ok: false, reason: "handoff controls missing", buttonCount: buttons.length };

      let copied = "";
      let shared = null;
      let printed = false;
      try {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { copied = text; } } });
      } catch {}
      try {
        Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { shared = data; } });
      } catch {}
      window.print = () => { printed = true; };

      const before = location.href;
      utility.querySelector("[data-service-copy]")?.click();
      await sleep(40);
      utility.querySelector("[data-service-share]")?.click();
      await sleep(40);
      utility.querySelector("[data-service-print]")?.click();
      await sleep(20);
      utility.scrollIntoView({ block: "center", behavior: "auto" });
      await sleep(80);

      const status = utility.querySelector("[data-service-action-status]")?.textContent || "";
      const minHeight = Math.min(...buttons.map((button) => button.getBoundingClientRect().height));
      const utilityRect = utility.getBoundingClientRect();
      return {
        ok: true,
        minHeight,
        copied,
        shared,
        printed,
        navigated: location.href !== before,
        status,
        utilityVisible: utilityRect.top < innerHeight && utilityRect.bottom > 0,
        buttonsVisible: buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.top < innerHeight && rect.bottom > 0;
        }),
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        privacyCopy: utility.textContent.includes("RWN does not receive who you share with")
      };
    })()`);

    await capture(client, "service-handoff-mobile.png");
    const copiedOk = result.copied.includes(resource.name)
      && result.copied.includes("RWN listing:")
      && result.copied.includes("Official source:")
      && result.copied.includes("Confirm current details before you go.");
    const sharedOk = result.shared?.url?.includes(`/service/${encodeURIComponent(resource.id)}`)
      && result.shared?.title?.includes(resource.name);

    if (!result.ok || result.minHeight < 44 || !copiedOk || !sharedOk || !result.printed || result.navigated || !result.utilityVisible || !result.buttonsVisible || result.overflow > 8 || !result.privacyCopy) {
      throw new Error(`Service handoff QA failed: ${JSON.stringify({ ...result, copiedOk, sharedOk })}`);
    }

    await navigate(client, `${HOST}/sources`);
    const sources = await evaluate(client, `(() => {
      const h1 = document.querySelector("main h1")?.textContent?.trim() || "";
      const cards = [...document.querySelectorAll(".source-ledger-card")];
      const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
      const text = document.querySelector("main")?.textContent || "";
      const links = [...document.querySelectorAll("main a")].map((link) => new URL(link.href).pathname);
      return {
        h1,
        cardCount: cards.length,
        canonical,
        hasNoEndorsementCopy: /does not imply sponsorship, endorsement, or a partnership/i.test(text),
        hasMachineRegistry: links.includes("/data/sources.json"),
        hasResourceExport: links.includes("/data/resources.json"),
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    await capture(client, "sources-mobile.png");
    if (!/where RWN/i.test(sources.h1) || sources.cardCount < 4 || !sources.canonical.endsWith("/sources") || !sources.hasNoEndorsementCopy || !sources.hasMachineRegistry || !sources.hasResourceExport || sources.overflow > 8) {
      throw new Error(`Rendered source-ledger QA failed: ${JSON.stringify(sources)}`);
    }

    console.log(`RWN handoff/trust QA passed for ${resource.id}: private share payload, copied public details, print path, visible 44px handoff controls, no navigation, privacy copy, source-ledger provenance rendering, and mobile screenshots.`);
  } finally {
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
