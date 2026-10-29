import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDirectoryStartupNavigationError } from "./qa-directory-startup.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withHomepageDeadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Read-only observations of the real homepage, worker and cached directory.
// The fixture never registers a worker or replaces application modules.
export async function homepageOfflineSnapshot() {
  const registrations = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
  const notice = document.getElementById("offlineDirectoryNotice");
  const names = "caches" in window ? await caches.keys() : [];
  const cachedPaths = [];
  for (const name of names.filter(name => name.startsWith("rwn-offline-"))) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) cachedPaths.push(new URL(request.url).pathname);
  }
  return {
    href: location.href, origin: location.origin, path: location.pathname,
    readyState: document.readyState, loadEventEnd: performance.getEntriesByType("navigation")[0]?.loadEventEnd || 0,
    secure: window.isSecureContext, online: navigator.onLine,
    registrations: registrations.map(registration => ({ scope: registration.scope, active: registration.active?.state || null, script: registration.active?.scriptURL || null })),
    controller: navigator.serviceWorker?.controller?.scriptURL || null,
    globe: Boolean(document.getElementById("globeCanvas")),
    professional: Boolean(document.body?.classList.contains("rwn-professional")),
    directory: Boolean(document.querySelector("[data-directory-search]")),
    records: document.querySelectorAll(".directory-records > .directory-record").length,
    noticeVisible: Boolean(notice && !notice.hidden && notice.getBoundingClientRect().height),
    networkState: notice?.dataset.networkState || null, noticeText: notice?.textContent || "",
    cachedDirectory: cachedPaths.includes("/directory"), cachedIndex: cachedPaths.includes("/data/search-index.json"),
    forbiddenCachedPaths: cachedPaths.filter(path => path.startsWith("/service/") || path.startsWith("/api/")),
    overflow: document.documentElement ? document.documentElement.scrollWidth - innerWidth : null,
    overlay: Boolean(document.querySelector("vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay"))
  };
}

export function assertHomepageDelayedLoad(state, origin, heldCount) {
  assert.equal(state.origin, origin);
  assert.equal(state.path, "/");
  assert.equal(state.readyState, "complete");
  assert.ok(state.loadEventEnd > 0 && heldCount > 0, "the real load event must precede release of the actual import");
  assert.ok(state.secure && state.online && state.globe && !state.professional && !state.overlay);
  assert.deepEqual(state.registrations, [], "the homepage must begin without a previous worker");
  assert.equal(state.controller, null);
  assert.equal(state.cachedDirectory, false);
}

export function assertHomepageWorkerReady(state, origin) {
  assert.equal(state.origin, origin);
  assert.equal(state.path, "/");
  assert.ok(state.secure && state.online && state.professional && state.cachedDirectory && !state.overlay);
  assert.deepEqual(state.registrations, [{ scope: `${origin}/`, active: "activated", script: `${origin}/sw.js` }]);
  assert.equal(state.controller, `${origin}/sw.js`);
  assert.equal(state.cachedIndex, false, "home-only startup must preserve lazy search-index caching");
  assert.deepEqual(state.forbiddenCachedPaths, []);
}

export function assertHomepageOfflineDirectory(state, origin) {
  assert.equal(state.origin, origin);
  assert.equal(state.path, "/directory");
  assert.equal(state.online, false);
  assert.equal(state.controller, `${origin}/sw.js`);
  assert.ok(state.directory && state.records > 0 && state.noticeVisible && !state.overlay);
  assert.equal(state.networkState, "offline");
  assert.match(state.noticeText, /Reconnect before traveling or relying on a listing/i);
  assert.ok(Number.isFinite(state.overflow) && state.overflow <= 8);
  assert.deepEqual(state.forbiddenCachedPaths, []);
}

export async function verifyHomepageOfflineStartup({ client, host, navigate, evaluate, capture, qaDir = "qa-screenshots" }) {
  const origin = new URL(host).origin;
  const held = [], documents = [], exceptions = [];
  const evidence = { origin, documents };
  const cleanupErrors = [];
  let holding = true, offline = false, interceptionError, primaryError;
  const call = (method, params) => withHomepageDeadline(client.call(method, params), 8000, `Homepage QA timed out at ${method}`);
  const navigateWithin = url => withHomepageDeadline(navigate(client, url, 0), 10000, `Homepage QA navigation timed out: ${url}`);
  const continueRequest = requestId => call("Fetch.continueRequest", { requestId });
  // Hold the first awaited installer: presentation must remain pending until
  // after the real load event, before bootstrap can register the worker.
  const offPaused = client.on("Fetch.requestPaused", ({ requestId, request }) => {
    const url = new URL(request.url);
    if (holding && url.origin === origin && url.pathname === "/src/professional.js") held.push(requestId);
    else continueRequest(requestId).catch(error => { interceptionError = error; });
  });
  const offRequests = client.on("Network.requestWillBeSent", ({ request, type }) => {
    if (type === "Document" && new URL(request.url).origin === origin) documents.push({ url: request.url, offline });
  });
  const offErrors = client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
  const state = () => evaluate(client, `(${homepageOfflineSnapshot})()`);
  const wait = async (predicate, message) => {
    const deadline = performance.now() + 15000;
    let latest;
    while (performance.now() < deadline) {
      if (interceptionError) throw interceptionError;
      try { latest = await withHomepageDeadline(state(), Math.min(8000, deadline - performance.now()), message); }
      catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; await sleep(75); continue; }
      if (predicate(latest)) return latest;
      await sleep(75);
    }
    throw new Error(`${message}: ${JSON.stringify({ latest, held: held.length, exceptions })}`);
  };
  try {
    await call("Fetch.enable", { patterns: [{ urlPattern: `${origin}/src/professional.js*`, requestStage: "Request" }] });
    await navigateWithin(`${origin}/`);
    evidence.delayed = await wait(s => s.origin === origin && s.path === "/" && s.loadEventEnd > 0 && s.globe && held.length > 0, "Homepage never finished loading with its import held");
    evidence.heldImports = held.length;
    assertHomepageDelayedLoad(evidence.delayed, origin, held.length);
    holding = false;
    await Promise.all(held.splice(0).map(continueRequest));
    await call("Fetch.disable");
    evidence.ready = await wait(s => s.professional && s.controller && s.cachedDirectory && s.registrations.some(registration => registration.active === "activated"), "Homepage failed to register and activate its offline worker after load");
    assertHomepageWorkerReady(evidence.ready, origin);
    assert.deepEqual(documents, [{ url: `${origin}/`, offline: false }], "no online directory navigation may prime the test");
    offline = true;
    await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" });
    await navigateWithin(`${origin}/directory`);
    evidence.offline = await wait(s => s.origin === origin && s.path === "/directory" && s.directory && s.networkState === "offline" && s.noticeVisible, "Home-primed directory did not render its offline warning");
    assertHomepageOfflineDirectory(evidence.offline, origin);
    assert.deepEqual(documents, [{ url: `${origin}/`, offline: false }, { url: `${origin}/directory`, offline: true }]);
    assert.deepEqual(exceptions, [], "homepage/offline navigation must not throw application exceptions");
    await withHomepageDeadline(capture(client, "homepage-offline-startup.png"), 8000, "Homepage offline screenshot timed out");
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanup = async (label, work) => {
      try { await withHomepageDeadline(work(), 10000, `${label} cleanup timed out`); }
      catch (error) { cleanupErrors.push({ label, message: error.message }); }
    };
    holding = false;
    await cleanup("held requests", () => Promise.all(held.splice(0).map(continueRequest)));
    await cleanup("request interception", () => call("Fetch.disable"));
    await cleanup("network restoration", () => call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }));
    offPaused(); offRequests(); offErrors();
    // This runner owns a fresh temporary profile. Restore its original cold
    // directory precondition before the existing independent offline journey.
    await cleanup("leave controlled document", () => navigateWithin("about:blank"));
    await cleanup("fresh directory state", () => call("Storage.clearDataForOrigin", { origin, storageTypes: "service_workers,cache_storage" }));
    await cleanup("evidence", async () => {
      await mkdir(qaDir, { recursive: true });
      await writeFile(join(qaDir, "homepage-offline-startup.json"), JSON.stringify({ ...evidence, exceptions, error: primaryError?.message, cleanupErrors }, null, 2));
    });
  }
  if (primaryError) throw primaryError;
  assert.deepEqual(cleanupErrors, [], "Homepage QA cleanup did not restore the original directory fixture");
  console.log("Homepage offline startup QA passed: real import held beyond load, cold-home worker activation, and first directory navigation fully offline with the cached-data warning.");
}
