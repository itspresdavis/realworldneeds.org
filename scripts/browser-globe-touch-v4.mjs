import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4178";
const CDP_PORT = 9228;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH before running globe touch QA.");
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
  }
  close() { this.ws?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call("Page.navigate", { url });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(client, "document.readyState === 'complete'")) break;
    await sleep(75);
  }
  await sleep(700);
}

const touchPoint = (x, y, id = 0) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });

async function touch(client, type, points) {
  await client.call("Input.dispatchTouchEvent", { type, touchPoints: points });
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-globe-touch-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4178"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;
  const exceptions = [];

  try {
    await waitFor(`${HOST}/`);
    browser = spawn(findChrome(), [
      "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
      "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run",
      "--ignore-gpu-blocklist", "--use-angle=swiftshader", `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`, "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    await waitFor(`${CDP_HOST}/json/version`);
    const targetResponse = await fetch(`${CDP_HOST}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Could not create browser target: ${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")]);
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown exception"));

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await client.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await navigate(client, `${HOST}/`);

    const ready = await evaluate(client, `new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const canvas = document.getElementById('globeCanvas');
        if (canvas && document.getElementById('zoomIn') && document.getElementById('globeReadout')) return resolve(true);
        if (performance.now() - started > 12000) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`);
    if (!ready) throw new Error("Mobile globe did not initialize within 12 seconds.");

    const setup = await evaluate(client, `(() => {
      const canvas = document.getElementById('globeCanvas');
      canvas.scrollIntoView({ block: 'center', behavior: 'auto' });
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + rect.width * .5, y: Math.min(innerHeight - 120, Math.max(150, rect.top + rect.height * .52)), scrollY, touchAction: getComputedStyle(canvas).touchAction };
    })()`);
    if (setup.touchAction !== "pan-y") throw new Error(`Mobile canvas does not preserve vertical page panning: ${setup.touchAction}`);

    const verticalStart = setup.scrollY;
    await touch(client, "touchStart", [touchPoint(setup.x, setup.y)]);
    for (let step = 1; step <= 5; step += 1) {
      await touch(client, "touchMove", [touchPoint(setup.x + 2, setup.y - step * 22)]);
      await sleep(25);
    }
    const verticalMoving = await evaluate(client, `document.querySelector('.globe-stage')?.classList.contains('is-globe-moving') || false`);
    await touch(client, "touchEnd", []);
    await sleep(250);
    const verticalEnd = await evaluate(client, "scrollY");
    if (Math.abs(verticalEnd - verticalStart) < 30) throw new Error(`Vertical touch did not scroll the page (${verticalStart} -> ${verticalEnd}).`);
    if (verticalMoving) throw new Error("Vertical page swipe incorrectly engaged globe rotation.");

    const horizontalSetup = await evaluate(client, `(() => {
      const canvas = document.getElementById('globeCanvas');
      canvas.scrollIntoView({ block: 'center', behavior: 'auto' });
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + rect.width * .5, y: Math.min(innerHeight - 120, Math.max(150, rect.top + rect.height * .52)), scrollY };
    })()`);
    await touch(client, "touchStart", [touchPoint(horizontalSetup.x, horizontalSetup.y)]);
    for (let step = 1; step <= 5; step += 1) {
      await touch(client, "touchMove", [touchPoint(horizontalSetup.x + step * 25, horizontalSetup.y + 2)]);
      await sleep(25);
    }
    const horizontalMoving = await evaluate(client, `document.querySelector('.globe-stage')?.classList.contains('is-globe-moving') || false`);
    await touch(client, "touchEnd", []);
    await sleep(100);
    const horizontalScroll = await evaluate(client, "scrollY");
    if (!horizontalMoving) throw new Error("Deliberate horizontal touch did not engage globe rotation.");
    if (Math.abs(horizontalScroll - horizontalSetup.scrollY) > 18) throw new Error(`Horizontal globe rotation moved the page by ${Math.abs(horizontalScroll - horizontalSetup.scrollY)}px.`);

    const zoomBefore = await evaluate(client, `Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0,0])[1])`);
    const pinchY = horizontalSetup.y;
    await touch(client, "touchStart", [touchPoint(horizontalSetup.x - 25, pinchY, 0), touchPoint(horizontalSetup.x + 25, pinchY, 1)]);
    for (let step = 1; step <= 5; step += 1) {
      await touch(client, "touchMove", [touchPoint(horizontalSetup.x - 25 - step * 12, pinchY, 0), touchPoint(horizontalSetup.x + 25 + step * 12, pinchY, 1)]);
      await sleep(35);
    }
    await touch(client, "touchEnd", []);
    await sleep(700);
    const zoomAfter = await evaluate(client, `Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0,0])[1])`);
    if (!(zoomAfter > zoomBefore + 0.08)) throw new Error(`Two-finger pinch did not increase zoom (${zoomBefore} -> ${zoomAfter}).`);

    const deep = await evaluate(client, `new Promise((resolve) => {
      const button = document.getElementById('zoomIn');
      const started = performance.now();
      let clicks = 0;
      const read = () => {
        const canvas = document.getElementById('globeCanvas');
        const stage = document.querySelector('.globe-stage');
        const readout = document.getElementById('globeReadout')?.innerText || '';
        const zoom = Number((readout.match(/([0-9.]+)×/) || [0,0])[1]);
        return { zoom, readout, canvasWidth: canvas?.width || 0, stageWidth: stage?.getBoundingClientRect().width || 0, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), detailed: /HD NASA|high-detail boundaries/.test(readout), closeView: stage?.classList.contains('is-close-view') || false };
      };
      const drive = () => {
        const state = read();
        if (state.zoom >= 7 && state.detailed && state.closeView) return resolve({ ...state, clicks });
        if (performance.now() - started > 18000) return resolve({ ...state, clicks });
        if (clicks < 44) { button.click(); clicks += 1; }
        setTimeout(drive, state.zoom > 5 ? 180 : 120);
      };
      drive();
    })`);
    if (deep.zoom < 7 || !deep.detailed || !deep.closeView) throw new Error(`Mobile deep detail did not settle correctly: ${JSON.stringify(deep)}`);
    if (deep.overflow > 8) throw new Error(`Mobile deep zoom introduced ${deep.overflow}px horizontal overflow.`);
    if (!deep.stageWidth || deep.canvasWidth / deep.stageWidth > 1.7) throw new Error(`Mobile render resolution exceeded its close-view budget: ${JSON.stringify(deep)}`);

    const pick = await evaluate(client, `(() => {
      const layer = document.getElementById('pinLayer');
      const candidates = [...document.querySelectorAll('.globe-pin[data-pin-id]')].map((node) => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight);
      const candidate = candidates[0];
      if (!candidate) return null;
      layer.style.pointerEvents = 'none';
      return { id: candidate.node.dataset.pinId, x: candidate.rect.left + candidate.rect.width / 2, y: candidate.rect.top + candidate.rect.height / 2 };
    })()`);
    if (pick) {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: pick.x, y: pick.y, button: "left", clickCount: 1 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: pick.x, y: pick.y, button: "left", clickCount: 1 });
      await sleep(500);
      const selected = await evaluate(client, `location.hash.includes(${JSON.stringify(pick.id)}) || document.querySelector('.globe-pin[data-pin-id="${pick.id}"]')?.getAttribute('aria-current') === 'true'`);
      if (!selected) throw new Error(`Canvas point picking missed visible service ${pick.id} at deep zoom.`);
    }

    await client.call("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
    await sleep(450);
    const landscape = await evaluate(client, `(() => { const stage=document.querySelector('.globe-stage')?.getBoundingClientRect(); return { overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), stageWidth:stage?.width||0, stageHeight:stage?.height||0 }; })()`);
    if (landscape.overflow > 8 || !landscape.stageWidth || !landscape.stageHeight) throw new Error(`Landscape globe layout failed: ${JSON.stringify(landscape)}`);

    if (exceptions.length) throw new Error(`Globe touch QA emitted uncaught exceptions: ${exceptions.slice(0,3).join(" | ")}`);
    await mkdir("qa-screenshots", { recursive: true });
    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await sleep(300);
    const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile("qa-screenshots/globe-touch-mobile.png", Buffer.from(shot.data, "base64"));

    console.log(`RWN globe touch QA passed: native vertical scrolling, horizontal rotation, two-finger pinch, ${deep.zoom.toFixed(2)}x mobile detail, bounded DPR/layout, deep point picking, and orientation resize.`);
  } finally {
    client?.close();
    browser?.kill("SIGTERM");
    server.kill("SIGTERM");
    await sleep(150);
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
