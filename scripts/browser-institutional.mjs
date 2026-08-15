import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4178";
const CDP_PORT = 9228;
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
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(125);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

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
  await sleep(900);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-institutional-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4178"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;
  const exceptions = [];

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
    const desktop = await evaluate(client, `(() => {
      const panel = document.getElementById("resourcePanel");
      const sidebar = document.querySelector(".finder-sidebar");
      const motion = document.getElementById("toggleMotion");
      const stylesheets = [...document.styleSheets].map((sheet) => sheet.href || "inline");
      const input = document.getElementById("resourceSearch");
      return {
        professional: document.documentElement.classList.contains("rwn-professional"),
        accessibility: document.documentElement.classList.contains("rwn-accessibility"),
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        sidebarOverflow: sidebar ? getComputedStyle(sidebar).overflowY : "missing",
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        panelRole: panel?.getAttribute("role") || "",
        panelLive: panel?.hasAttribute("aria-live") || false,
        resultLinks: document.querySelectorAll(".result-row-link").length,
        directActions: document.querySelectorAll(".result-direct-action").length,
        jumpResults: Boolean(document.querySelector(".jump-results")),
        mobileTaskbar: Boolean(document.querySelector(".mobile-taskbar")),
        finderRoute: Boolean(document.querySelector(".finder-route")),
        headerAction: document.querySelector(".header-action")?.textContent?.trim() || "",
        searchShortcuts: input?.getAttribute("aria-keyshortcuts") || "",
        motionLabel: (motion?.getAttribute("aria-label") || "") + " " + (motion?.getAttribute("title") || ""),
        stylesheets
      };
    })()`);

    if (!desktop.professional || !desktop.accessibility || !desktop.noHorizontalOverflow || desktop.sidebarOverflow === "auto" || desktop.sidebarOverflow === "scroll" || desktop.scrollBehavior !== "auto" || desktop.panelRole !== "region" || desktop.panelLive || desktop.resultLinks < 1 || desktop.directActions < 1 || !desktop.jumpResults || desktop.mobileTaskbar || desktop.finderRoute || desktop.headerAction !== "Browse directory" || !desktop.searchShortcuts.includes("Escape") || /pause globe rotation/i.test(desktop.motionLabel)) {
      throw new Error(`Institutional desktop homepage failed: ${JSON.stringify(desktop)}`);
    }
    if (desktop.stylesheets.some((href) => /\/(?:experience|refinement|world-class)\.css(?:\?|$)/.test(href))) {
      throw new Error(`Legacy homepage stylesheet still shipped: ${JSON.stringify(desktop.stylesheets)}`);
    }
    if (!desktop.stylesheets.some((href) => /\/src\/clarity\.css\?v=/.test(href))) {
      throw new Error(`Institutional clarity stylesheet missing: ${JSON.stringify(desktop.stylesheets)}`);
    }

    const searchBehavior = await evaluate(client, `(async () => {
      const input = document.getElementById("resourceSearch");
      input.value = "food";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const filtered = document.querySelectorAll(".result-row-link").length;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { filtered, cleared: input.value === "" };
    })()`);
    if (searchBehavior.filtered < 1 || !searchBehavior.cleared) throw new Error(`Homepage search mechanics failed: ${JSON.stringify(searchBehavior)}`);
    await capture(client, "institutional-desktop.png");

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(client, `${HOST}/`);
    const mobile = await evaluate(client, `(() => {
      const canvas = document.getElementById("globeCanvas");
      const quickNeeds = [...document.querySelectorAll(".quick-need")];
      const jump = document.querySelector(".jump-results");
      const location = document.querySelector(".location-actions");
      const globe = document.querySelector(".globe-stage");
      const header = document.querySelector(".site-header");
      const jumpRect = jump?.getBoundingClientRect();
      const locationRect = location?.getBoundingClientRect();
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        touchAction: canvas ? getComputedStyle(canvas).touchAction : "missing",
        quickCount: quickNeeds.length,
        quickTargets: quickNeeds.map((node) => ({ height: Math.round(node.getBoundingClientRect().height), right: Math.round(node.getBoundingClientRect().right) })),
        jumpVisible: Boolean(jumpRect && locationRect && jumpRect.height >= 44 && jumpRect.width >= locationRect.width - 1),
        jumpDimensions: { width: Math.round(jumpRect?.width || 0), height: Math.round(jumpRect?.height || 0), locationWidth: Math.round(locationRect?.width || 0), display: jump ? getComputedStyle(jump).display : "missing", visibility: jump ? getComputedStyle(jump).visibility : "missing" },
        jumpBeforeLocation: Boolean(jumpRect && locationRect && jumpRect.top < locationRect.top),
        globeHeight: globe ? Math.round(globe.getBoundingClientRect().height) : 0,
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
        resultLinks: document.querySelectorAll(".result-row-link").length
      };
    })()`);
    if (!mobile.noHorizontalOverflow || mobile.touchAction !== "pan-y" || mobile.quickCount !== 7 || mobile.quickTargets.some((target) => target.height < 40 || target.right > 391) || !mobile.jumpVisible || !mobile.jumpBeforeLocation || mobile.globeHeight > 520 || mobile.headerHeight > 80 || mobile.resultLinks < 1) {
      throw new Error(`Institutional mobile homepage failed: ${JSON.stringify(mobile)}`);
    }
    await capture(client, "institutional-mobile.png");

    if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(" | ")}`);
    console.log("Institutional desktop/mobile browser QA passed.");
  } finally {
    client?.close();
    await stopProcess(browser);
    await stopProcess(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
