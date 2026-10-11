import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const HOST = "http://127.0.0.1:4178";
const CDP_PORT = 9228;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const QA_DIR = "qa-screenshots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH or install a browser.");
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
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
  }

  close() { this.ws?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function navigate(client, url, settleMs = 500) {
  const loaded = new Promise((resolve) => {
    const off = client.on("Page.loadEventFired", () => { off(); resolve(); });
    setTimeout(() => { off(); resolve(); }, 6000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(settleMs);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

// Serve only synthetic catalog rows, using the production directory entry and
// worker. No real record, source-hidden address, or production cache is touched.
const fixtureRecord = (id) => ({ id, name: `Fixture ${id}`, place: "Synthetic test place", category: "food", categoryLabels: ["Food"], kind: "coverage", checked: "2026-10-10", search: `fixture ${id} food` });
const fixtureCatalog = (removed) => ({ records: [fixtureRecord("survivor"), ...(removed ? [fixtureRecord("removed")] : [])], scopes: {} });
const fixtureHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Directory upgrade fixture</title><body>
<main class="directory-shell"><section data-directory-search><input aria-label="Search" data-directory-query><button data-directory-clear hidden>Clear</button><div data-directory-categories></div><p data-directory-count></p></section><section class="directory-records"></section></main>
<script type="module" src="/directory.js?v=fixture-initial"></script></body></html>`;

async function waitExpression(client, expression, label) {
  return evaluate(client, `(async () => {
    for (let i = 0; i < 200; i += 1) {
      if (${expression}) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(${JSON.stringify(`Timed out: ${label}`)});
  })()`);
}

async function updateWorker(client) {
  return evaluate(client, `(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const settled = new Promise(resolve => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        const check = () => { if (["activated", "redundant"].includes(worker.state)) resolve(worker.state); };
        worker.addEventListener("statechange", check);
        check();
      }, { once: true });
    });
    await registration.update();
    return Promise.race([settled, new Promise((_, reject) => setTimeout(() => reject(new Error("Worker update timed out")), 12000))]);
  })()`);
}

async function pageState(client) {
  return evaluate(client, `(async () => {
    const input = document.querySelector("[data-directory-query]");
    return {
      text: input.value,
      category: document.querySelector('[data-directory-category="Food"]')?.getAttribute("aria-pressed"),
      focused: document.activeElement === input,
      selection: [input.selectionStart, input.selectionEnd],
      marker: window.__fixtureSession,
      controllers: window.__fixtureControllers,
      ids: [...document.querySelectorAll(".directory-global-result")].map(a => new URL(a.href).pathname),
      status: document.querySelector("[data-directory-count]").textContent,
      caches: await caches.keys()
    };
  })()`);
}

function assertPreserved(state) {
  if (state.text !== "fixture" || state.category !== "true" || !state.focused || state.selection.join(",") !== "2,4" || state.marker !== "preserved") {
    throw new Error(`Controller replacement lost user state or reloaded the page: ${JSON.stringify(state)}`);
  }
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-cache-upgrade-"));
  const swSource = await readFile("public/sw.js", "utf8");
  const fixtureFiles = new Map();
  for (const path of ["directory.js", "legal.css", "directory-enhancements.css", "professional-pages.css", "offline-status.js", "brand/rwn-logo-192.png", "rwn-mark.svg", "site.webmanifest"]) {
    fixtureFiles.set(`/${path}`, await readFile(`dist/${path}`));
  }
  let release = "fixture-old", includeRemoved = true, failedCore = null, failIndex = false;
  const indexRequests = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, HOST).pathname;
    if (pathname === failedCore) { response.writeHead(503); response.end("Synthetic required-asset failure"); return; }
    if (pathname === "/sw.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(swSource.replaceAll("__RWN_OFFLINE_RELEASE__", release));
      return;
    }
    if (pathname === "/data/search-index.json") {
      indexRequests.push(request.url);
      response.writeHead(failIndex ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" });
      response.end(failIndex ? "{}" : JSON.stringify(fixtureCatalog(includeRemoved)));
      return;
    }
    if (pathname === "/directory") {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end(fixtureHtml); return;
    }
    if (fixtureFiles.has(pathname)) {
      const type = pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".png") ? "image/png" : pathname.endsWith(".svg") ? "image/svg+xml" : "application/manifest+json";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(fixtureFiles.get(pathname)); return;
    }
    response.writeHead(404); response.end("Fixture route not found");
  });
  let browser, client;
  try {
    await new Promise((done, fail) => { server.once("error", fail); server.listen(4178, "127.0.0.1", done); });
    browser = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    await waitFor(`${CDP_HOST}/json/version`);
    const targetResponse = await fetch(`${CDP_HOST}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Could not create browser target: ${targetResponse.status}`);
    client = new CdpClient((await targetResponse.json()).webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable"), client.call("Network.enable")]);
    await navigate(client, `${HOST}/directory`);
    await waitExpression(client, "Boolean(navigator.serviceWorker.controller)", "first worker control");
    await evaluate(client, `(() => { const input = document.querySelector("[data-directory-query]"); input.focus(); input.value = "fixture"; input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await waitExpression(client, 'document.querySelectorAll(".directory-global-result").length === 2', "initial synthetic results");
    await evaluate(client, `(() => { document.querySelector('[data-directory-category="Food"]').click(); const input = document.querySelector("[data-directory-query]"); input.focus(); input.setSelectionRange(2,4); window.__fixtureSession = "preserved"; window.__fixtureControllers = 0; navigator.serviceWorker.addEventListener("controllerchange", () => { window.__fixtureControllers += 1; }); })()`);
    await evaluate(client, `(async () => { const unrelated = await caches.open("unrelated-fixture"); await unrelated.put("/other", new Response("keep")); })()`);
    await waitExpression(client, 'document.querySelectorAll(".directory-global-result").length === 2', "selected category results");
    assertPreserved(await pageState(client));

    release = "fixture-failed"; failedCore = "/directory.js";
    if (await updateWorker(client) !== "redundant") throw new Error("Incomplete worker unexpectedly activated");
    const failed = await pageState(client);
    assertPreserved(failed);
    if (failed.controllers !== 0 || failed.ids.length !== 2 || !failed.caches.includes("rwn-offline-fixture-old") || failed.caches.includes("rwn-offline-fixture-failed")) {
      throw new Error(`Failed install did not preserve only the complete old release: ${JSON.stringify(failed)}`);
    }

    failedCore = null; release = "fixture-new"; includeRemoved = false; failIndex = true;
    if (await updateWorker(client) !== "activated") throw new Error("Complete replacement did not activate");
    await waitExpression(client, 'document.querySelector("[data-directory-count]").textContent.includes("temporarily unavailable")', "safe refresh failure");
    const unavailable = await pageState(client);
    assertPreserved(unavailable);
    if (unavailable.controllers !== 1 || unavailable.ids.length || unavailable.caches.includes("rwn-offline-fixture-old") || !unavailable.caches.includes("unrelated-fixture")) {
      throw new Error(`Failed refresh restored old results or purged unrelated data: ${JSON.stringify(unavailable)}`);
    }

    failIndex = false;
    await evaluate(client, 'window.dispatchEvent(new Event("online"))');
    await waitExpression(client, 'document.querySelectorAll(".directory-global-result").length === 1', "refresh recovery");
    const recovered = await pageState(client);
    assertPreserved(recovered);
    if (recovered.ids[0] !== "/service/survivor") throw new Error(`Removed fixture returned: ${JSON.stringify(recovered)}`);

    release = "fixture-next";
    if (await updateWorker(client) !== "activated") throw new Error("Repeated replacement did not activate");
    await waitExpression(client, 'window.__fixtureControllers === 2 && document.querySelectorAll(".directory-global-result").length === 1', "repeated replacement");
    const repeated = await pageState(client);
    assertPreserved(repeated);
    if (repeated.ids[0] !== "/service/survivor" || repeated.caches.filter(name => name.startsWith("rwn-offline-")).join() !== "rwn-offline-fixture-next") {
      throw new Error(`Repeated replacement retained an old release: ${JSON.stringify(repeated)}`);
    }
    if (indexRequests.some(url => url.includes("?"))) throw new Error(`Worker forwarded a stale versioned index URL: ${JSON.stringify(indexRequests)}`);
    await capture(client, "directory-cache-upgrade.png");
    console.log("RWN synthetic browser upgrade QA passed: failed install preserves the old worker; complete replacement removes only old RWN caches; failed catalog refresh hides old search results; reconnection recovers without the withdrawn fixture; query, category, focus and selection survive repeated upgrades without reloads.");
  } finally {
    client?.close();
    await stopProcess(browser);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 125 });
  }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
