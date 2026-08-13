import { createHash } from "node:crypto";
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
  throw new Error("Chrome/Chromium was not found for globe touch QA.");
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
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed.")); }, { once: true });
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
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
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
  await sleep(650);
}

const touchPoint = (x, y, id = 0) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
const dispatchTouch = (client, type, touchPoints) => client.call("Input.dispatchTouchEvent", { type, touchPoints });

async function bareCanvasPoint(client) {
  return evaluate(client, `(() => {
    const canvas = document.getElementById('globeCanvas');
    const stage = document.querySelector('.globe-stage');
    canvas.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = canvas.getBoundingClientRect();
    const candidates = [];
    for (const yf of [.34,.45,.56,.67]) {
      for (const xf of [.24,.36,.48,.60,.72]) {
        const x = rect.left + rect.width * xf;
        const y = Math.min(innerHeight - 92, Math.max(120, rect.top + rect.height * yf));
        const node = document.elementFromPoint(x, y);
        candidates.push({ x, y, isCanvas: node === canvas, tag: node?.tagName || '', cls: String(node?.className || '') });
      }
    }
    const point = candidates.find((candidate) => candidate.isCanvas);
    return {
      point,
      candidates,
      scrollY,
      canvasTouchAction: getComputedStyle(canvas).touchAction,
      stageTouchAction: getComputedStyle(stage).touchAction,
      rect: { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height }
    };
  })()`);
}

async function projectionSnapshot(client, ids = []) {
  return evaluate(client, `(() => {
    const requested = ${JSON.stringify(ids)};
    const nodes = requested.length
      ? requested.map((id) => document.querySelector('.globe-pin[data-pin-id="' + CSS.escape(id) + '"]')).filter(Boolean)
      : [...document.querySelectorAll('.globe-pin[data-pin-id]')];
    const rows = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        id: node.dataset.pinId,
        transform: node.style.transform,
        opacity: Number(style.opacity || 0),
        visibility: style.visibility,
        display: style.display,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && Number(style.opacity) > .2 && style.visibility !== 'hidden' && style.display !== 'none'
      };
    });
    if (requested.length) return rows;
    return rows.filter((row) => row.visible)
      .sort((a, b) => Math.hypot(a.x - innerWidth / 2, a.y - innerHeight / 2) - Math.hypot(b.x - innerWidth / 2, b.y - innerHeight / 2))
      .slice(0, 8);
  })()`);
}

function changedProjection(before, after) {
  if (!before || !after) return false;
  return before.transform !== after.transform
    || Math.abs(before.opacity - after.opacity) > 0.03
    || before.visibility !== after.visibility
    || before.display !== after.display
    || Math.hypot(before.x - after.x, before.y - after.y) > 1.5;
}

async function captureRegion(client, rect) {
  const width = Math.max(1, Math.min(rect.width, 390));
  const height = Math.max(1, Math.min(rect.height, 560));
  const { data } = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: rect.x, y: rect.y, width, height, scale: 1 }
  });
  const buffer = Buffer.from(data, "base64");
  return { buffer, digest: createHash("sha256").update(buffer).digest("hex") };
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
        if (document.getElementById('globeCanvas') && document.getElementById('zoomIn') && document.getElementById('globeReadout')) return resolve(true);
        if (performance.now() - started > 12000) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`);
    if (!ready) throw new Error("Mobile globe did not initialize within 12 seconds.");

    const vertical = await bareCanvasPoint(client);
    if (!vertical.point) throw new Error(`Could not find a bare WebGL canvas point: ${JSON.stringify(vertical.candidates)}`);
    if (vertical.canvasTouchAction !== "pan-y" || vertical.stageTouchAction !== "pan-y") {
      throw new Error(`Mobile globe must preserve pan-y across the whole map: ${JSON.stringify(vertical)}`);
    }
    const verticalBefore = await projectionSnapshot(client);
    await dispatchTouch(client, "touchStart", [touchPoint(vertical.point.x, vertical.point.y)]);
    for (let step = 1; step <= 5; step += 1) {
      await dispatchTouch(client, "touchMove", [touchPoint(vertical.point.x + 2, vertical.point.y - step * 22)]);
      await sleep(28);
    }
    await dispatchTouch(client, "touchEnd", []);
    await sleep(280);
    const verticalScroll = await evaluate(client, "scrollY");
    const verticalAfter = await projectionSnapshot(client, verticalBefore.map((row) => row.id));
    if (Math.abs(verticalScroll - vertical.scrollY) < 30) throw new Error(`Vertical swipe did not move the page (${vertical.scrollY} -> ${verticalScroll}).`);
    const verticalChanges = verticalBefore.filter((row) => changedProjection(row, verticalAfter.find((item) => item.id === row.id))).length;
    if (verticalChanges > 0) throw new Error(`Vertical page swipe changed ${verticalChanges} globe projections.`);

    const horizontal = await bareCanvasPoint(client);
    if (!horizontal.point) throw new Error("Could not find a bare canvas point for horizontal rotation.");
    await sleep(180);
    const horizontalBefore = await projectionSnapshot(client);
    const imageBefore = await captureRegion(client, horizontal.rect);
    await dispatchTouch(client, "touchStart", [touchPoint(horizontal.point.x, horizontal.point.y)]);
    for (let step = 1; step <= 6; step += 1) {
      await dispatchTouch(client, "touchMove", [touchPoint(horizontal.point.x + step * 22, horizontal.point.y + 2)]);
      await sleep(32);
    }
    await dispatchTouch(client, "touchEnd", []);
    await sleep(420);
    const horizontalScroll = await evaluate(client, "scrollY");
    const horizontalAfter = await projectionSnapshot(client, horizontalBefore.map((row) => row.id));
    const imageAfter = await captureRegion(client, horizontal.rect);
    if (Math.abs(horizontalScroll - horizontal.scrollY) > 18) throw new Error(`Horizontal globe rotation moved page by ${Math.abs(horizontalScroll - horizontal.scrollY)}px.`);
    const changedMarkers = horizontalBefore.filter((row) => changedProjection(row, horizontalAfter.find((item) => item.id === row.id))).length;
    if (imageBefore.digest === imageAfter.digest) throw new Error("Horizontal touch left the rendered globe pixel-identical.");
    if (horizontalBefore.length && changedMarkers === 0) {
      throw new Error(`Horizontal touch changed the Earth but left all ${horizontalBefore.length} tracked service projections unchanged.`);
    }

    const pinch = await bareCanvasPoint(client);
    const zoomBefore = await evaluate(client, `Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0,0])[1])`);
    await dispatchTouch(client, "touchStart", [touchPoint(pinch.point.x - 28, pinch.point.y, 0), touchPoint(pinch.point.x + 28, pinch.point.y, 1)]);
    for (let step = 1; step <= 5; step += 1) {
      await dispatchTouch(client, "touchMove", [touchPoint(pinch.point.x - 28 - step * 13, pinch.point.y, 0), touchPoint(pinch.point.x + 28 + step * 13, pinch.point.y, 1)]);
      await sleep(35);
    }
    await dispatchTouch(client, "touchEnd", []);
    await sleep(700);
    const zoomAfter = await evaluate(client, `Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0,0])[1])`);
    if (!(zoomAfter > zoomBefore + 0.08)) throw new Error(`Two-finger spread did not zoom (${zoomBefore} -> ${zoomAfter}).`);

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
        if (performance.now() - started > 20000) return resolve({ ...state, clicks });
        if (state.zoom < 7.2 && clicks < 44) { button.click(); clicks += 1; }
        setTimeout(drive, state.zoom > 5 ? 190 : 125);
      };
      drive();
    })`);
    if (deep.zoom < 7 || !deep.detailed || !deep.closeView) throw new Error(`Mobile close view did not settle with detail: ${JSON.stringify(deep)}`);
    if (deep.overflow > 8) throw new Error(`Mobile close view introduced ${deep.overflow}px overflow.`);
    if (!deep.stageWidth || deep.canvasWidth / deep.stageWidth > 1.7) throw new Error(`Mobile render resolution exceeded DPR budget: ${JSON.stringify(deep)}`);

    const pick = await evaluate(client, `(() => {
      const layer = document.getElementById('pinLayer');
      const candidates = [...document.querySelectorAll('.globe-pin[data-pin-id]')]
        .map((node) => ({ node, rect: node.getBoundingClientRect(), opacity: Number(getComputedStyle(node).opacity || 0) }))
        .filter(({ rect, opacity }) => rect.width > 0 && rect.height > 0 && opacity > .25 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight);
      const candidate = candidates[0];
      if (!candidate) return null;
      layer.style.pointerEvents = 'none';
      return { id: candidate.node.dataset.pinId, x: candidate.rect.left + candidate.rect.width / 2, y: candidate.rect.top + candidate.rect.height / 2 };
    })()`);
    if (pick) {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: pick.x, y: pick.y, button: "left", clickCount: 1 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: pick.x, y: pick.y, button: "left", clickCount: 1 });
      await sleep(550);
      const selected = await evaluate(client, `location.hash.includes(${JSON.stringify(pick.id)}) || document.querySelector('.globe-pin[data-pin-id="${pick.id}"]')?.getAttribute('aria-current') === 'true'`);
      if (!selected) throw new Error(`Deep canvas picking missed visible service ${pick.id}.`);
    }

    await client.call("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
    await sleep(450);
    const landscape = await evaluate(client, `(() => { const stage=document.querySelector('.globe-stage')?.getBoundingClientRect(); return { overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), width:stage?.width||0, height:stage?.height||0 }; })()`);
    if (landscape.overflow > 8 || !landscape.width || !landscape.height || landscape.width > innerWidth + 8) throw new Error(`Landscape globe layout failed: ${JSON.stringify(landscape)}`);
    if (exceptions.length) throw new Error(`Globe touch QA emitted uncaught exceptions: ${exceptions.slice(0, 3).join(" | ")}`);

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await sleep(350);
    await mkdir("qa-screenshots", { recursive: true });
    const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile("qa-screenshots/globe-touch-mobile.png", Buffer.from(shot.data, "base64"));
    console.log(`RWN real-touch globe QA passed: vertical page pan, horizontal WebGL + service projection movement, two-finger zoom, ${deep.zoom.toFixed(2)}x mobile detail, bounded DPR/layout, deep point picking, and orientation resize.`);
  } finally {
    client?.close();
    await stopProcess(browser);
    await stopProcess(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
