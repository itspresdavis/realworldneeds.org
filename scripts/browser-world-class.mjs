import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4174";
const CDP_PORT = 9223;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const QA_DIR = "qa-screenshots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    setTimeout(() => { off(); resolve(); }, 8000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(650);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function verifyStaticEnhancements() {
  const resources = await (await fetch(`${HOST}/data/resources.json`)).json();
  const accessible = resources.resources.find((resource) => resource.accessibilityNote);
  if (!accessible) throw new Error("No source-backed accessibility note exists to verify.");
  const service = await fetch(`${HOST}/service/${encodeURIComponent(accessible.id)}`);
  const html = await service.text();
  if (!html.includes("service-accessibility") || !html.includes("related-services")) {
    throw new Error("Enhanced service page is missing accessibility or related-service markup.");
  }

  const localIndex = await (await fetch(`${HOST}/data/resources/local-index.json`)).json();
  const usLocal = localIndex.cities.find((entry) => entry.country === "United States");
  if (!usLocal) throw new Error("No United States local page exists to verify crawl graph.");
  const countryHtml = await (await fetch(`${HOST}/directory/united-states`)).text();
  if (!countryHtml.includes("directory-local-links") || !countryHtml.includes(usLocal.path)) {
    throw new Error("Country page does not expose crawlable local-directory links.");
  }

  const localNeed = usLocal.categories?.[0];
  if (localNeed) {
    const cityHtml = await (await fetch(`${HOST}${usLocal.path}`)).text();
    const needHtml = await (await fetch(`${HOST}${localNeed.path}`)).text();
    if (!cityHtml.includes(localNeed.path) || !needHtml.includes('"@type":"CollectionPage"') || !needHtml.includes("Visit original source")) {
      throw new Error("Local need page is not fully connected to the crawl graph.");
    }
  }
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-world-class-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4174"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;
  const exceptions = [];

  try {
    await waitFor(`${HOST}/`);
    await verifyStaticEnhancements();

    browser = spawn(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
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
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown browser exception"));

    await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
    await navigate(client, `${HOST}/`);
    const homepage = await evaluate(client, `(() => {
      const panel = document.getElementById("resourcePanel");
      return {
        worldClass: document.documentElement.classList.contains("rwn-world-class"),
        routeChoice: Boolean(document.querySelector(".finder-route")),
        jumpResults: Boolean(document.querySelector(".jump-results")),
        detailLinks: document.querySelectorAll(".resource-deep-link").length,
        status: Boolean(document.getElementById("worldClassStatus")),
        panelLive: panel?.hasAttribute("aria-live") || false,
        panelRole: panel?.getAttribute("role") || ""
      };
    })()`);
    if (!homepage.worldClass || !homepage.routeChoice || !homepage.jumpResults || homepage.detailLinks < 1 || !homepage.status || homepage.panelLive || homepage.panelRole !== "region") {
      throw new Error(`World-class homepage layer failed: ${JSON.stringify(homepage)}`);
    }
    await capture(client, "finder-desktop.png");

    await navigate(client, `${HOST}/directory`);
    await capture(client, "directory-desktop.png");
    const directory = await evaluate(client, `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const input = document.querySelector("[data-directory-query]");
      const records = [...document.querySelectorAll(".directory-record")];
      const chips = [...document.querySelectorAll("[data-directory-category]")];
      if (!input || !records.length || chips.length < 2) return { ok: false, reason: "directory controls missing" };
      input.value = "zzzz-no-real-service-should-match";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(20);
      const hiddenAfterSearch = records.filter((record) => record.hidden).length;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await sleep(20);
      const visibleAfterEscape = records.filter((record) => !record.hidden).length;
      chips.find((chip) => chip.dataset.directoryCategory)?.click();
      await sleep(20);
      const visibleAfterCategory = records.filter((record) => !record.hidden).length;
      return { ok: true, total: records.length, hiddenAfterSearch, visibleAfterEscape, visibleAfterCategory };
    })()`);
    if (!directory.ok || directory.hiddenAfterSearch !== directory.total || directory.visibleAfterEscape !== directory.total || directory.visibleAfterCategory < 1 || directory.visibleAfterCategory > directory.total) {
      throw new Error(`Directory interaction failed: ${JSON.stringify(directory)}`);
    }

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(client, `${HOST}/`);
    const mobile = await evaluate(client, `(async () => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 500);
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 240));
      const taskbar = document.querySelector(".mobile-taskbar");
      const quick = document.querySelector(".quick-need");
      const style = quick ? getComputedStyle(quick) : null;
      const taskbarStyle = taskbar ? getComputedStyle(taskbar) : null;
      const rect = taskbar?.getBoundingClientRect();
      return {
        taskbar: Boolean(taskbar),
        taskbarVisible: Boolean(rect && rect.height > 0 && Number(taskbarStyle?.opacity || 0) > .9),
        taskbarClass: document.documentElement.classList.contains("show-mobile-taskbar"),
        scrollY: window.scrollY,
        quickHeight: quick?.getBoundingClientRect().height || 0,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        motion: style?.transitionDuration || ""
      };
    })()`);
    await capture(client, "finder-mobile.png");
    if (!mobile.taskbar || !mobile.taskbarVisible || !mobile.taskbarClass || mobile.scrollY <= 180 || mobile.quickHeight < 44 || mobile.overflow > 8) {
      throw new Error(`Mobile world-class UX failed: ${JSON.stringify(mobile)}`);
    }

    if (exceptions.length) throw new Error(`Browser emitted ${exceptions.length} exception(s): ${exceptions.slice(0, 3).join(" | ")}`);
    console.log("RWN world-class browser test passed: finder semantics, permanent detail links, private directory filtering, local crawl graph, local need pages, service accessibility, related services, mobile taskbar, touch targets, and visual QA capture.");
  } finally {
    client?.close();
    browser?.kill("SIGTERM");
    server.kill("SIGTERM");
    await sleep(100);
    await rm(profile, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
