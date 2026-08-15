// Drives the real page in headless Chromium and asserts that page scrolling and
// globe zooming never interfere with one another.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:5173/";
const WIDTH = 1440;
const HEIGHT = 900;
const PORT = 9500 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const results = [];

function check(label, condition, detail) {
  results.push({ label, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const profile = await mkdtemp(join(tmpdir(), "rwn-qa-"));
const chrome = spawn("chromium", [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-sandbox",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  `--window-size=${WIDTH},${HEIGHT}`,
  "about:blank"
], { stdio: "ignore" });

async function endpoint(path) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(120);
  }
  throw new Error("Chromium DevTools endpoint never became available.");
}

const version = await endpoint("/json/version");
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let messageId = 0;
const pending = new Map();
const events = [];
socket.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  } else if (data.method) events.push(data);
};
const send = (method, params = {}, sessionId) => new Promise((resolve) => {
  messageId += 1;
  pending.set(messageId, resolve);
  socket.send(JSON.stringify({ id: messageId, method, params, sessionId }));
});

const target = await send("Target.createTarget", { url: "about:blank" });
const attached = await send("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
const session = attached.result.sessionId;
await send("Page.enable", {}, session);
await send("Runtime.enable", {}, session);
await send("Log.enable", {}, session);
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, session);
await send("Page.navigate", { url }, session);

const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
  if (response.result?.exceptionDetails) {
    throw new Error(`evaluate failed: ${response.result.exceptionDetails.text} in ${expression.slice(0, 80)}`);
  }
  return response.result?.result?.value;
};

const readZoom = () => evaluate(`Number((document.getElementById('globeReadout')?.innerText.match(/([0-9.]+)×/) || [0, 0])[1])`);
const scrollY = () => evaluate("window.scrollY");
const wheel = (x, y, deltaY, modifiers = 0, deltaX = 0) => send("Input.dispatchMouseEvent", {
  type: "mouseWheel", x, y, deltaX, deltaY, modifiers
}, session);

try {
  const ready = await evaluate(`new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (document.getElementById('globeCanvas') && document.getElementById('globeReadout')?.innerText.includes('×')) return resolve(true);
      if (performance.now() - started > 15000) return resolve(false);
      setTimeout(check, 60);
    };
    check();
  })`);
  if (!ready) throw new Error("The globe never finished initializing.");

  const rect = await evaluate(`(() => { const r = document.querySelector('.globe-stage').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  // 1. A fresh visitor scrolling over the globe must move the page only.
  const zoomBefore = await readZoom();
  for (let i = 0; i < 5; i += 1) { await wheel(rect.x, rect.y, 120); await sleep(80); }
  await sleep(500);
  const afterScroll = await scrollY();
  const zoomAfterScroll = await readZoom();
  check("plain wheel over the globe scrolls the page", afterScroll > 200, `scrollY=${afterScroll}`);
  check("plain wheel over the globe leaves zoom untouched", Math.abs(zoomAfterScroll - zoomBefore) < 0.02, `${zoomBefore} -> ${zoomAfterScroll}`);

  // 2. Ctrl/Cmd wheel zooms and must not move the page at all.
  await evaluate("window.scrollTo(0, 400)");
  await sleep(250);
  const scrollBeforeZoom = await scrollY();
  const zoomBeforeCtrl = await readZoom();
  for (let i = 0; i < 6; i += 1) { await wheel(rect.x, rect.y, -120, 2); await sleep(80); }
  await sleep(700);
  const scrollAfterZoom = await scrollY();
  const zoomAfterCtrl = await readZoom();
  check("modifier wheel zooms the globe in", zoomAfterCtrl > zoomBeforeCtrl + 0.3, `${zoomBeforeCtrl} -> ${zoomAfterCtrl}`);
  check("modifier wheel does not move the page", Math.abs(scrollAfterZoom - scrollBeforeZoom) <= 2, `${scrollBeforeZoom} -> ${scrollAfterZoom}`);

  // 3. Horizontal trackpad gestures zoom without scrolling the page.
  const scrollBeforeHorizontal = await scrollY();
  const zoomBeforeHorizontal = await readZoom();
  for (let i = 0; i < 5; i += 1) { await wheel(rect.x, rect.y, 0, 0, 80); await sleep(80); }
  await sleep(600);
  check("horizontal gesture zooms", (await readZoom()) > zoomBeforeHorizontal + 0.15, `from ${zoomBeforeHorizontal}`);
  check("horizontal gesture does not scroll the page", Math.abs((await scrollY()) - scrollBeforeHorizontal) <= 2);

  // 4. Zoom must remain deep and stable, and never overflow the layout.
  const deep = await evaluate(`new Promise((resolve) => {
    const button = document.getElementById('zoomIn');
    const started = performance.now();
    const step = () => {
      const readout = document.getElementById('globeReadout')?.innerText || '';
      const zoom = Number((readout.match(/([0-9.]+)×/) || [0, 0])[1]);
      if (zoom >= 11 || performance.now() - started > 22000) {
        return resolve({
          zoom,
          readout,
          overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          closeView: document.querySelector('.globe-stage')?.classList.contains('is-close-view') || false
        });
      }
      button.click();
      setTimeout(step, 120);
    };
    step();
  })`);
  check("zoom reaches the deep end of the range", deep.zoom >= 11, `zoom=${deep.zoom}`);
  check("deep zoom loads higher-detail data", /HD NASA|high-detail boundaries/.test(deep.readout), deep.readout);
  check("deep zoom introduces no horizontal overflow", deep.overflowX <= 2, `overflowX=${deep.overflowX}`);
  check("deep zoom sets the close-view state", deep.closeView);

  // 5. Pins must stay mounted while the globe moves (no flicker). Checked at a
  // world view, where markers are expected on screen.
  await evaluate(`document.getElementById('resetGlobe').click()`);
  await sleep(1800);
  const pinBehaviour = await evaluate(`(() => {
    const layer = document.getElementById('pinLayer');
    const stage = document.querySelector('.globe-stage');
    return {
      mounted: layer.children.length,
      layerOpacity: Number(getComputedStyle(layer).opacity || 0),
      moving: stage.classList.contains('is-globe-moving')
    };
  })()`);
  check("markers remain mounted", pinBehaviour.mounted > 0, JSON.stringify(pinBehaviour));
  check("marker layer is never hidden wholesale", pinBehaviour.layerOpacity > 0.9, JSON.stringify(pinBehaviour));

  // 6. Zoom out and confirm the page still scrolls normally afterwards.
  await evaluate("window.scrollTo(0, 0)");
  await sleep(200);
  for (let i = 0; i < 4; i += 1) { await wheel(rect.x, rect.y, 120); await sleep(80); }
  await sleep(400);
  check("page scrolling still works after zooming", (await scrollY()) > 150, `scrollY=${await scrollY()}`);

  const consoleErrors = events
    .filter((event) => event.method === "Log.entryAdded" && event.params.entry.level === "error")
    .map((event) => event.params.entry.text);
  const exceptions = events
    .filter((event) => event.method === "Runtime.exceptionThrown")
    .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text);
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  check("no uncaught exceptions", exceptions.length === 0, exceptions.slice(0, 3).join(" | "));
} finally {
  socket.close();
  chrome.kill("SIGKILL");
  // Chromium can release profile files just after its parent exits; retry so a
  // passing globe test cannot fail solely during temporary-profile cleanup.
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
}

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}${result.detail ? `  (${result.detail})` : ""}`);
}
if (failures.length) {
  console.error(`\n${failures.length} globe interaction check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} globe interaction checks passed.`);
