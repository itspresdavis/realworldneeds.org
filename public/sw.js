const CACHE_PREFIX = "rwn-offline-";
const CACHE_NAME = "rwn-offline-__RWN_OFFLINE_RELEASE__";
const RUNTIME_CACHE = "rwn-offline-runtime-v1";
const RUNTIME_LIMIT = 64;
const RUNTIME_ASSETS = /* __RWN_RUNTIME_ASSETS__ */ {};
const RUNTIME_ID = /* __RWN_RUNTIME_ID__ */ "";
const runtimePaths = Object.values(RUNTIME_ASSETS);
const runtimePattern = /^\/(?:legal|page-menu|directory-enhancements|professional-pages|directory|directory-startup|saved-loader|saved-services|offline-status)\.([a-f0-9]{12})\.(?:css|js)$/;

const CORE_ASSETS = [
  "/directory",
  "/legal.css",
  "/page-menu.js",
  "/directory-enhancements.css",
  "/professional-pages.css",
  "/directory.js",
  "/directory-startup.js",
  "/saved-loader.js",
  "/saved-services.js",
  "/saved-services.css",
  "/offline-status.js",
  "/brand/rwn-logo-192.png",
  "/rwn-mark.svg",
  "/site.webmanifest"
];

// The index is useful after a visitor opens the directory, but it should not
// delay or invalidate a first offline installation on a constrained network.
const LAZY_DIRECTORY_ASSETS = ["/data/search-index.json"];

const cacheKeyFor = (requestOrUrl) => {
  const url = new URL(typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url, self.location.origin);
  return new Request(`${url.origin}${url.pathname}`);
};

async function putIfUsable(cache, key, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  await cache.put(cacheKeyFor(key), response.clone());
  return response;
}

async function verifiedRuntime(response, path) {
  if (!response?.ok || response.type === "opaque") return false;
  const expected = path.match(runtimePattern)?.[1];
  if (!expected) return false;
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 12);
  return actual === expected;
}

async function compatibleNavigation(response) {
  if (!RUNTIME_ID) return true;
  if (!response?.ok) return false;
  return (await response.clone().text()).includes(`<meta name="rwn-offline-assets" content="${RUNTIME_ID}"`);
}

async function warmCore() {
  const cache = await caches.open(CACHE_NAME);
  try {
    // Wait for every writer before removing a failed candidate cache.
    const results = await Promise.allSettled([...CORE_ASSETS, ...runtimePaths].map(async (path) => {
      const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
      if (!response || !response.ok || response.type === "opaque"
        || (path === "/directory" && !await compatibleNavigation(response))
        || (runtimePaths.includes(path) && !await verifiedRuntime(response, path))) {
        throw new Error(`Unable to cache required offline asset: ${path}`);
      }
      await putIfUsable(cache, path, response);
      if (!await cache.match(cacheKeyFor(path))) {
        throw new Error(`Required offline asset was not stored: ${path}`);
      }
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  } catch (error) {
    // A partially warmed cache must never become the active offline release.
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function archiveRuntime() {
  if (!runtimePaths.length) return;
  const archive = await caches.open(RUNTIME_CACHE);
  const current = await caches.open(CACHE_NAME);
  for (const path of runtimePaths) {
    const key = cacheKeyFor(path);
    const response = await current.match(key).catch(() => null);
    if (response) await archive.put(key, response).catch(() => {});
  }
  const keys = await archive.keys();
  let excess = keys.length - RUNTIME_LIMIT;
  for (const key of keys) {
    const path = new URL(key.url).pathname;
    if (!runtimePattern.test(path) || (excess > 0 && !runtimePaths.includes(path))) {
      await archive.delete(key);
      excess -= 1;
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await warmCore();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Keep a bounded archive of code/styles for already-open older pages.
    // No HTML, catalog, searches or saved items are copied into this cache.
    await archiveRuntime().catch(() => {});
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME && name !== RUNTIME_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  try {
    const response = await fetch(request);
    if (cache && (url.pathname === "/directory" || url.pathname.startsWith("/directory/"))
      && await compatibleNavigation(response)) await putIfUsable(cache, request, response).catch(() => {});
    return response;
  } catch {
    return await cache?.match(cacheKeyFor(request)).catch(() => null)
      || await cache?.match(cacheKeyFor("/directory")).catch(() => null)
      || new Response(
        "Real World Needs is offline. Reconnect to refresh the directory.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
  }
}

// A catalog can lose public records between releases. Always bypass HTTP
// copies, and let only the newest request replace this release's offline copy.
// Explicit reloads from a replaced controller must never fall back to old data.
let directoryRequest = 0;
let directoryWrite = Promise.resolve();
async function directoryIndex(request) {
  const generation = ++directoryRequest;
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  try {
    const response = await fetch(cacheKeyFor(request), { cache: "reload", credentials: "same-origin" });
    if (response.ok) {
      if (cache) {
        directoryWrite = directoryWrite.catch(() => {}).then(async () => {
          if (generation === directoryRequest) await putIfUsable(cache, request, response);
        });
        await directoryWrite.catch(() => {});
      }
      return response;
    }
    if (request.cache === "reload") return response;
  } catch (error) {
    if (request.cache === "reload") throw error;
  }
  const saved = cache ? await cache.match(cacheKeyFor(request)).catch(() => null) : null;
  return saved || new Response("Directory unavailable", { status: 503 });
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  const key = cacheKeyFor(request);
  const cached = await cache?.match(key).catch(() => null);
  const update = fetch(request)
    .then(async (response) => {
      if (cache) await putIfUsable(cache, key, response).catch(() => {});
      return response;
    })
    .catch(() => null);
  event.waitUntil?.(update);
  return cached || await update || new Response("Offline", { status: 503 });
}

async function immutableRuntime(request) {
  const key = cacheKeyFor(request);
  const path = new URL(key.url).pathname;
  let currentCache;
  for (const name of [CACHE_NAME, RUNTIME_CACHE]) {
    const cache = await caches.open(name).catch(() => null);
    if (name === CACHE_NAME) currentCache = cache;
    const saved = await cache?.match(key).catch(() => null);
    if (saved) return saved;
  }
  try {
    const response = await fetch(request);
    if (!await verifiedRuntime(response, path)) return new Response("Asset version unavailable", { status: 503 });
    // Only this release's manifest can add entries. Unknown/older versions can
    // use the bounded archive, but cannot fill it with arbitrary URL variants.
    if (runtimePaths.includes(path) && currentCache) {
      // Keep the original handle: an old in-flight request must not recreate
      // its retired release cache after another worker has activated.
      await putIfUsable(currentCache, key, response).catch(() => {});
    }
    return response;
  } catch {
    return new Response("Offline asset unavailable", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/workspace" || url.pathname === "/join") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (LAZY_DIRECTORY_ASSETS.includes(url.pathname)) {
    event.respondWith(directoryIndex(request));
    return;
  }

  if (runtimePattern.test(url.pathname)) {
    event.respondWith(immutableRuntime(request));
    return;
  }

  const cacheable = url.pathname === "/page-menu.js"
    || url.pathname === "/directory.js"
    || url.pathname === "/saved-loader.js"
    || url.pathname === "/saved-services.js"
    || url.pathname === "/saved-services.css"
    || url.pathname === "/offline-status.js"
    || url.pathname === "/directory-enhancements.css"
    || url.pathname === "/professional-pages.css"
    || url.pathname === "/legal.css"
    || url.pathname === "/brand/rwn-logo-192.png"
    || url.pathname === "/rwn-mark.svg"
    || url.pathname === "/site.webmanifest";

  if (cacheable) event.respondWith(staleWhileRevalidate(request, event));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_RWN_OFFLINE") return;
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
  })());
});
