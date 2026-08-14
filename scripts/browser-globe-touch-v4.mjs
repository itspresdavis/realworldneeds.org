import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4178";
const PORT = 9228;
const CDP = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found for globe touch QA.");
}

async function waitFor(url, attempts = 100) {
  let error;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      error = new Error(`${url} returned ${response.status}`);
    } catch (caught) { error = caught; }
    await sleep(100);
  }
  throw error || new Error(`Timed out waiting for ${url}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try { child.kill("SIGTERM"); } catch {}
  await sleep(120);
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill("SIGKILL"); } catch {}
  }
}

class CdpClient {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to DevTools.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
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
    const id = this.id++;
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
  for (let i = 0; i < 100; i += 1) {
    if (await evaluate(client, "document.readyState === 'complete'")) break;
    await sleep(70);
  }
  await sleep(650);
}

const touchPoint = (x, y, id = 0) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
const touch = (client, type, points) => client.call("Input.dispatchTouchEvent", { type, touchPoints: points });

async function canvasGeometry(client) {
  return evaluate(client, `(() => {
    const canvas = document.getElementById('globeCanvas');
    const stage = document.querySelector('.globe-stage');
    canvas.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = canvas.getBoundingClientRect();
    const candidates = [];
    for (const yf of [.34,.46,.58,.68]) for (const xf of [.25,.38,.5,.62,.75]) {
      const x = rect.left + rect.width * xf;
      const y = Math.min(innerHeight - 90, Math.max(120, rect.top + rect.height * yf));
      const node = document.elementFromPoint(x, y);
      candidates.push({ x, y, canvas: node === canvas });
    }
    return {
      point: candidates.find((item) => item.canvas) || null,
      scrollY,
      stageTouchAction: getComputedStyle(stage).touchAction,
      canvasTouchAction: getComputedStyle(canvas).touchAction,
      rect: { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height }
    };
  })()`);
}

async function cropDigest(client, rect) {
  const width = Math.max(1, Math.min(390, rect.width));
  const height = Math.max(1, Math.min(560, rect.height));
  const shot = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: rect.x, y: rect.y, width, height, scale: 1 }
  });
  return createHash("sha256").update(Buffer.from(shot.data, "base64")).digest("hex");
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-globe-touch-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4178"], { stdio: "ignore" });
  let browser;
  let client;
  const exceptions = [];

  try {
    await waitFor(HOST);
    browser = spawn(chromePath(), [
      "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
      "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run",
      "--ignore-gpu-blocklist", "--use-angle=swiftshader", `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`, "about:blank"
    ], { stdio: "ignore" });

    await waitFor(`${CDP}/json/version`);
    const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")]);
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown browser exception"));

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await client.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await navigate(client, HOST);

    const ready = await evaluate(client, `new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        if (document.getElementById('globeCanvas') && document.getElementById('globeReadout') && document.getElementById('zoomIn')) return resolve(true);
        if (performance.now() - started > 12000) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`);
    if (!ready) throw new Error("Mobile globe did not initialize.");

    const vertical = await canvasGeometry(client);
    if (!vertical.point) throw new Error("No unobstructed WebGL touch point was available.");
    if (vertical.stageTouchAction !== "pan-y" || vertical.canvasTouchAction !== "pan-y") throw new Error(`Map touch policy is not pan-y: ${JSON.stringify(vertical)}`);
    await touch(client, "touchStart", [touchPoint(vertical.point.x, vertical.point.y)]);
    for (let i = 1; i <= 5; i += 1) {
      await touch(client, "touchMove", [touchPoint(vertical.point.x + 2, vertical.point.y - i * 22)]);
      await sleep(28);
    }
    await touch(client, "touchEnd", []);
    await sleep(260);
    const verticalEnd = await evaluate(client, `({ scrollY, moving:document.querySelector('.globe-stage')?.classList.contains('is-globe-moving') || false })`);
    if (Math.abs(verticalEnd.scrollY - vertical.scrollY) < 30) throw new Error(`Vertical touch did not scroll the page (${vertical.scrollY} -> ${verticalEnd.scrollY}).`);
    if (verticalEnd.moving) throw new Error("Vertical page swipe incorrectly left the globe moving.");

    const horizontal = await canvasGeometry(client);
    const beforeDigest = await cropDigest(client, horizontal.rect);
    await touch(client, "touchStart", [touchPoint(horizontal.point.x, horizontal.point.y)]);
    for (let i = 1; i <= 6; i += 1) {
      await touch(client, "touchMove", [touchPoint(horizontal.point.x + i * 22, horizontal.point.y + 2)]);
      await sleep(32);
    }
    const active = await evaluate(client, `(() => {
      const stage=document.querySelector('.globe-stage');
      const layer=document.getElementById('pinLayer');
      return { moving:stage?.classList.contains('is-globe-moving') || false, pinOpacity:Number(getComputedStyle(layer).opacity || 0) };
    })()`);
    await touch(client, "touchEnd", []);
    await sleep(320);
    const afterDigest = await cropDigest(client, horizontal.rect);
    const horizontalEnd = await evaluate(client, `({ scrollY, moving:document.querySelector('.globe-stage')?.classList.contains('is-globe-moving') || false, pinOpacity:Number(getComputedStyle(document.getElementById('pinLayer')).opacity || 0) })`);
    if (Math.abs(horizontalEnd.scrollY - horizontal.scrollY) > 18) throw new Error(`Horizontal globe drag moved the page by ${Math.abs(horizontalEnd.scrollY - horizontal.scrollY)}px.`);
    if (!active.moving || active.pinOpacity > .2) throw new Error(`Moving globe did not suppress stale HTML targets: ${JSON.stringify(active)}`);
    if (beforeDigest === afterDigest) throw new Error("Horizontal touch left the rendered globe pixel-identical.");
    if (horizontalEnd.moving || horizontalEnd.pinOpacity < .85) throw new Error(`Touch release did not promptly stabilize service targets: ${JSON.stringify(horizontalEnd)}`);

    const pinch = await canvasGeometry(client);
    const zoomBefore = await evaluate(client, `Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0,0])[1])`);
    await touch(client, "touchStart", [touchPoint(pinch.point.x - 28, pinch.point.y, 0), touchPoint(pinch.point.x + 28, pinch.point.y, 1)]);
    for (let i = 1; i <= 5; i += 1) {
      await touch(client, "touchMove", [touchPoint(pinch.point.x - 28 - i * 13, pinch.point.y, 0), touchPoint(pinch.point.x + 28 + i * 13, pinch.point.y, 1)]);
      await sleep(35);
    }
    await touch(client, "touchEnd", []);
    await sleep(700);
    const zoomAfter = await evaluate(client, `Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0,0])[1])`);
    if (!(zoomAfter > zoomBefore + .08)) throw new Error(`Two-finger spread did not zoom (${zoomBefore} -> ${zoomAfter}).`);

    const deep = await evaluate(client, `new Promise((resolve) => {
      const button=document.getElementById('zoomIn');
      const started=performance.now();
      let clicks=0;
      const read=()=>{
        const canvas=document.getElementById('globeCanvas');
        const stage=document.querySelector('.globe-stage');
        const readout=document.getElementById('globeReadout')?.innerText || '';
        const zoom=Number((readout.match(/([0-9.]+)×/) || [0,0])[1]);
        return { zoom, readout, overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), canvasWidth:canvas?.width||0, stageWidth:stage?.getBoundingClientRect().width||0, close:stage?.classList.contains('is-close-view')||false, detailed:/HD NASA|high-detail boundaries/.test(readout) };
      };
      const drive=()=>{
        const state=read();
        if (state.zoom >= 7 && state.close && state.detailed) return resolve(state);
        if (performance.now()-started > 20000) return resolve(state);
        if (state.zoom < 7.2 && clicks < 44) { button.click(); clicks += 1; }
        setTimeout(drive,state.zoom>5?190:125);
      };
      drive();
    })`);
    if (deep.zoom < 7 || !deep.close || !deep.detailed) throw new Error(`Deep mobile detail did not settle: ${JSON.stringify(deep)}`);
    if (deep.overflow > 8) throw new Error(`Deep mobile view introduced ${deep.overflow}px overflow.`);
    if (!deep.stageWidth || deep.canvasWidth / deep.stageWidth > 1.7) throw new Error(`Deep mobile DPR exceeded budget: ${JSON.stringify(deep)}`);

    await client.call("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
    await sleep(450);
    const landscape = await evaluate(client, `(() => { const r=document.querySelector('.globe-stage')?.getBoundingClientRect(); return { overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), width:r?.width||0, height:r?.height||0, viewportWidth:innerWidth }; })()`);
    if (landscape.overflow > 8 || !landscape.width || !landscape.height || landscape.width > landscape.viewportWidth + 8) throw new Error(`Landscape globe layout failed: ${JSON.stringify(landscape)}`);
    if (exceptions.length) throw new Error(`Globe touch QA emitted uncaught exceptions: ${exceptions.slice(0,3).join(" | ")}`);

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await sleep(300);
    await mkdir("qa-screenshots", { recursive: true });
    const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile("qa-screenshots/globe-touch-mobile.png", Buffer.from(shot.data, "base64"));
    console.log(`RWN globe touch QA passed: native vertical scroll, horizontal rotation, prompt target stabilization, pinch zoom, ${deep.zoom.toFixed(2)}x mobile detail, DPR/layout budget, and landscape resize.`);
  } finally {
    client?.close();
    await stop(browser);
    await stop(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
