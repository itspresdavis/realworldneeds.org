import { SEARCH_CATALOG_SCHEMA } from "../public/catalog-request.js";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fresh temporary profile and loopback-only fixture server make this safe to
// run in CI: no production origin, catalog, browser profile or cache is touched.
const HOST = "http://127.0.0.1:4184";
const CDP_HOST = "http://127.0.0.1:9234";
const ARCHIVE = "rwn-offline-runtime-v1";
const LEGACY_RELEASE = "fixture-legacy-query";
const VARIANT_RELEASE = "fixture-hashed-next";
const FAILED_RELEASE = "fixture-hashed-failed";
const SAVED = JSON.stringify(["survivor", "removed"]);
const RUNTIME_PATTERN = /^\/(?:legal|page-menu|directory-enhancements|professional-pages|navigation-actions|directory|directory-startup|directory-geography|saved-loader|saved-services|offline-status)\.([a-f0-9]{12})\.(?:css|js)$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH or install a browser.");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1800);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.responses = new Map();
    this.resources = [];
    this.diagnosticEvents = [];
    this.requestURLs = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome DevTools connection timed out")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools connection failed")); }, { once: true });
    });
    this.ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
      }
    });
    this.on("Runtime.exceptionThrown", ({ exceptionDetails }) => this.diagnosticEvents.push({ type: "exception", message: exceptionDetails.exception?.description || exceptionDetails.text }));
    this.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (["error", "warning"].includes(type)) this.diagnosticEvents.push({ type, message: args.map((arg) => arg.description || arg.value || "").join(" ") });
    });
    this.on("Network.requestWillBeSent", ({ requestId, request }) => this.requestURLs.set(requestId, request.url));
    this.on("Network.loadingFailed", ({ requestId, errorText, type }) => this.diagnosticEvents.push({ type: "request-failed", resourceType: type, url: this.requestURLs.get(requestId), message: errorText }));
    this.on("Network.responseReceived", ({ response }) => {
      if (response.status >= 400) this.diagnosticEvents.push({ type: "http-error", url: response.url, status: response.status, fromServiceWorker: response.fromServiceWorker });
    });
    // Inspect the bytes Chrome actually applied/executed, rather than a second
    // fetch which could already have been repaired by stale-while-revalidate.
    this.on("Network.responseReceived", ({ requestId, type, response }) => {
      if (["Stylesheet", "Script"].includes(type)) this.responses.set(requestId, response);
    });
    this.on("Network.loadingFinished", ({ requestId }) => {
      const response = this.responses.get(requestId);
      if (!response) return;
      this.responses.delete(requestId);
      this.call("Network.getResponseBody", { requestId }).then(({ body, base64Encoded }) => {
        this.resources.push({ url: response.url, fromServiceWorker: Boolean(response.fromServiceWorker), hash: sha256(Buffer.from(body, base64Encoded ? "base64" : "utf8")) });
      }).catch((error) => this.resources.push({ url: response.url, error: error.message }));
    });
    await Promise.all([this.call("Page.enable"), this.call("Runtime.enable"), this.call("Network.enable")]);
    // The fixture server already sends no-store. Do not override request cache
    // modes through DevTools: offline catalog fallback deliberately distinguishes
    // ordinary reads from explicit reloads in both the frozen and current worker.
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: DevTools command timed out`));
      }, 25000);
      this.pending.set(id, { resolve, reject, method, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
    return () => this.listeners.set(method, listeners.filter((candidate) => candidate !== listener));
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser fixture closed"));
    }
    this.pending.clear();
    this.ws?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function waitExpression(client, expression, label) {
  await until(() => evaluate(client, expression), label);
}

async function navigate(client, url) {
  client.resources = [];
  const loaded = new Promise((resolve, reject) => {
    const off = client.on("Page.loadEventFired", () => { clearTimeout(timer); off(); resolve(); });
    const timer = setTimeout(() => { off(); reject(new Error(`Page load timed out: ${url}`)); }, 18000);
  });
  const result = await client.call("Page.navigate", { url });
  if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
  await loaded;
}

async function assertLoaded(client, path, bytes, fromServiceWorker) {
  const expected = sha256(bytes);
  try {
    await until(() => client.resources.some((entry) => new URL(entry.url).pathname === path && entry.hash === expected && (fromServiceWorker === undefined || entry.fromServiceWorker === fromServiceWorker)), `loaded byte identity for ${path}`);
  } catch (error) {
    throw new Error(`${error.message}; observed ${JSON.stringify(client.resources.filter((entry) => new URL(entry.url).pathname === path))}`);
  }
}

async function fetchHash(client, path) {
  return evaluate(client, `(async () => {
    const response = await fetch(${JSON.stringify(path)});
    const bytes = await response.arrayBuffer();
    return { status: response.status, hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("") };
  })()`);
}

async function startUpdate(client) {
  await evaluate(client, `(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    window.__updateResult = null;
    const observe = () => {
      const worker = registration.installing;
      if (!worker) return;
      const check = () => { if (["activated", "redundant"].includes(worker.state)) window.__updateResult = worker.state; };
      worker.addEventListener("statechange", check);
      check();
    };
    if (registration.installing) observe();
    else {
      registration.addEventListener("updatefound", observe, { once: true });
      registration.update().catch(error => { window.__updateResult ||= "error: " + error.message; });
    }
    return true;
  })()`);
}

async function state(client) {
  return evaluate(client, `({ documentId: window.__fixtureDocumentId, changes: window.__fixtureControllerChanges,
    sameController: window.__fixtureController === navigator.serviceWorker.controller,
    release: document.documentElement.dataset.fixtureRelease,
    css: getComputedStyle(document.documentElement).getPropertyValue("--fixture-release").trim(),
    savedModule: window.__fixtureSavedRelease || null,
    saved: localStorage.getItem("rwn-saved-resources"), unrelated: localStorage.getItem("fixture-unrelated"),
    rows: [...document.querySelectorAll("[data-saved-id]")].map(row => row.textContent),
    lazy: performance.getEntriesByType("resource").some(entry => /\\/saved-services(?:\\.[a-f0-9]{12})?\\.js/.test(new URL(entry.name).pathname)) })`);
}

function assertSaved(snapshot) {
  assert.equal(snapshot.saved, SAVED, "Saved IDs must remain byte-for-byte unchanged");
  assert.equal(snapshot.unrelated, "preserve-me", "Unrelated localStorage must survive");
}

async function waitActivated(client) {
  // controllerchange can precede completion of activate.waitUntil(). Do not
  // inspect cleanup/archive results, or prime the next release's catalog,
  // until activation and the controlling worker have both fully settled.
  await waitExpression(client, `(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === "activated"
      && navigator.serviceWorker.controller?.state === "activated";
  })()`, "active worker completed activation");
}

async function assertCaches(client, release, { allowLegacy = false } = {}) {
  await waitActivated(client);
  const snapshot = await evaluate(client, `(async () => {
    const result = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const entries = [];
      for (const key of await cache.keys()) {
        const url = new URL(key.url);
        const entry = { pathname: url.pathname, search: url.search };
        if (url.pathname === "/data/search-index.json") entry.catalog = await (await cache.match(key)).json();
        entries.push(entry);
      }
      result.push({ name, entries });
    }
    return result;
  })()`);
  const own = snapshot.filter(({ name }) => name.startsWith("rwn-offline-"));
  assert.deepEqual(own.map(({ name }) => name).sort(), [`rwn-offline-${release}`, ...(allowLegacy ? [] : [ARCHIVE])].sort(), "Only the active catalog release and bounded runtime archive may survive");
  for (const cache of own) {
    for (const entry of cache.entries) {
      assert.equal(entry.search, "", "Cached keys must not retain query/private data");
      if (cache.name === ARCHIVE) assert.match(entry.pathname, RUNTIME_PATTERN, "Runtime archive must never contain HTML, catalog or arbitrary paths");
      if (!allowLegacy && entry.catalog) assert.ok(!entry.catalog.records.some((record) => record.id === "removed"), "Withdrawn fixture must not survive catalog replacement");
    }
    if (cache.name === ARCHIVE) assert.ok(cache.entries.length <= 64, "Runtime archive must stay bounded");
  }
  assert.ok(snapshot.some(({ name }) => name === "unrelated-fixture"), "Unrelated caches must survive activation");
  return snapshot;
}

const record = (id, label) => ({ id, name: `Fixture ${id} (${label})`, place: "Synthetic test place", category: "food", categoryLabels: ["Food"], kind: "coverage", checked: "2026-10-10", search: `fixture ${id} food` });
const catalog = (label) => ({ schemaVersion: SEARCH_CATALOG_SCHEMA, records: [record("survivor", label), ...(label === "legacy" ? [record("removed", label)] : [])], scopes: {} });

function html(release, baseline = false) {
  const asset = (canonical) => baseline ? canonical : release.assets[canonical] || canonical;
  const token = encodeURIComponent(baseline ? "baseline-new-query" : release.id);
  return `<!doctype html><html lang="en" data-fixture-release="${release.label}"><head><meta charset="utf-8"><title>RWN runtime upgrade fixture</title>
${release.assetId ? `<meta name="rwn-offline-assets" content="${release.assetId}" />` : ""}
<link rel="stylesheet" href="${asset("/directory-enhancements.css")}?v=${token}">
${baseline ? "" : `<link rel="stylesheet" href="${asset("/saved-services.css")}?v=${token}">`}</head><body>
<script>window.__fixtureDocumentId = crypto.randomUUID(); window.__fixtureController = navigator.serviceWorker.controller; window.__fixtureControllerChanges = 0; navigator.serviceWorker.addEventListener("controllerchange", () => window.__fixtureControllerChanges++);</script>
<main class="directory-shell"><h1>Runtime release ${release.label}</h1><section class="directory-search-tools" data-directory-search><input aria-label="Search" data-directory-query><button data-directory-clear hidden>Clear</button><div data-directory-categories></div><p data-directory-count></p></section><section id="directory-results" class="directory-records"></section>
<section id="saved" class="saved-services" data-saved-services><div class="saved-services__heading"><h2 id="saved-services-heading" tabindex="-1">Saved services</h2><a href="#directory-results">Browse directory</a></div><p data-saved-summary role="status"></p><button data-saved-clear aria-expanded="false" hidden>Clear saved list</button><button data-saved-retry hidden>Try again</button><div data-saved-confirmation hidden><button data-saved-cancel>Keep list</button><button data-saved-confirm>Remove all</button></div><div data-saved-list></div><button data-saved-more hidden>Show more</button><p data-saved-status role="status"></p></section></main>
${baseline ? "" : `<script type="module" src="${asset("/directory.js")}?v=${token}"></script><script type="module" src="${asset("/saved-loader.js")}?v=${token}"></script>`}</body></html>`;
}

async function fixtures() {
  const info = JSON.parse(await readFile("dist/data/release.json", "utf8"));
  assert.equal(Object.keys(info.offlineAssets || {}).length, 12, "Build the contenthashed runtime assets before browser QA");
  assert.match(info.offlineRelease, /^[a-f0-9]{12}$/);
  assert.equal(info.offlineAssetRelease, sha256(JSON.stringify(info.offlineAssets)).slice(0, 12), "Built HTML/worker manifest identity must match");
  const source = await readFile("dist/sw.js", "utf8");
  const frozen = await readFile("tests/fixtures/legacy-query-worker.txt", "utf8");
  assert.equal(sha256(frozen), "91824c03ec63fc5172b1b6b352a32c38227fa6ec4c03e8a05671f7fe34ff2233", "Legacy baseline must remain the frozen b209762 production worker");
  const canonical = new Map();
  for (const path of [...Object.keys(info.offlineAssets), "/brand/rwn-logo-192.png", "/rwn-mark.svg", "/site.webmanifest"]) canonical.set(path, await readFile(`dist${path}`));
  const allHashed = new Map();
  for (const path of Object.values(info.offlineAssets)) {
    assert.match(path, RUNTIME_PATTERN);
    const bytes = await readFile(`dist${path}`);
    assert.equal(path.match(RUNTIME_PATTERN)[1], sha256(bytes).slice(0, 12), `Incorrect built content identity: ${path}`);
    assert.ok(source.includes(JSON.stringify(path)), `Built worker must warm ${path}`);
    allHashed.set(path, bytes);
  }
  const modern = { label: "modern", id: info.offlineRelease, assetId: info.offlineAssetRelease, assets: info.offlineAssets, canonical, worker: source };
  const legacyCanonical = new Map(canonical);
  legacyCanonical.set("/directory-enhancements.css", Buffer.concat([canonical.get("/directory-enhancements.css"), Buffer.from("\n:root{--fixture-release:legacy}\n")]));
  legacyCanonical.set("/saved-services.js", Buffer.concat([canonical.get("/saved-services.js"), Buffer.from('\nglobalThis.__fixtureSavedRelease = "legacy";\n')]));
  const legacy = { label: "legacy", id: LEGACY_RELEASE, assets: {}, canonical: legacyCanonical, worker: frozen.replaceAll("__RWN_OFFLINE_RELEASE__", LEGACY_RELEASE) };

  // One later synthetic release lets a real old module graph stay open across
  // activation and rollback. The main release above uses unmodified dist bytes.
  const variant = { label: "variant", id: VARIANT_RELEASE, assets: { ...modern.assets }, canonical: new Map(canonical) };
  const addVariant = (canonicalPath, bytes) => {
    const path = canonicalPath.replace(/\.(css|js)$/, `.${sha256(bytes).slice(0, 12)}.$1`);
    variant.assets[canonicalPath] = path;
    variant.canonical.set(canonicalPath, bytes);
    allHashed.set(path, bytes);
  };
  addVariant("/directory-enhancements.css", Buffer.concat([canonical.get("/directory-enhancements.css"), Buffer.from("\n:root{--fixture-release:variant}\n")]));
  addVariant("/saved-services.js", Buffer.concat([canonical.get("/saved-services.js"), Buffer.from('\nglobalThis.__fixtureSavedRelease = "variant";\n')]));
  const originalLoader = allHashed.get(modern.assets["/saved-loader.js"]).toString("utf8");
  assert.ok(originalLoader.includes(modern.assets["/saved-services.js"]), "Built loader must point at the contenthashed lazy module");
  addVariant("/saved-loader.js", Buffer.from(originalLoader.replaceAll(modern.assets["/saved-services.js"], variant.assets["/saved-services.js"])));
  // Canonical compatibility loader remains canonical, as in the real build.
  variant.canonical.set("/saved-loader.js", canonical.get("/saved-loader.js"));
  variant.assetId = sha256(JSON.stringify(variant.assets)).slice(0, 12);
  variant.worker = source.replaceAll(modern.id, variant.id).replaceAll(modern.assetId, variant.assetId);
  for (const path of Object.keys(modern.assets)) variant.worker = variant.worker.replaceAll(modern.assets[path], variant.assets[path]);
  const failed = { ...variant, id: FAILED_RELEASE, worker: variant.worker.replaceAll(variant.id, FAILED_RELEASE) };
  for (const release of [modern, variant, failed]) {
    assert.ok(release.worker.includes(`rwn-offline-${release.id}`));
    assert.ok(release.worker.includes(JSON.stringify(release.assetId)), "Fixture worker must share its HTML manifest identity");
    assert.ok(html(release).includes(`<meta name="rwn-offline-assets" content="${release.assetId}"`));
    for (const path of Object.values(release.assets)) assert.equal(sha256(allHashed.get(path)).slice(0, 12), path.match(RUNTIME_PATTERN)[1]);
  }
  return { modern, legacy, variant, failed, allHashed };
}

async function run() {
  const { modern, legacy, variant, failed, allHashed } = await fixtures();
  if (process.argv.includes("--check-fixture")) {
    console.log("RWN browser asset-upgrade fixture validated: frozen legacy worker, built manifest/byte identities and rehashed synthetic next-release graph. Browser scenarios were not executed.");
    return;
  }
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-asset-upgrade-"));
  let deployed = legacy, online = true, failedPath = null, gatePath = null;
  const held = [], requests = [];
  const send = (response, status, type, bytes) => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(bytes);
  };
  const serve = (response, pathname) => {
    if (pathname === "/sw.js") return send(response, 200, "text/javascript", deployed.worker);
    if (pathname === "/directory") return send(response, 200, "text/html", html(deployed));
    if (pathname === "/baseline") return send(response, 200, "text/html", html(deployed, true));
    if (pathname === "/data/search-index.json") return send(response, 200, "application/json", JSON.stringify(catalog(deployed.label)));
    const bytes = allHashed.get(pathname) || deployed.canonical.get(pathname);
    if (bytes) return send(response, 200, pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".png") ? "image/png" : pathname.endsWith(".svg") ? "image/svg+xml" : "application/manifest+json", bytes);
    // A misconfigured/static SPA fallback must never be accepted as hashed JS.
    if (pathname === "/saved-services.000000000000.js") return send(response, 200, "text/javascript", 'globalThis.__wrongHashExecuted = true;');
    send(response, 404, "text/plain", "Synthetic fixture route not found");
  };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, HOST).pathname;
    requests.push({ url: request.url, online, release: deployed.id });
    if (!online) { request.socket.destroy(); return; }
    if (pathname === failedPath) return send(response, 503, "text/plain", "Synthetic required-asset failure");
    if (pathname === gatePath) { held.push({ response, pathname }); return; }
    serve(response, pathname);
  });
  const releaseGate = () => {
    gatePath = null;
    for (const entry of held.splice(0)) serve(entry.response, entry.pathname);
  };
  let browser;
  const clients = [];
  const newTab = async () => {
    const response = await fetch(`${CDP_HOST}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    assert.ok(response.ok, "Could not create browser target");
    const client = new CdpClient((await response.json()).webSocketDebuggerUrl);
    clients.push(client);
    await client.connect();
    return client;
  };
  const openSaved = async (client) => {
    await evaluate(client, 'location.hash = "saved"');
    await until(async () => {
      const snapshot = await evaluate(client, '({ count: document.querySelectorAll("[data-saved-id]").length, summary: document.querySelector("[data-saved-summary]")?.textContent })');
      if (/could not open|details could not load|unavailable in this browser/.test(snapshot.summary || "")) throw new Error(`Saved-module fixture failed: ${snapshot.summary}`);
      return snapshot.count === 2;
    }, "saved production module rendered synthetic IDs");
    assertSaved(await state(client));
  };
  const primeCatalog = async (client, label) => {
    assert.equal(await evaluate(client, `(async () => { const response = await fetch("/data/search-index.json?search=PRIVATE-FIXTURE", { cache: "reload" }); return (await response.json()).records[0].name; })()`), `Fixture survivor (${label})`);
  };
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(4184, "127.0.0.1", resolve); });
    browser = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run", "--remote-debugging-port=9234", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
    await until(async () => { try { return (await fetch(`${CDP_HOST}/json/version`)).ok; } catch { return false; } }, "Chrome DevTools startup");
    const oldTab = await newTab();
    await navigate(oldTab, `${HOST}/directory`);
    await waitExpression(oldTab, "Boolean(navigator.serviceWorker.controller)", "frozen legacy worker controls old page");
    await waitActivated(oldTab);
    await evaluate(oldTab, `(async () => { localStorage.setItem("rwn-saved-resources", ${JSON.stringify(SAVED)}); localStorage.setItem("fixture-unrelated", "preserve-me"); const cache = await caches.open("unrelated-fixture"); await cache.put("/unrelated", new Response("keep")); })()`);
    await primeCatalog(oldTab, "legacy");
    online = false;
    await navigate(oldTab, `${HOST}/directory?offline=legacy#saved`);
    await openSaved(oldTab);
    assert.equal((await state(oldTab)).css, "legacy");
    assert.equal((await state(oldTab)).savedModule, "legacy");
    await assertCaches(oldTab, legacy.id, { allowLegacy: true });
    online = true;

    // Hold one required warm request. The new HTML must work while the frozen
    // query-normalizing worker still controls both navigation and lazy imports.
    deployed = modern;
    gatePath = modern.assets["/professional-pages.css"];
    await startUpdate(oldTab);
    await until(() => held.length > 0, "new worker install held before activation");
    const baseline = await newTab();
    await navigate(baseline, `${HOST}/baseline`);
    assert.equal((await state(baseline)).css, "legacy", "The fixture must reproduce the legacy query-only stale stylesheet bug");
    await assertLoaded(baseline, "/directory-enhancements.css", legacy.canonical.get("/directory-enhancements.css"), true);
    const newTabClient = await newTab();
    await navigate(newTabClient, `${HOST}/directory`);
    const first = await state(newTabClient);
    assert.equal(first.css, "", "New hashed CSS must bypass legacy canonical stale bytes");
    assert.equal(first.lazy, false, "Saved module must stay lazy until requested");
    assert.equal(first.changes, 0);
    assert.equal(first.sameController, true);
    await assertLoaded(newTabClient, modern.assets["/directory-enhancements.css"], allHashed.get(modern.assets["/directory-enhancements.css"]), false);
    await openSaved(newTabClient);
    await assertLoaded(newTabClient, modern.assets["/saved-services.js"], allHashed.get(modern.assets["/saved-services.js"]), false);
    const firstSaved = await state(newTabClient);
    assert.equal(firstSaved.savedModule, null, "Old canonical saved module must not execute under new hashed HTML");
    assert.equal(firstSaved.documentId, first.documentId, "First-navigation repair must not reload");
    assert.equal(firstSaved.changes, 0, "First-navigation repair must not wait for controllerchange");
    assert.ok(held.length, "Installation must still be blocked during first navigation/lazy loading");
    releaseGate();
    await waitExpression(newTabClient, "window.__fixtureControllerChanges === 1", "built worker activation");
    await waitActivated(newTabClient);
    await primeCatalog(newTabClient, "modern");
    await assertCaches(newTabClient, modern.id);
    assertSaved(await state(newTabClient));
    console.log("RWN first-navigation check passed: legacy query mismatch reproduced; new production CSS and lazy saved JS loaded exact hashed bytes before controller replacement, without reload.");

    // Leave an old modern page open with its lazy module still queued.
    await navigate(oldTab, `${HOST}/directory`);
    const oldModern = await state(oldTab);
    assert.equal(oldModern.lazy, false);
    online = false;
    await navigate(newTabClient, `${HOST}/directory?offline=modern#saved`);
    await openSaved(newTabClient);
    await assertLoaded(newTabClient, modern.assets["/saved-services.js"], allHashed.get(modern.assets["/saved-services.js"]), true);
    assert.equal((await state(newTabClient)).css, "");
    online = true;

    deployed = failed;
    failedPath = "/brand/rwn-logo-192.png";
    await startUpdate(oldTab);
    await waitExpression(oldTab, 'window.__updateResult === "redundant"', "failed required warm rejects candidate");
    assert.equal((await state(oldTab)).documentId, oldModern.documentId);
    assert.equal((await state(oldTab)).changes, 0, "Failed install must keep current controller");
    // Browsing newer HTML before its failed worker is ready must not poison
    // the older worker's known-good offline HTML or retain unknown hash bytes.
    await navigate(newTabClient, `${HOST}/directory?candidate=failed`);
    assert.equal((await state(newTabClient)).css, "variant");
    await assertLoaded(newTabClient, variant.assets["/directory-enhancements.css"], allHashed.get(variant.assets["/directory-enhancements.css"]), true);
    await waitExpression(newTabClient, '(async () => !(await navigator.serviceWorker.getRegistration()).installing)()', "failed retry finished before offline fallback");
    const afterFailure = await assertCaches(oldTab, modern.id);
    assert.ok(!afterFailure.filter(({ name }) => name.startsWith("rwn-offline-")).some(({ entries }) => entries.some(({ pathname }) => pathname === variant.assets["/directory-enhancements.css"])), "Unknown future bytes must not enter the active runtime caches");
    online = false;
    await navigate(newTabClient, `${HOST}/directory?offline=failed-candidate#saved`);
    await openSaved(newTabClient);
    assert.equal((await state(newTabClient)).release, "modern", "Failed new install must preserve previous release's offline HTML");
    assert.equal((await state(newTabClient)).css, "");
    assert.equal((await state(newTabClient)).savedModule, null);
    await assertLoaded(newTabClient, modern.assets["/saved-services.js"], allHashed.get(modern.assets["/saved-services.js"]), true);
    online = true;
    failedPath = null;
    deployed = variant;
    gatePath = variant.assets["/directory-enhancements.css"];
    await startUpdate(oldTab);
    await until(() => held.length > 0, "next release warm held for queued old asset");
    await evaluate(oldTab, 'window.__queuedLazy = new Promise(resolve => { window.__releaseLazy = resolve; }).then(() => { location.hash = "saved"; }); true');
    releaseGate();
    await waitExpression(oldTab, "window.__fixtureControllerChanges === 1", "next release controls retained old modern tab");
    await waitActivated(oldTab);
    await primeCatalog(oldTab, "variant");
    await assertCaches(oldTab, variant.id);
    online = false;
    await evaluate(oldTab, "window.__releaseLazy(); true");
    await openSaved(oldTab);
    await assertLoaded(oldTab, modern.assets["/saved-services.js"], allHashed.get(modern.assets["/saved-services.js"]), true);
    const retained = await state(oldTab);
    assert.equal(retained.documentId, oldModern.documentId, "Old queued module graph must survive activation without reload");
    assert.equal(retained.savedModule, null, "Old HTML must receive its exact old hashed lazy JS");
    assert.deepEqual(await fetchHash(oldTab, `${modern.assets["/directory-enhancements.css"]}?v=old&saved=PRIVATE-FIXTURE`), { status: 200, hash: sha256(allHashed.get(modern.assets["/directory-enhancements.css"])) });
    await navigate(newTabClient, `${HOST}/directory?offline=variant#saved`);
    await openSaved(newTabClient);
    const variantPage = await state(newTabClient);
    assert.equal(variantPage.css, "variant");
    assert.equal(variantPage.savedModule, "variant", "New tab must receive the new module while old tab keeps old graph");
    await assertLoaded(newTabClient, variant.assets["/saved-services.js"], allHashed.get(variant.assets["/saved-services.js"]), true);
    await assertCaches(newTabClient, variant.id);
    console.log("RWN offline/two-tab check passed: failed warm kept the active worker; retained old page and new page both loaded exact release assets offline, including queued lazy import.");

    online = true;
    deployed = modern;
    await startUpdate(newTabClient);
    await waitExpression(newTabClient, 'window.__updateResult === "activated"', "rollback to previous built worker");
    await waitActivated(newTabClient);
    await primeCatalog(newTabClient, "modern");
    assert.equal((await state(newTabClient)).documentId, variantPage.documentId, "Rollback must not reload already-open newer page");
    await assertCaches(newTabClient, modern.id);
    assert.equal((await fetchHash(newTabClient, "/saved-services.000000000000.js?search=PRIVATE-FIXTURE")).status, 503, "Worker must reject a successful HTTP response with wrong hashed bytes");
    online = false;
    assert.deepEqual(await fetchHash(newTabClient, `${variant.assets["/saved-services.js"]}?v=rollback&saved=PRIVATE-FIXTURE`), { status: 200, hash: sha256(allHashed.get(variant.assets["/saved-services.js"])) });
    await navigate(oldTab, `${HOST}/directory?offline=rollback#saved`);
    await openSaved(oldTab);
    assert.equal((await state(oldTab)).css, "");
    assert.equal((await state(oldTab)).savedModule, null);
    assertSaved(await state(newTabClient));
    await assertCaches(oldTab, modern.id);
    assert.ok(requests.filter(({ url }) => url.startsWith("/data/search-index.json")).every(({ url }) => !url.includes("?")), "Workers must not forward catalog query/private tokens");
    await mkdir("qa-screenshots", { recursive: true });
    const screenshot = await oldTab.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(join("qa-screenshots", "directory-asset-upgrade.png"), Buffer.from(screenshot.data, "base64"));
    console.log("RWN runtime asset upgrade browser QA passed: legacy returning visitor, first navigation, lazy loading, failed install, offline old/new tabs, rollback, integrity rejection, catalog purge, query-free bounded archive and unchanged saved IDs.");
  } catch (error) {
    // Preserve actionable evidence even when failure occurs before the final
    // screenshot. These pages and cache contents contain synthetic data only.
    await mkdir("qa-screenshots", { recursive: true });
    for (const [index, client] of clients.entries()) {
      try {
        const page = await evaluate(client, `(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          const storage = [];
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            const index = await cache.match("/data/search-index.json");
            storage.push({ name, urls: (await cache.keys()).map(key => key.url), catalog: index ? await index.text() : null });
          }
          return { url: location.href, title: document.title, body: document.body?.innerText.slice(0, 5000),
            saved: localStorage.getItem("rwn-saved-resources"), savedModule: window.__fixtureSavedRelease || null,
            savedCount: document.querySelectorAll("[data-saved-id]").length, savedSummary: document.querySelector("[data-saved-summary]")?.textContent,
            retryHidden: document.querySelector("[data-saved-retry]")?.hidden, css: getComputedStyle(document.documentElement).getPropertyValue("--fixture-release").trim(),
            controllerChanges: window.__fixtureControllerChanges, documentId: window.__fixtureDocumentId,
            controller: navigator.serviceWorker.controller?.state, installing: registration?.installing?.state,
            waiting: registration?.waiting?.state, active: registration?.active?.state,
            scripts: [...document.scripts].map(script => script.src).filter(Boolean), storage };
        })()`);
        const details = { page, resources: client.resources, events: client.diagnosticEvents.slice(-80), serverRequests: requests.slice(-100) };
        await writeFile(join("qa-screenshots", `directory-asset-upgrade-failure-${index}.json`), `${JSON.stringify(details, null, 2)}\n`);
        console.error(`RWN asset-upgrade failure tab ${index}: ${JSON.stringify(details)}`);
        const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
        await writeFile(join("qa-screenshots", `directory-asset-upgrade-failure-${index}.png`), Buffer.from(data, "base64"));
      } catch (diagnosticError) {
        console.error(`Could not capture fixture tab ${index}: ${diagnosticError.message}`);
      }
    }
    throw error;
  } finally {
    releaseGate();
    for (const client of clients) client.close();
    await stopProcess(browser);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 125 });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
