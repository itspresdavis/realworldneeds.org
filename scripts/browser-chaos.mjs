import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4173";
const CDP_PORT = 9222;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const EXPECTED_QUICK_NEEDS = 7;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];
  for (const candidate of candidates) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH or install a browser before running the chaos test.");
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
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Chrome DevTools WebSocket failed."));
      }, { once: true });
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

  close() {
    this.ws?.close();
  }
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  }
  return result.result?.value;
}

async function navigate(client, url) {
  const loaded = new Promise((resolve) => {
    const off = client.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
    setTimeout(() => {
      off();
      resolve();
    }, 8000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(500);
}

function interactiveNodesWithoutNames(nodes) {
  const interactiveRoles = new Set(["button", "link", "checkbox", "radio", "combobox", "textbox"]);
  return nodes.filter((node) => {
    const role = node.role?.value;
    if (!interactiveRoles.has(role)) return false;
    if (node.ignored) return false;
    return !String(node.name?.value || "").trim();
  });
}

async function testStaticRoutes() {
  const homepage = await fetch(`${HOST}/`);
  if (!homepage.ok) throw new Error(`Homepage returned ${homepage.status}.`);
  const homepageHtml = await homepage.text();
  if (!homepageHtml.includes("Find essential services near you") || !homepageHtml.includes("/directory/help/food")) {
    throw new Error("Homepage is missing the server-visible finder fallback or need navigation.");
  }

  const directory = await fetch(`${HOST}/directory`);
  if (!directory.ok) throw new Error(`Directory returned ${directory.status}.`);
  const directoryHtml = await directory.text();
  const recordCount = (directoryHtml.match(/<article class="directory-record"/g) || []).length;
  if (recordCount < 1 || recordCount > 80) throw new Error(`Directory page rendered ${recordCount} records; expected 1–80.`);
  if (!directoryHtml.includes("Browse by need") || !directoryHtml.includes("Browse by country") || !directoryHtml.includes("/directory/united-states")) {
    throw new Error("Directory is missing crawlable need or country navigation.");
  }

  const country = await fetch(`${HOST}/directory/united-states`);
  if (!country.ok) throw new Error(`Country directory route returned ${country.status}.`);

  const food = await fetch(`${HOST}/directory/help/food`);
  if (!food.ok) throw new Error(`Food-assistance directory route returned ${food.status}.`);
  const foodHtml = await food.text();
  if (!foodHtml.includes("Find free food help") || !foodHtml.includes('"@type":"CollectionPage"')) {
    throw new Error("Food-assistance page is missing expected semantic content.");
  }

  const resourcesResponse = await fetch(`${HOST}/data/resources.json`);
  if (!resourcesResponse.ok) throw new Error(`Resource data returned ${resourcesResponse.status}.`);
  const resourceData = await resourcesResponse.json();
  const sampleId = resourceData.resources?.[0]?.id;
  if (!sampleId) throw new Error("Resource data does not contain a sample listing.");
  const service = await fetch(`${HOST}/service/${encodeURIComponent(sampleId)}`);
  if (!service.ok) throw new Error(`Service detail route returned ${service.status}.`);
  const serviceHtml = await service.text();
  if (!serviceHtml.includes('"@type":"Service"') || !serviceHtml.includes("Visit original source")) {
    throw new Error("Service detail page is missing structured service/source content.");
  }

  const mapIndex = await fetch(`${HOST}/data/map-index.json`);
  if (!mapIndex.ok) throw new Error(`Compact map index returned ${mapIndex.status}.`);
  const mapData = await mapIndex.json();
  if (!Array.isArray(mapData.resources) || mapData.resources.length !== mapData.resourceCount) {
    throw new Error("Compact map index is malformed.");
  }

  const missing = await fetch(`${HOST}/this-route-must-not-exist`);
  if (missing.status !== 404) throw new Error(`Missing route returned ${missing.status} instead of 404.`);
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-chrome-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4173"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;
  const browserExceptions = [];

  try {
    await waitFor(`${HOST}/`);
    await testStaticRoutes();

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
    if (!targetResponse.ok) throw new Error(`Could not create a browser target: ${targetResponse.status}`);
    const target = await targetResponse.json();

    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([
      client.call("Page.enable"),
      client.call("Runtime.enable"),
      client.call("Network.enable"),
      client.call("Accessibility.enable")
    ]);

    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      browserExceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown browser exception");
    });

    await navigate(client, `${HOST}/`);

    const initial = await evaluate(client, `(() => ({
      title: document.title,
      rootChildren: document.getElementById("root")?.children.length || 0,
      quickNeeds: document.querySelectorAll(".quick-need").length,
      refined: document.documentElement.classList.contains("rwn-refined"),
      finderSearch: Boolean(document.querySelector(".finder-search")),
      layerList: Boolean(document.getElementById("layerList")),
      clusterNumbers: document.querySelectorAll(".globe-cluster > span b").length,
      canvas: Boolean(document.getElementById("globeCanvas")),
      filters: document.querySelectorAll(".layer-toggle[data-type]").length,
      refinementResources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("refinement.js"))
    }))()`);

    if (!initial.title.includes("Real World Needs") || initial.rootChildren < 1 || !initial.canvas) {
      throw new Error(`Homepage did not initialize correctly: ${JSON.stringify(initial)}; exceptions=${browserExceptions.slice(0, 3).join(" | ")}`);
    }
    if (initial.quickNeeds !== EXPECTED_QUICK_NEEDS || !initial.refined) {
      throw new Error(`Finder refinements did not initialize: ${JSON.stringify(initial)}; exceptions=${browserExceptions.slice(0, 3).join(" | ")}`);
    }
    if (initial.clusterNumbers !== 0) throw new Error(`Numeric cluster markup is present in production output (${initial.clusterNumbers}).`);
    if (initial.filters < 7) throw new Error(`Detailed filters did not initialize (${initial.filters}).`);

    const stress = await evaluate(client, `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const search = document.getElementById("resourceSearch");
      const canvas = document.getElementById("globeCanvas");
      const filters = [...document.querySelectorAll(".layer-toggle[data-type]")];
      const quick = [...document.querySelectorAll(".quick-need")];
      if (!search || !canvas || filters.length < 7 || quick.length !== ${EXPECTED_QUICK_NEEDS}) return { ok: false, reason: "controls missing" };

      for (let i = 0; i < 120; i += 1) {
        search.value = i % 3 === 0 ? "food" : i % 3 === 1 ? "shelter" : "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));

      for (let i = 0; i < 90; i += 1) filters[i % filters.length].click();
      document.querySelector('.quick-need[data-quick-type="all"]')?.click();

      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, pointerType: "mouse", clientX: cx, clientY: cy, bubbles: true }));
      for (let i = 0; i < 140; i += 1) {
        canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", clientX: cx + Math.sin(i / 5) * 150, clientY: cy + Math.cos(i / 7) * 90, bubbles: true }));
      }
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", clientX: cx, clientY: cy, bubbles: true }));

      for (let i = 0; i < 50; i += 1) {
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: i % 2 ? 130 : -130, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
      }
      for (let i = 0; i < 20; i += 1) {
        document.getElementById(i % 2 ? "zoomIn" : "zoomOut")?.click();
      }

      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const lose = gl?.getExtension("WEBGL_lose_context");
      if (lose) {
        lose.loseContext();
        await sleep(100);
        lose.restoreContext();
      }

      await sleep(700);
      return {
        ok: Boolean(document.getElementById("root")?.children.length),
        clusterNumbers: document.querySelectorAll(".globe-cluster > span b").length,
        bodyText: document.body.innerText.length,
        searchValue: search.value
      };
    })()`);

    if (!stress.ok || stress.clusterNumbers !== 0 || stress.bodyText < 500) {
      throw new Error(`Stress pass left the page in an invalid state: ${JSON.stringify(stress)}`);
    }

    await client.call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await sleep(400);
    const mobile = await evaluate(client, `(() => ({
      width: innerWidth,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      quickVisible: [...document.querySelectorAll(".quick-need")].every((node) => node.getBoundingClientRect().height > 0),
      clusterNumbers: document.querySelectorAll(".globe-cluster > span b").length
    }))()`);
    if (mobile.width !== 390 || mobile.overflow > 8 || !mobile.quickVisible || mobile.clusterNumbers !== 0) {
      throw new Error(`Mobile layout failed the crash test: ${JSON.stringify(mobile)}`);
    }

    await client.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    });
    await navigate(client, `${HOST}/`);
    const reducedMotion = await evaluate(client, `(() => ({
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      quickNeeds: document.querySelectorAll(".quick-need").length,
      clusterNumbers: document.querySelectorAll(".globe-cluster > span b").length
    }))()`);
    if (!reducedMotion.reduced || reducedMotion.quickNeeds !== EXPECTED_QUICK_NEEDS || reducedMotion.clusterNumbers !== 0) {
      throw new Error(`Reduced-motion mode failed: ${JSON.stringify(reducedMotion)}`);
    }

    const tree = await client.call("Accessibility.getFullAXTree");
    const unnamed = interactiveNodesWithoutNames(tree.nodes || []);
    if (unnamed.length) {
      const roles = unnamed.slice(0, 5).map((node) => node.role?.value).join(", ");
      throw new Error(`Accessibility tree contains ${unnamed.length} unnamed interactive controls (${roles}).`);
    }

    if (browserExceptions.length) {
      throw new Error(`Browser emitted ${browserExceptions.length} uncaught exception(s): ${browserExceptions.slice(0, 3).join(" | ")}`);
    }

    console.log("RWN browser chaos test passed: desktop, mobile, rapid search/filter churn, globe input, WebGL context loss, reduced motion, accessibility names, crawlable need/service routes, pagination, and compact data index.");
  } finally {
    client?.close();
    browser?.kill("SIGTERM");
    server.kill("SIGTERM");
    // Chromium can release profile files just after its parent exits; retry so a
    // passing browser test cannot be reported as a false cleanup failure.
    await sleep(250);
    await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});