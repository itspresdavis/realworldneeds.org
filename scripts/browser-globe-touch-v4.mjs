import { waitForScrollStability, sameCaptureGeometry } from "./qa-scroll-stability.mjs";
import { verifyGlobeInterruptions } from "./qa-globe-interruptions.mjs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function waitForExpression(client, expression, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if (await evaluate(client, expression)) return; } catch {}
    await sleep(100);
  }
  throw new Error(message);
}

const touchPoint = (x, y, id = 0) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
const touch = (client, type, points) => client.call("Input.dispatchTouchEvent", { type, touchPoints: points });

async function canvasGeometry(client, recenter = true) {
  if (recenter) await evaluate(client, "document.getElementById('globeCanvas').scrollIntoView({block:'center',behavior:'auto'})");
  const stable = await waitForScrollStability({
    sample: () => evaluate(client, `new Promise(resolve => requestAnimationFrame(() => {
      const rect=document.getElementById('globeCanvas').getBoundingClientRect();
      const viewport=window.visualViewport;
      resolve({at:performance.now(),scrollX,scrollY,viewportX:viewport?.offsetLeft || 0,viewportY:viewport?.offsetTop || 0,viewportWidth:viewport?.width || innerWidth,viewportHeight:viewport?.height || innerHeight,canvasX:rect.left,canvasY:rect.top,canvasWidth:rect.width,canvasHeight:rect.height});
    }))`),
    wait: sleep
  });
  await evaluate(client, `(window.__rwnScrollPreconditions ||= []).push(${JSON.stringify(stable)})`);
  return evaluate(client, `(() => {
    const canvas = document.getElementById('globeCanvas');
    const stage = document.querySelector('.globe-stage');
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
      scrollX, scrollY,
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

// Inspect a failed live animation through DevTools, without modifying shipped
// application code or adding a production debug API. Sampling happens only
// after a failed assertion, so successful-run timings are unaffected.
async function inspectFailedGlobeState(client) {
  let breakpoint;
  try {
    const source = await readFile("dist/src/app.js", "utf8");
    const lineNumber = source.split("\n").findIndex((line) => line.startsWith("function animateGlobe(now)")) + 1;
    if (lineNumber < 1) return { diagnosticError: "Built animation entry point was not found." };
    await client.call("Debugger.enable");
    const result = await client.call("Debugger.setBreakpointByUrl", {
      urlRegex: "/src/app\\.js(?:\\?|$)", lineNumber,
      condition: `(globalThis.__rwnRuntimeSnapshot = {
        dragging:state.dragging,touching:state.touching,pinching:state.pinching,
        zoom:state.zoom,targetZoom:state.targetZoom,targetLon:state.targetLon,
        velocityLon:state.velocityLon,velocityLat:state.velocityLat,
        globeVisible:state.globeVisible,contextLost:globeContextLost,
        pointers:activeGlobePointers.size,autoRotate:state.autoRotate,
        frames:globeRenderer?.info.render.frame,textures:globeRenderer?.info.memory.textures,
        at:performance.now()
      },false)`
    });
    breakpoint = result.breakpointId;
    await sleep(650);
    return await evaluate(client, "window.__rwnRuntimeSnapshot || null");
  } catch (error) {
    return { diagnosticError: String(error.message || error) };
  } finally {
    if (breakpoint) await client.call("Debugger.removeBreakpoint", { breakpointId: breakpoint }).catch(() => {});
    await client.call("Debugger.disable").catch(() => {});
  }
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-globe-touch-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4178"], { stdio: "ignore" });
  let browser;
  let client;
  const exceptions = [];
  let phase = "setup";
  const observations = {};

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
    await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__rwnLongTasks = [];
      window.__rwnInputTimings = [];
      window.__rwnFrameSamples = {};
      window.__rwnInputTrace = [];
      window.__rwnScrollPreconditions = [];
      window.__rwnScrollTrace = [];
      const recordScroll = (type) => {
        const rows=window.__rwnScrollTrace;
        rows.push({type,at:performance.now(),scrollX,scrollY,viewportX:window.visualViewport?.offsetLeft || 0,viewportY:window.visualViewport?.offsetTop || 0});
        if(rows.length>200)rows.shift();
      };
      window.addEventListener('scroll', () => recordScroll('scroll'), {passive:true});
      window.addEventListener('resize', () => recordScroll('resize'), {passive:true});
      window.visualViewport?.addEventListener('scroll', () => recordScroll('viewport-scroll'), {passive:true});
      window.visualViewport?.addEventListener('resize', () => recordScroll('viewport-resize'), {passive:true});
      window.__rwnStartFrameSample = (label) => {
        window.__rwnSamplingFrames=true;
        const deltas=[]; window.__rwnFrameSamples[label]=deltas;
        let last;
        const frame=(now)=>{if(last!==undefined)deltas.push(now-last);last=now;if(window.__rwnSamplingFrames && deltas.length<300)requestAnimationFrame(frame);};
        requestAnimationFrame(frame);
      };
      for (const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel']) {
        document.addEventListener(type, (event) => {
          if (!event.target.closest?.('.globe-stage')) return;
          const rows=window.__rwnInputTrace;
          rows.push({type,at:performance.now(),scrollX,scrollY,target:event.target.id || event.target.className,touches:Array.from(event.touches || []).map(t=>({id:t.identifier,x:t.clientX,y:t.clientY})),changed:Array.from(event.changedTouches || []).map(t=>t.identifier)});
          if(rows.length>100)rows.shift();
        }, {capture:true,passive:true});
      }
      try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.interactionId) window.__rwnInputTimings.push({type:entry.name,duration:entry.duration,inputDelay:entry.processingStart-entry.startTime}); }).observe({type:'event',durationThreshold:16,buffered:true}); } catch {}
      try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__rwnLongTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
    ` });
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
    const readyMs = await evaluate(client, "performance.now()");

    phase = "vertical-scroll";
    const vertical = await canvasGeometry(client);
    observations.verticalStart = vertical;
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

    observations.vertical = verticalEnd;
    phase = "horizontal-drag";
    let horizontal = await canvasGeometry(client);
    const captureGeometry = horizontal;
    observations.horizontalCapture = captureGeometry;
    const beforeDigest = await cropDigest(client, captureGeometry.rect);
    // A screenshot can take a slow compositor several frames. Observe again
    // afterward and record the actual start position immediately before input.
    horizontal = await canvasGeometry(client, false);
    observations.horizontalStart = horizontal;
    if (!sameCaptureGeometry(captureGeometry, horizontal)) throw new Error("Globe capture geometry changed before horizontal input; rotation pixel comparison would be invalid.");
    await evaluate(client, "window.__rwnStartFrameSample('horizontalDrag')");
    await touch(client, "touchStart", [touchPoint(horizontal.point.x, horizontal.point.y)]);
    for (let i = 1; i <= 6; i += 1) {
      await touch(client, "touchMove", [touchPoint(horizontal.point.x + i * 22, horizontal.point.y + 2)]);
      await sleep(32);
    }
    const active = await evaluate(client, `(() => {
      const stage=document.querySelector('.globe-stage');
      const layer=document.getElementById('pinLayer');
      const label=layer.querySelector('.globe-pin > strong');
      return {
        moving:stage?.classList.contains('is-globe-moving') || false,
        pinOpacity:Number(getComputedStyle(layer).opacity || 0),
        mounted:layer.children.length,
        labelOpacity:label?Number(getComputedStyle(label).opacity || 0):0
      };
    })()`);
    await touch(client, "touchEnd", []);
    await sleep(320);
    await evaluate(client, "window.__rwnSamplingFrames=false");
    const afterDigest = await cropDigest(client, captureGeometry.rect);
    const horizontalEnd = await evaluate(client, `({ scrollY, moving:document.querySelector('.globe-stage')?.classList.contains('is-globe-moving') || false, pinOpacity:Number(getComputedStyle(document.getElementById('pinLayer')).opacity || 0) })`);
    observations.horizontalEnd = horizontalEnd;
    if (Math.abs(horizontalEnd.scrollY - horizontal.scrollY) > 18) throw new Error(`Horizontal globe drag moved the page by ${Math.abs(horizontalEnd.scrollY - horizontal.scrollY)}px.`);
    // Markers stay mounted and keep tracking their coordinates while the globe
    // moves; only the text label chrome fades, so nothing flickers in and out.
    if (!active.moving) throw new Error(`Horizontal drag did not register as globe motion: ${JSON.stringify(active)}`);
    if (active.pinOpacity < .85) throw new Error(`Marker layer was hidden wholesale during motion: ${JSON.stringify(active)}`);
    if (active.mounted > 0 && active.labelOpacity > .2) throw new Error(`Stale marker labels stayed visible during motion: ${JSON.stringify(active)}`);
    if (beforeDigest === afterDigest) throw new Error("Horizontal touch left the rendered globe pixel-identical.");
    if (horizontalEnd.moving || horizontalEnd.pinOpacity < .85) throw new Error(`Touch release did not promptly stabilize service targets: ${JSON.stringify(horizontalEnd)}`);

    observations.horizontal = horizontalEnd;
    phase = "native-gesture-interruptions";
    await verifyGlobeInterruptions({ client, evaluate, canvasGeometry, sleep, observations });

    phase = "pinch";
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

    // Lift one finger, then continue rotating with the other. This used to
    // retain a stale pinch baseline and leave interaction state stuck.
    observations.pinch = { zoomBefore, zoomAfter };
    phase = "pinch-to-drag";
    const transition = await canvasGeometry(client);
    await evaluate(client, "window.__rwnStartFrameSample('pinchToDrag')");
    await touch(client, "touchStart", [touchPoint(transition.point.x - 20, transition.point.y, 0), touchPoint(transition.point.x + 20, transition.point.y, 1)]);
    await touch(client, "touchMove", [touchPoint(transition.point.x - 35, transition.point.y, 0), touchPoint(transition.point.x + 35, transition.point.y, 1)]);
    // Chromium has two native input backends: the legacy path releases the
    // supplied IDs, while the newer path releases IDs omitted from touchMove.
    // Verify the DOM event rather than assuming which backend is active.
    try {
      await touch(client, "touchEnd", [touchPoint(transition.point.x + 35, transition.point.y, 1)]);
    } catch (error) {
      if (!/TouchEnd and TouchCancel must not have any touch points/.test(error.message)) throw error;
      await touch(client, "touchMove", [touchPoint(transition.point.x - 35, transition.point.y, 0)]);
    }
    const remainingTouch = await evaluate(client, "window.__rwnInputTrace.findLast(e=>e.type==='touchend')");
    if (remainingTouch?.touches?.length !== 1 || remainingTouch.touches[0].id !== 0 || !remainingTouch.changed.includes(1)) throw new Error(`Native one-finger release was not delivered: ${JSON.stringify(remainingTouch)}`);
    for (let i = 1; i <= 4; i += 1) {
      await touch(client, "touchMove", [touchPoint(transition.point.x - 35 + i * 18, transition.point.y, 0)]);
      await sleep(30);
    }
    await touch(client, "touchEnd", []);
    await sleep(900);
    await evaluate(client, "window.__rwnSamplingFrames=false");
    if (await evaluate(client, "document.querySelector('.globe-stage').classList.contains('is-globe-moving')")) throw new Error("Pinch-to-drag transition left the globe moving.");

    phase = "canvas-touch-picking";
    // Use the reset globe centre (land in western Africa) for an actual touch
    // hit-test of the rendered sphere, rather than clicking a DOM marker.
    await evaluate(client, "document.getElementById('resetGlobe').click()");
    await sleep(1500);
    const center = await evaluate(client, `(() => {
      const c=document.getElementById('globeCanvas'); c.scrollIntoView({block:'center',behavior:'auto'});
      const r=c.getBoundingClientRect();
      const candidates=[[.5,.5],[.55,.45],[.6,.45],[.5,.4]].map(([xf,yf])=>({x:r.left+r.width*xf,y:r.top+r.height*yf}));
      return candidates.find(({x,y})=>document.elementFromPoint(x,y)===c) || null;
    })()`);
    if (!center) throw new Error("Globe centre is covered by interface chrome; touch selection cannot be tested.");
    await touch(client, "touchStart", [touchPoint(center.x, center.y)]);
    await touch(client, "touchEnd", []);
    await sleep(1600);
    const picked = await evaluate(client, "document.querySelector('#globeReadout strong')?.textContent || ''");
    if (!picked || picked === "World view") throw new Error(`Canvas touch did not select the country or service under it: ${picked}`);

    phase = "deep-zoom";
    const deep = await evaluate(client, `new Promise((resolve) => {
      const button=document.getElementById('zoomIn');
      const started=performance.now();
      let clicks=0;
      const read=()=>{
        const canvas=document.getElementById('globeCanvas');
        const stage=document.querySelector('.globe-stage');
        const readout=document.getElementById('globeReadout')?.innerText || '';
        const zoom=Number((readout.match(/([0-9.]+)×/) || [0,0])[1]);
        const detailStatus=document.getElementById('globeDetailStatus')?.textContent || '';
        const mobileTextureLoaded=performance.getEntriesByType('resource').some(e=>e.name.endsWith('/earth-blue-marble-mobile.jpg') && e.responseEnd > 0);
        return { zoom, readout, detailStatus, overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), canvasWidth:canvas?.width||0, stageWidth:stage?.getBoundingClientRect().width||0, close:stage?.classList.contains('is-close-view')||false, detailed:/HD NASA/.test(detailStatus) && mobileTextureLoaded };
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
    const performanceReport = await evaluate(client, `(() => ({
      readyMs: ${readyMs},
      longTasks: window.__rwnLongTasks || [],
      inputTimings: window.__rwnInputTimings || [],
      frameIntervals: window.__rwnFrameSamples || {},
      scrollTrace: window.__rwnScrollTrace || [],
      scrollPreconditions: window.__rwnScrollPreconditions || [],
      navigation: performance.getEntriesByType('navigation').map(e=>({responseEnd:e.responseEnd,domContentLoaded:e.domContentLoadedEventEnd,load:e.loadEventEnd})),
      globeAssets: performance.getEntriesByType('resource').filter(e=>/earth-blue-marble|countries.*geojson/.test(e.name)).map(e=>({name:new URL(e.name).pathname,bytes:e.transferSize,duration:e.duration})),
      device: {width:390,height:844,emulatedTouch:true,engine:'Chromium'}
    }))()`);
    if (performanceReport.globeAssets.some(asset => asset.name.endsWith('/earth-blue-marble-detail.jpg'))) throw new Error("Mobile close view downloaded the 8K desktop texture.");
    await mkdir("qa-screenshots", { recursive: true });
    await writeFile("qa-screenshots/globe-touch-performance.json", JSON.stringify(performanceReport, null, 2));
    console.log(`Globe mobile performance evidence: ${JSON.stringify(performanceReport)}`);
    if (exceptions.length) throw new Error(`Globe touch QA emitted uncaught exceptions: ${exceptions.slice(0,3).join(" | ")}`);

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await sleep(300);
    await mkdir("qa-screenshots", { recursive: true });
    const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile("qa-screenshots/globe-touch-mobile.png", Buffer.from(shot.data, "base64"));
    phase = "connected-service-journey";
    // Continue the same mobile session from exploring the map to finding,
    // saving, leaving and returning to a service. No real user data is used.
    await evaluate(client, `(() => {
      const input=document.getElementById('resourceSearch');
      input.value='London'; input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await waitForExpression(client, "document.querySelector('#resourceGrid .result-row-link') && document.getElementById('resourceSearch').value === 'London'", "Search after globe gestures did not settle.");
    const serviceUrl = await evaluate(client, "document.querySelector('#resourceGrid .result-row-link').href");
    const serviceId = decodeURIComponent(new URL(serviceUrl).pathname.split('/').pop());
    await navigate(client, serviceUrl);
    await waitForExpression(client, "!!document.querySelector('[data-service-save]')", "Service saving control did not load.");
    await evaluate(client, "document.querySelector('[data-service-save]').click()");
    if (!await evaluate(client, "document.querySelector('[data-service-save]').getAttribute('aria-pressed') === 'true'")) throw new Error("Service could not be saved after map exploration.");
    await evaluate(client, "history.back()");
    await waitForExpression(client, "document.getElementById('resourceSearch')?.value === 'London'", "Back did not restore the search after leaving the map.");
    await evaluate(client, "document.getElementById('globeCanvas').scrollIntoView({block:'center',behavior:'auto'})");
    await sleep(350);
    const returnedMap = await evaluate(client, `(() => {
      const canvas=document.getElementById('globeCanvas');
      const gl=canvas.getContext('webgl2') || canvas.getContext('webgl');
      const zoom=Number((document.getElementById('globeReadout').innerText.match(/([0-9.]+)×/) || [0,0])[1]);
      return {live:!!gl && !gl.isContextLost() && !document.querySelector('.globe-stage').classList.contains('is-globe-unavailable'),zoom};
    })()`);
    if (!returnedMap.live || !returnedMap.zoom) throw new Error(`Returning from a service left the globe unavailable: ${JSON.stringify(returnedMap)}`);
    await evaluate(client, `document.getElementById('${returnedMap.zoom < 7.9 ? "zoomIn" : "zoomOut"}').click()`);
    await waitForExpression(client, `Math.abs(Number((document.getElementById('globeReadout').innerText.match(/([0-9.]+)×/) || [0,0])[1]) - ${returnedMap.zoom}) > .02`, "The restored globe did not respond to zoom after Back.");
    phase = "real-context-recovery";
    const lossFixture = await evaluate(client, `(() => {
      const canvas=document.getElementById('globeCanvas');
      const gl=canvas.getContext('webgl2') || canvas.getContext('webgl');
      const extension=gl?.getExtension('WEBGL_lose_context');
      if(!extension) return {supported:false};
      const zoom=Number((document.getElementById('globeReadout').innerText.match(/([0-9.]+)×/) || [0,0])[1]);
      extension.loseContext();
      return {supported:true,zoom,query:document.getElementById('resourceSearch').value};
    })()`);
    if (!lossFixture.supported) throw new Error("CI browser cannot exercise real WebGL context loss.");
    await waitForExpression(client, "document.querySelector('.globe-stage').classList.contains('is-globe-unavailable') && document.getElementById('globeCanvas').getContext('webgl2').isContextLost()", "Real context loss did not expose the recovery state.");
    await evaluate(client, "document.getElementById('retryGlobe').click()");
    await waitForExpression(client, "!document.querySelector('.globe-stage').classList.contains('is-globe-unavailable') && !document.getElementById('globeCanvas').getContext('webgl2').isContextLost()", "Retry failed to restore a real lost WebGL context.");
    await evaluate(client, "document.getElementById('globeCanvas').scrollIntoView({block:'center',behavior:'auto'})");
    await evaluate(client, `document.getElementById('${lossFixture.zoom < 7.9 ? "zoomIn" : "zoomOut"}').click()`);
    await waitForExpression(client, `Math.abs(Number((document.getElementById('globeReadout').innerText.match(/([0-9.]+)×/) || [0,0])[1]) - ${lossFixture.zoom}) > .02`, "The restored context did not render zoom changes.");
    if (!await evaluate(client, `document.getElementById('resourceSearch').value === ${JSON.stringify(lossFixture.query)}`)) throw new Error("Context recovery discarded the current search.");
    const recoveredShot=await client.call("Page.captureScreenshot", {format:"png",fromSurface:true,captureBeyondViewport:false});
    await writeFile("qa-screenshots/globe-context-recovered.png", Buffer.from(recoveredShot.data,"base64"));
    observations.realContextRecovery = { passed: true, queryPreserved: true, zoomResponds: true };
    phase = "saved-return-journey";
    await navigate(client, `${HOST}/directory#saved`);
    await waitForExpression(client, `!!document.querySelector('[data-saved-remove="${serviceId}"]')`, "Saved service did not appear in the directory.");
    await navigate(client, "about:blank");
    await navigate(client, `${HOST}/directory#saved`);
    await waitForExpression(client, `!!document.querySelector('[data-saved-remove="${serviceId}"]')`, "Saved service was lost after leaving and returning.");
    if (exceptions.length) throw new Error(`Mobile service journey emitted uncaught exceptions: ${exceptions.slice(0,3).join(" | ")}`);
    console.log("Connected mobile journey passed: globe touch interaction → search → service → save → Back restores query → leave and return to Saved.");
    console.log(`RWN globe touch QA passed: native vertical scroll, horizontal rotation, canvas touch picking, pinch-to-drag recovery, prompt target stabilization, pinch zoom, ${deep.zoom.toFixed(2)}x mobile detail, DPR/layout budget, and landscape resize.`);
  } catch (error) {
    if (client) {
      try {
        const failure = await evaluate(client, `(() => {
          const canvas=document.getElementById('globeCanvas');
          const gl=canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
          const stage=document.querySelector('.globe-stage');
          return {readout:document.getElementById('globeReadout')?.innerText,moving:stage?.classList.contains('is-globe-moving'),contextLost:!gl || gl.isContextLost(),scrollY,viewport:{width:innerWidth,height:innerHeight},inputTrace:window.__rwnInputTrace,scrollTrace:window.__rwnScrollTrace,scrollPreconditions:window.__rwnScrollPreconditions,frameIntervals:window.__rwnFrameSamples,longTasks:window.__rwnLongTasks,inputTimings:window.__rwnInputTimings,assets:performance.getEntriesByType('resource').filter(e=>/earth-blue-marble|countries.*geojson/.test(e.name)).map(e=>({name:new URL(e.name).pathname,bytes:e.transferSize,duration:e.duration}))};
        })()`);
        failure.runtime = await inspectFailedGlobeState(client);
        Object.assign(failure, { phase, error: String(error.message || error), observations, exceptions, scrollPreconditionFailure: error.scrollStability || null });
        await mkdir("qa-screenshots", { recursive: true });
        await writeFile("qa-screenshots/globe-touch-failure.json", JSON.stringify(failure, null, 2));
        const shot=await client.call("Page.captureScreenshot", {format:"png",fromSurface:true,captureBeyondViewport:false});
        await writeFile("qa-screenshots/globe-touch-failure.png", Buffer.from(shot.data,"base64"));
        console.error(`Globe failure diagnostics: ${JSON.stringify(failure)}`);
      } catch (diagnosticError) { console.error(`Failure diagnostics unavailable: ${diagnosticError.message}`); }
    }
    throw error;
  } finally {
    client?.close();
    await stop(browser);
    await stop(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
