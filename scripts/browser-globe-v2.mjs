import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4173";
const CDP_PORT = 9226;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH before running globe QA.");
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
    this.ws.addEventListener("close", () => this.rejectPending("Chrome DevTools connection closed."));
    this.ws.addEventListener("error", () => this.rejectPending("Chrome DevTools WebSocket failed."));
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  rejectPending(reason) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`${pending.method}: ${reason}`));
    }
    this.pending.clear();
  }

  call(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error(`${method}: Chrome DevTools is not connected.`));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: Chrome DevTools did not respond within ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timeout });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener);
    this.listeners.set(method, list);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((entry) => entry !== listener));
  }

  close() {
    this.rejectPending("Chrome DevTools connection closed.");
    this.ws?.close();
  }
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
  await sleep(600);
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-globe-v2-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4173"], { stdio: ["ignore", "pipe", "pipe"] });
  const chromePath = findChrome();
  let browser;
  let client;
  const exceptions = [];

  try {
    await waitFor(`${HOST}/`);
    browser = spawn(chromePath, [
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
      "--window-size=1440,1100",
      "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    await waitFor(`${CDP_HOST}/json/version`);
    const targetResponse = await fetch(`${CDP_HOST}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Could not create browser target: ${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")]);
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      exceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown browser exception");
    });

    await navigate(client, `${HOST}/`);
    const ready = await evaluate(client, `new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        if (document.getElementById('zoomIn') && document.getElementById('globeCanvas') && document.getElementById('globeReadout')) return resolve(true);
        if (performance.now() - started > 12000) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`);
    if (!ready) throw new Error("Deep-zoom globe controls did not initialize within 12 seconds.");

    const deep = await evaluate(client, `new Promise((resolve) => {
      const button = document.getElementById('zoomIn');
      const started = performance.now();
      let clicks = 0;
      const readState = () => {
        const canvas = document.getElementById('globeCanvas');
        const stage = document.querySelector('.globe-stage');
        const readout = document.getElementById('globeReadout')?.innerText || '';
        const match = readout.match(/([0-9.]+)×/);
        const zoom = match ? Number(match[1]) : 0;
        const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
        return {
          zoom,
          readout,
          canvasWidth: canvas?.width || 0,
          canvasHeight: canvas?.height || 0,
          stageWidth: stage?.getBoundingClientRect().width || 0,
          stageHeight: stage?.getBoundingClientRect().height || 0,
          contextLost: gl ? gl.isContextLost() : true,
          pointLayer: stage?.classList.contains('has-gpu-points') || false,
          closeView: stage?.classList.contains('is-close-view') || false,
          detailed: readout.includes('HD NASA') || readout.includes('high-detail boundaries'),
          overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          clicks
        };
      };
      const drive = () => {
        const state = readState();
        if (state.zoom >= 6 && state.detailed && state.closeView) return resolve(state);
        if (performance.now() - started > 16000) return resolve(state);
        if (clicks < 38 && state.zoom < 7.2) {
          button.click();
          clicks += 1;
        }
        setTimeout(drive, state.zoom >= 6 ? 220 : 140);
      };
      drive();
    })`);

    if (deep.zoom < 6) throw new Error(`Deep globe did not reach a meaningful close view: ${JSON.stringify(deep)}`);
    if (!deep.closeView || !deep.detailed) throw new Error(`Deep globe did not finish its detailed close-view layer: ${JSON.stringify(deep)}`);
    if (deep.contextLost || !deep.canvasWidth || !deep.canvasHeight || !deep.stageWidth || !deep.stageHeight || !deep.pointLayer) {
      throw new Error(`Deep globe rendering became invalid: ${JSON.stringify(deep)}`);
    }
    if (deep.overflow > 8) throw new Error(`Deep globe introduced horizontal overflow: ${deep.overflow}px.`);
    if (exceptions.length) throw new Error(`Deep globe emitted ${exceptions.length} uncaught exception(s): ${exceptions.slice(0, 3).join(" | ")}`);

    await mkdir("qa-screenshots", { recursive: true });
    const shot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    if (!shot.data || shot.data.length < 20_000) throw new Error("Deep globe screenshot payload was unexpectedly small.");
    await writeFile("qa-screenshots/institutional-globe-deep.png", Buffer.from(shot.data, "base64"));

    console.log(`RWN deep-globe QA passed at ${deep.zoom.toFixed(2)}× with ${deep.detailed ? "detailed close-view data" : "standard data"}: WebGL remained live, the point layer stayed integrated, layout remained bounded, and a close-view screenshot was captured.`);
  } finally {
    client?.close();
    browser?.kill("SIGTERM");
    server.kill("SIGTERM");
    await sleep(120);
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
