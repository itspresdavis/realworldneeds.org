import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4179";
const PORT = 9229;
const CDP = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ["google-chrome", "chromium", "chrome"]) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome missing");
}

async function waitFor(url) {
  for (let i = 0; i < 100; i += 1) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Client {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }
  call(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-touch-trace-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4179"], { stdio: "ignore" });
  let browser;
  let client;
  try {
    await waitFor(HOST);
    browser = spawn(chromePath(), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist", "--use-angle=swiftshader", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    await waitFor(`${CDP}/json/version`);
    const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
    client = new Client(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")]);
    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await client.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await client.call("Page.navigate", { url: HOST });
    await sleep(1800);

    const setup = await evaluate(client, `(() => {
      const canvas = document.getElementById('globeCanvas');
      const stage = document.querySelector('.globe-stage');
      canvas.scrollIntoView({ block:'center', behavior:'auto' });
      const rect = canvas.getBoundingClientRect();
      const points = [];
      for (const yf of [.35,.48,.60,.72]) for (const xf of [.25,.38,.5,.62,.75]) {
        const x = rect.left + rect.width * xf;
        const y = Math.min(innerHeight - 80, Math.max(100, rect.top + rect.height * yf));
        const node = document.elementFromPoint(x,y);
        points.push({ x, y, tag:node?.tagName, id:node?.id, cls:node?.className || '', isCanvas:node===canvas });
      }
      const chosen = points.find((p) => p.isCanvas) || points[0];
      window.__rwnTouchTrace = [];
      const describe = (event) => ({
        type:event.type,
        target:event.target?.tagName + '#' + (event.target?.id || '') + '.' + String(event.target?.className || '').replace(/\\s+/g,'.'),
        pointerType:event.pointerType || '',
        cancelable:event.cancelable,
        defaultPrevented:event.defaultPrevented,
        touches:event.touches?.length ?? null,
        x:event.clientX ?? event.touches?.[0]?.clientX ?? null,
        y:event.clientY ?? event.touches?.[0]?.clientY ?? null
      });
      for (const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel']) {
        stage.addEventListener(type, (event) => window.__rwnTouchTrace.push(describe(event)), true);
      }
      return { chosen, points, stageTouchAction:getComputedStyle(stage).touchAction, canvasTouchAction:getComputedStyle(canvas).touchAction };
    })()`);

    const p = setup.chosen;
    const touch = (x, y) => ({ x, y, id:0, radiusX:8, radiusY:8, force:1 });
    await client.call("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:[touch(p.x,p.y)] });
    for (let step = 1; step <= 6; step += 1) {
      await client.call("Input.dispatchTouchEvent", { type:"touchMove", touchPoints:[touch(p.x + step*22,p.y + 2)] });
      await sleep(30);
    }
    await client.call("Input.dispatchTouchEvent", { type:"touchEnd", touchPoints:[] });
    await sleep(300);
    const trace = await evaluate(client, `({ trace:window.__rwnTouchTrace, scrollY, stageClass:document.querySelector('.globe-stage')?.className, readout:document.getElementById('globeReadout')?.innerText })`);
    console.log("RWN_TOUCH_TRACE", JSON.stringify({ setup, trace }));
  } finally {
    client?.close();
    browser?.kill("SIGTERM");
    server.kill("SIGTERM");
    await sleep(100);
    await rm(profile, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
