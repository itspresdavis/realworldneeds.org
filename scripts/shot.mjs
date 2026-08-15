// Local visual QA helper: capture full-page or viewport screenshots via CDP.
// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [fullPage:0|1] [waitMs]
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const [, , url, out, widthArg, heightArg, fullArg, waitArg] = process.argv;
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [w] [h] [full] [waitMs]");
  process.exit(1);
}
const width = Number(widthArg || 1440);
const height = Number(heightArg || 900);
const fullPage = fullArg === "1";
const waitMs = Number(waitArg || 2600);
const CDP_PORT = 9411 + Math.floor(Math.random() * 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const r = spawnSync("which", [c], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error("no chromium");
}

async function cdp(path) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return res.json();
    } catch {}
    await sleep(120);
  }
  throw new Error(`cdp timeout ${path}`);
}

const profile = await mkdtemp(join(tmpdir(), "rwn-shot-"));
const chrome = spawn(findChrome(), [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  "--no-sandbox",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "--hide-scrollbars",
  `--window-size=${width},${height}`,
  "about:blank",
], { stdio: "ignore" });

let ws;
try {
  const version = await cdp("/json/version");
  const { default: WebSocket } = await import("node:ws").catch(() => ({ default: null }));
  // Node 22 has global WebSocket
  ws = new (globalThis.WebSocket || WebSocket)(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    id += 1; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const target = await send("Target.createTarget", { url: "about:blank" });
  const attached = await send("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
  const sid = attached.result.sessionId;
  await send("Page.enable", {}, sid);
  await send("Runtime.enable", {}, sid);
  await send("Log.enable", {}, sid);
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1,
    mobile: width < 700,
  }, sid);
  await send("Page.navigate", { url }, sid);
  await sleep(waitMs);

  if (fullPage) {
    const metrics = await send("Page.getLayoutMetrics", {}, sid);
    const cs = metrics.result.cssContentSize || metrics.result.contentSize;
    await send("Emulation.setDeviceMetricsOverride", {
      width, height: Math.min(Math.ceil(cs.height), 12000), deviceScaleFactor: 1, mobile: width < 700,
    }, sid);
    await sleep(700);
  }
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage }, sid);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(shot.result.data, "base64"));

  const logs = events
    .filter((e) => e.method === "Log.entryAdded" || e.method === "Runtime.exceptionThrown")
    .map((e) => e.method === "Log.entryAdded"
      ? `[${e.params.entry.level}] ${e.params.entry.text}`
      : `[exception] ${e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text}`);
  if (logs.length) console.log(logs.join("\n"));
  console.log(`saved ${out}`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
