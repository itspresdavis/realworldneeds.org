import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(path, "utf8");

test("offline directory caches only public same-origin essentials", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /const CACHE_PREFIX = "rwn-offline-"/);
  assert.match(sw, /__RWN_OFFLINE_RELEASE__/);
  assert.match(sw, /"\/directory"/);
  const coreAssets = sw.slice(sw.indexOf("const CORE_ASSETS"), sw.indexOf("];", sw.indexOf("const CORE_ASSETS")));
  assert.doesNotMatch(coreAssets, /search-index/);
  assert.match(sw, /const LAZY_DIRECTORY_ASSETS = \["\/data\/search-index\.json"\]/);
  assert.match(sw, /"\/offline-status\.js"/);
  assert.match(sw, /"\/professional-pages\.css"/);
  assert.match(sw, /"\/brand\/rwn-logo-192\.png"/);
  assert.match(sw, /"\/site\.webmanifest"/);
  await read("public/site.webmanifest");
  await read("public/professional-pages.css");
  const logo = await readFile("public/brand/rwn-logo-192.png");
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "offline brand asset must remain a real PNG");
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /new Request\(`\$\{url\.origin\}\$\{url\.pathname\}`\)/);
  assert.doesNotMatch(sw, /localStorage|sessionStorage|searchParams\.get\(|URLSearchParams/);
});

test("offline registration is non-blocking and clear-browser-data removes offline caches", async () => {
  const bootstrap = await read("src/bootstrap.js");
  const directory = await read("public/directory.js") + await read("public/directory-results.js") + await read("scripts/enhance-generated-pages.mjs");
  assert.match(bootstrap, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(directory, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(bootstrap, /name\.startsWith\("rwn-offline-"\)/);
  assert.match(bootstrap, /CLEAR_RWN_OFFLINE/);
  assert.match(bootstrap, /\.catch\(\(\) => \{\}\)/);
});

test("offline directory clearly warns that availability and service pages require reconnection", async () => {
  const directory = await read("public/directory.js") + await read("public/directory-results.js") + await read("scripts/enhance-generated-pages.mjs");
  assert.match(directory, /offlineDirectoryNotice/);
  assert.match(directory, /Offline mode\./);
  assert.match(directory, /current availability and service-detail pages require a connection/);
  assert.match(directory, /Reconnect before traveling or relying on a listing/);
  assert.match(directory, /reconnect for full details/);
});

test("directory connectivity is based on a real uncached same-origin probe", async () => {
  const probe = await read("public/offline-status.js");
  assert.match(probe, /const PROBE_URL = "\/data\/release\.json"/);
  assert.match(probe, /cache:\s*"no-store"/);
  assert.match(probe, /credentials:\s*"same-origin"/);
  assert.match(probe, /X-RWN-Connectivity-Probe/);
  assert.match(probe, /catch[\s\S]*?setOffline\(true\)/);
  assert.match(probe, /event\.preventDefault\(\)/);
  assert.match(probe, /event\.stopImmediatePropagation\(\)/);
  assert.match(probe, /window\.addEventListener\("online", probe\)/);
  assert.match(probe, /window\.addEventListener\("offline"/);
  assert.match(probe, /element\.textContent !== value/);
  assert.doesNotMatch(probe, /localStorage|sessionStorage|sendBeacon|XMLHttpRequest/);
});

test("every generated directory page loads the hashed connectivity probe", async () => {
  const page = await read("dist/directory/help/food/index.html");
  assert.match(page, /src="\/offline-status\.[a-f0-9]{12}\.js\?v=[a-f0-9]{12}"/);
  const release = JSON.parse(await read("dist/data/release.json"));
  assert.match(release.directoryResilienceRelease || "", /^[a-f0-9]{12}$/);
});

test("offline cache IDs rotate with release inputs and purge older RWN caches", async () => {
  const worker = await read("dist/sw.js");
  const sourceWorker = await read("public/sw.js");
  const release = JSON.parse(await read("dist/data/release.json"));
  assert.match(sourceWorker, /rwn-offline-__RWN_OFFLINE_RELEASE__/);
  assert.match(worker, /const CACHE_NAME = "rwn-offline-[a-f0-9]{12}"/);
  assert.doesNotMatch(worker, /__RWN_OFFLINE_RELEASE__/);
  assert.match(release.offlineRelease || "", /^[a-f0-9]{12}$/);
  assert.match(worker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
});

async function runInstall({ failedPath = null } = {}) {
  const handlers = new Map();
  const stored = new Map();
  let skipped = false;
  let deleted = false;
  const source = await read("public/sw.js");
  const cache = {
    async put(key, response) { stored.set(key.url, response); },
    async match(key) { return stored.get(key.url); },
  };
  const context = {
    URL,
    Request,
    Response,
    console,
    self: {
      location: { origin: "https://rwn.test" },
      addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() { skipped = true; },
    },
    caches: {
      async open() { return cache; },
      async delete() { deleted = true; stored.clear(); return true; },
      async keys() { return []; },
    },
    async fetch(path) {
      if (path === failedPath) return new Response("missing", { status: 503 });
      return new Response("ok", { status: 200 });
    },
  };
  vm.runInNewContext(source, context, { filename: "sw.js" });
  let installPromise;
  handlers.get("install")({ waitUntil(promise) { installPromise = promise; } });
  try {
    await installPromise;
    return { error: null, skipped, deleted, stored };
  } catch (error) {
    return { error, skipped, deleted, stored };
  }
}

test("offline installation fails closed and removes a partial cache when a required core asset fails", async () => {
  for (const failedPath of ["/directory.js", "/directory-startup.js", "/page-menu.js", "/navigation-actions.css", "/language.js", "/task-controls.css"]) {
  const result = await runInstall({ failedPath });
  assert.ok(result.error, "a failed required asset must reject installation");
  assert.equal(result.skipped, false, "an incomplete cache must never activate");
  assert.equal(result.deleted, true, "partial core cache must be removed");
  assert.equal(result.stored.size, 0, "partial core cache must not remain available");
  }
});

test("offline installation activates only after every required core asset is cached", async () => {
  const result = await runInstall();
  assert.equal(result.error, null);
  assert.equal(result.deleted, false);
  assert.equal(result.skipped, true, "a complete cache can activate immediately");
  assert.deepEqual([...result.stored.keys()].map(url => new URL(url).pathname).sort(), [
    "/directory", "/legal.css", "/page-menu.js", "/directory-enhancements.css",
    "/professional-pages.css", "/navigation-actions.css", "/directory.js",
    "/directory-startup.js", "/saved-loader.js", "/saved-services.js",
    "/saved-services.css", "/offline-status.js", "/language.js", "/task-controls.css",
    "/brand/rwn-logo-192.png", "/rwn-mark.svg", "/site.webmanifest"
  ].sort(), "only the explicit public core is stored; optional postal data is not installed");
});

test("production CSP permits only same-origin workers and service worker revalidates", async () => {
  const config = JSON.parse(await read("vercel.json"));
  const catchAll = config.headers.find((entry) => entry.source === "/(.*)");
  const worker = config.headers.find((entry) => entry.source === "/sw.js");
  assert.ok(catchAll, "catch-all security headers missing");
  assert.ok(worker, "service worker cache policy missing");
  const csp = catchAll.headers.find((header) => header.key === "Content-Security-Policy")?.value || "";
  assert.match(csp, /worker-src 'self'/);
  assert.doesNotMatch(csp, /worker-src \*/);
  const cacheControl = worker.headers.find((header) => header.key === "Cache-Control")?.value || "";
  assert.match(cacheControl, /no-cache/);
  assert.match(cacheControl, /no-store/);
});

test("privacy notice accurately describes offline storage boundaries", async () => {
  const privacy = await read("public/privacy.html");
  assert.match(privacy, /Low-connectivity and offline directory files/);
  assert.match(privacy, /does <strong>not<\/strong> cache RWN API requests/);
  assert.match(privacy, /does not store the words you type into search/);
  assert.match(privacy, /does not intentionally cache individual service-detail pages/);
  assert.match(privacy, /Cache keys discard URL query strings/);
  assert.match(privacy, /Clear browser data/);
});

test("built site publishes the offline worker", async () => {
  const sw = await read("dist/sw.js");
  assert.match(sw, /networkFirstNavigation/);
  assert.match(sw, /staleWhileRevalidate/);
  assert.match(sw, /professional-pages\.css/);
  assert.match(sw, /brand\/rwn-logo-192\.png/);
  assert.match(sw, /site\.webmanifest/);
});

for (const failedPath of ["/saved-loader.js", "/saved-services.js", "/saved-services.css"]) {
  test(`offline release does not activate with missing saved-list asset ${failedPath}`, async () => {
    const result = await runInstall({ failedPath });
    assert.ok(result.error);
    assert.equal(result.skipped, false);
    assert.equal(result.deleted, true);
  });
}
