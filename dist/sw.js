const CACHE_PREFIX = "rwn-offline-";
const CACHE_NAME = "rwn-offline-ce40eb9013c9";

const CORE_ASSETS = [
  "/directory",
  "/legal.css",
  "/directory-enhancements.css",
  "/professional-pages.css",
  "/directory.js",
  "/offline-status.js",
  "/data/search-index.json",
  "/brand/rwn-logo-192.png",
  "/rwn-mark.svg",
  "/site.webmanifest"
];

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
  await Promise.allSettled(CORE_ASSETS.map(async (path) => {
    const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
    await putIfUsable(cache, path, response);
  }));
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
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const cacheable = url.pathname === "/data/search-index.json"
    || url.pathname === "/directory.js"
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
