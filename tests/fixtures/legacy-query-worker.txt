const CACHE_PREFIX = "rwn-offline-";
const CACHE_NAME = "rwn-offline-__RWN_OFFLINE_RELEASE__";

const CORE_ASSETS = [
  "/directory",
  "/legal.css",
  "/directory-enhancements.css",
  "/professional-pages.css",
  "/directory.js",
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

async function warmCore() {
  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all(CORE_ASSETS.map(async (path) => {
      const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
      if (!response || !response.ok || response.type === "opaque") {
        throw new Error(`Unable to cache required offline asset: ${path}`);
      }
      await putIfUsable(cache, path, response);
      if (!await cache.match(cacheKeyFor(path))) {
        throw new Error(`Required offline asset was not stored: ${path}`);
      }
    }));
  } catch (error) {
    // A partially warmed cache must never become the active offline release.
    await caches.delete(CACHE_NAME);
    throw error;
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
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (url.pathname.startsWith("/directory")) await putIfUsable(cache, request, response);
    return response;
  } catch {
    return await cache.match(cacheKeyFor(request))
      || await cache.match(cacheKeyFor("/directory"))
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const key = cacheKeyFor(request);
  const cached = await cache.match(key);
  const update = fetch(request)
    .then((response) => putIfUsable(cache, key, response))
    .catch(() => null);
  return cached || await update || new Response("Offline", { status: 503 });
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

  const cacheable = url.pathname === "/directory.js"
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

  if (cacheable) event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_RWN_OFFLINE") return;
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
  })());
});
