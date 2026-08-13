import http from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const require = createRequire(import.meta.url);
const HOST = "http://127.0.0.1:4173";
const CHROME_PATH = process.env.CHROME_PATH || "google-chrome";
const root = resolve("dist");

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  return "application/octet-stream";
}

async function resolveRequest(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = relative
    ? [join(root, relative), join(root, `${relative}.html`), join(root, relative, "index.html")]
    : [join(root, "index.html")];
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (!resolved.startsWith(root)) continue;
    try {
      const info = await stat(resolved);
      if (info.isFile()) return resolved;
    } catch {}
  }
  return join(root, "404.html");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, HOST);
  const file = await resolveRequest(url.pathname);
  try {
    const body = await readFile(file);
    response.writeHead(file.endsWith("404.html") && url.pathname !== "/404" ? 404 : 200, {
      "content-type": contentType(file),
      "cache-control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end("preview error");
  }
});

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
        return;
      }
      for (const handler of this.handlers.get(message.method) || []) handler(message.params);
    });
  }

  call(method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) || [];
    list.push(handler);
    this.handlers.set(method, list);
    return () => this.handlers.set(method, (this.handlers.get(method) || []).filter((entry) => entry !== handler));
  }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  }
  return result.result?.value;
}

async function navigate(client, url) {
  const loaded = new Promise((resolvePromise) => {
    const off = client.on("Page.loadEventFired", () => {
      off();
      resolvePromise();
    });
    setTimeout(() => {
      off();
      resolvePromise();
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
  if (!homepageHtml.includes("Find food, shelter, health care and other essentials") || !homepageHtml.includes("/directory/help/food")) {
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
  const service = await fetch(`${HOST}/service/${sampleId}`);
  if (!service.ok) throw new Error(`Service detail route returned ${service.status}.`);
  const serviceHtml = await service.text();
  if (!serviceHtml.includes('"@type":"Service"') || !serviceHtml.includes("Visit original source")) {
    throw new Error("Service detail page is missing structured data or source handoff.");
  }
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-chaos-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--window-size=1440,1100",
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  chrome.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const wsUrl = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Chrome did not start. ${stderr}`)), 15000);
    chrome.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolvePromise(match[1]);
    });
    chrome.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before debugging was ready (${code}). ${stderr}`));
    });
  });

  const browserWs = new WebSocket(wsUrl);
  await new Promise((resolvePromise, reject) => {
    browserWs.once("open", resolvePromise);
    browserWs.once("error", reject);
  });
  const browser = new CdpClient(browserWs);

  try {
    await testStaticRoutes();

    const { targetId } = await browser.call("Target.createTarget", { url: "about:blank", width: 1440, height: 1100 });
    const { sessionId } = await browser.call("Target.attachToTarget", { targetId, flatten: true });
    const target = {
      call: (method, params = {}) => browser.call("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id: ++target.messageId, method, params })
      }),
      messageId: 0
    };

    const pending = new Map();
    browser.on("Target.receivedMessageFromTarget", ({ sessionId: incomingSessionId, message }) => {
      if (incomingSessionId !== sessionId) return;
      const payload = JSON.parse(message);
      if (payload.id) {
        const entry = pending.get(payload.id);
        if (!entry) return;
        pending.delete(payload.id);
        if (payload.error) entry.reject(new Error(payload.error.message));
        else entry.resolve(payload.result);
      }
    });

    target.call = (method, params = {}) => new Promise((resolvePromise, reject) => {
      const id = ++target.messageId;
      pending.set(id, { resolve: resolvePromise, reject });
      browser.call("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });

    await target.call("Page.enable");
    await target.call("Runtime.enable");
    await target.call("Accessibility.enable");
    await navigate(target, HOST);

    const ready = await evaluate(target, `new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (document.querySelector('.finder-intro') && document.querySelector('.globe-stage canvas')) return resolve(true);
        if (Date.now() - started > 12000) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`);
    if (!ready) throw new Error("Finder did not initialize within 12 seconds.");

    const layout = await evaluate(target, `(() => {
      const body = document.body;
      const html = document.documentElement;
      const globe = document.querySelector('.globe-stage');
      const sidebar = document.querySelector('.finder-sidebar');
      const results = document.querySelector('.results-section');
      return {
        bodyWidth: body.scrollWidth,
        viewportWidth: window.innerWidth,
        documentWidth: html.scrollWidth,
        globeHeight: globe?.getBoundingClientRect().height || 0,
        sidebarOverflowY: sidebar ? getComputedStyle(sidebar).overflowY : '',
        resultsRole: results?.getAttribute('role') || ''
      };
    })()`);
    if (layout.bodyWidth > layout.viewportWidth + 1 || layout.documentWidth > layout.viewportWidth + 1) {
      throw new Error(`Desktop layout overflows horizontally (${layout.bodyWidth}/${layout.documentWidth} > ${layout.viewportWidth}).`);
    }
    if (!layout.globeHeight) throw new Error("Globe has no rendered height.");
    if (layout.sidebarOverflowY === "auto" || layout.sidebarOverflowY === "scroll") {
      throw new Error("Finder sidebar still creates a nested scroll context.");
    }
    if (layout.resultsRole !== "region") throw new Error("Results are missing an accessible region role.");

    const searchResult = await evaluate(target, `(() => {
      const input = document.getElementById('resourceSearch');
      input.value = 'food';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise((resolve) => setTimeout(() => resolve({
        count: document.querySelectorAll('.resource-card,.resource-row').length,
        hasLink: Boolean(document.querySelector('.resource-deep-link[href^="/service/"]'))
      }), 200));
    })()`);
    if (!searchResult.count || !searchResult.hasLink) throw new Error("Search did not render permanent service links.");

    const unnamed = interactiveNodesWithoutNames((await target.call("Accessibility.getFullAXTree")).nodes || []);
    if (unnamed.length) throw new Error(`Found ${unnamed.length} interactive accessibility nodes without names.`);

    console.log("RWN browser chaos test passed: desktop, mobile, rapid search/filter churn, globe input, WebGL context loss, reduced motion, accessibility names, crawlable need/service routes, pagination, and compact data index.");
  } finally {
    browserWs.close();
    chrome.kill("SIGTERM");
    await sleep(100);
    try { await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 }); } catch {}
  }
}

server.listen(4173, "127.0.0.1", async () => {
  try {
    await run();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
