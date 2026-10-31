const CACHE_PREFIX = "rwn-offline-";
const CACHE_NAME = "rwn-offline-f8b541b70911";
const RUNTIME_CACHE = "rwn-offline-runtime-v1";
const RUNTIME_LIMIT = 64;
const RUNTIME_ASSETS = {"/legal.css":"/legal.3bebea0b2a8a.css","/page-menu.js":"/page-menu.6d6faf5fed89.js","/directory-enhancements.css":"/directory-enhancements.6c78998a8372.css","/professional-pages.css":"/professional-pages.7c6ec93aa02c.css","/directory.js":"/directory.b304f66a8fa6.js","/directory-startup.js":"/directory-startup.304f4643d7a3.js","/saved-services.js":"/saved-services.aecabb62cfae.js","/saved-services.css":"/saved-services.00b86be01834.css","/offline-status.js":"/offline-status.ab80b921000e.js","/saved-loader.js":"/saved-loader.c4013edc384b.js"};
const RUNTIME_ID = "575f16af3a90";
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

// Bound directory recovery across both headers and the complete HTML body.
// A timed-out response is never allowed to enter the cache write queue.
async function completeNavigationResponse(request) {
  const controller = new AbortController();
  let reader, timer, interrupted = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      interrupted = true;
      reject(new Error("Navigation deadline exceeded"));
      controller.abort();
      reader?.cancel().catch(() => {});
    }, 6000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(request, { signal: controller.signal });
        if (interrupted) {
          response.body?.cancel().catch(() => {});
          throw new Error("Navigation superseded by deadline");
        }
        // Preserve real denials, missing pages, redirects and other documents.
        if (!response.ok || response.redirected || response.type === "opaque" || !response.body) return response;
        reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.byteLength;
        }
        if (interrupted) throw new Error("Navigation superseded by deadline");
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}

async function cachedNavigation(cache, request) {
  for (const key of [cacheKeyFor(request), cacheKeyFor("/directory")]) {
    try {
      if (navigationWithdrawals.has(new URL(key.url).pathname)) continue;
      const saved = await cache?.match(key);
      if (!saved?.ok || !await compatibleNavigation(saved)) continue;
      // Fixed trusted marker, response-only: stored HTML and release IDs stay
      // unchanged. No URL, search text or provider content is interpolated.
      const html = await saved.text();
      const marked = html.replace(/<head(?:\s[^>]*)?>/i, '$&<meta name="rwn-offline-navigation" content="cached">');
      const response = new Response(marked, { status: saved.status, statusText: saved.statusText, headers: saved.headers });
      response.headers.delete("Content-Length");
      response.headers.delete("Content-Encoding");
      return response;
    } catch { /* Try the compatible root if this copy is unavailable. */ }
  }
  return null;
}

const navigationRequests = new Map();
const navigationWithdrawals = new Map();
let navigationWrite = Promise.resolve();

async function networkFirstNavigation(request, event) {
  const url = new URL(request.url);
  const directory = url.pathname === "/directory" || url.pathname.startsWith("/directory/");
  const key = url.pathname;
  const generation = {};
  let pendingWrite;
  if (directory) navigationRequests.set(key, generation);
  // Retain this handle across awaits: a retired worker must not recreate its
  // deleted release cache when a delayed request finally completes.
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  try {
    const response = directory ? await completeNavigationResponse(request) : await fetch(request);
    if (directory && !response.redirected && [503, 504].includes(response.status)) return await cachedNavigation(cache, request) || response;
    if (directory && cache) {
      const usable = !response.redirected && await compatibleNavigation(response);
      const replaced = response.ok && !response.redirected && !usable
        && !/<meta name="rwn-offline-assets" content="[a-f0-9]{12}"/.test(await response.clone().text());
      const removed = response.status === 404 || response.status === 410 || replaced;
      const current = navigationRequests.get(key) === generation;
      if (current && (removed || usable)) {
        if (removed) navigationWithdrawals.set(key, generation);
        const candidate = usable ? response.clone() : null;
        pendingWrite = navigationWrite = navigationWrite.catch(() => {}).then(async () => {
          // An observed withdrawal stays ordered even if the next request
          // fails. Only a newer successfully stored page can restore this key.
          if (removed) {
            await cache.delete(cacheKeyFor(request));
            if (navigationWithdrawals.get(key) === generation) navigationWithdrawals.delete(key);
          }
          else if (navigationRequests.get(key) === generation) {
            await putIfUsable(cache, request, candidate);
            if (navigationRequests.get(key) === generation) navigationWithdrawals.delete(key);
          }
        });
        // Persistence is best-effort and ordered, but never holds up a usable
        // network document. A later withdrawal follows already-started puts.
        event?.waitUntil?.(navigationWrite.catch(() => {}));
      }
    }
    return response;
  } catch {
    return await cachedNavigation(cache, request) || new Response(
      "Real World Needs is offline. Reconnect to refresh the directory.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  } finally {
    const release = () => { if (navigationRequests.get(key) === generation) navigationRequests.delete(key); };
    if (pendingWrite) pendingWrite.finally(release).catch(() => {});
    else release();
  }
}

// A catalog can lose public records between releases. Always bypass HTTP
// copies, and let only the newest request replace this release's offline copy.
// Explicit reloads from a replaced controller must never fall back to old data.
let directoryRequest = 0;
let directoryWrite = Promise.resolve();

async function completeDirectoryResponse(request) {
  const controller = new AbortController();
  let reader, timer, interrupted = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      interrupted = true;
      reject(new Error("Directory body deadline exceeded"));
      controller.abort();
      reader?.cancel().catch(() => {});
    }, 6000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(cacheKeyFor(request), {
          cache: "reload", credentials: "same-origin", signal: controller.signal
        });
        if (interrupted) {
          response.body?.cancel().catch(() => {});
          throw new Error("Directory request superseded by deadline");
        }
        if (!response.ok) return response;
        if (!response.body) throw new Error("Directory body missing");
        reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.byteLength;
        }
        if (interrupted) throw new Error("Directory request superseded by deadline");
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        if (!Array.isArray(payload?.records) || !payload.scopes || typeof payload.scopes !== "object" || Array.isArray(payload.scopes)) {
          throw new Error("Invalid directory");
        }
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}

async function directoryIndex(request) {
  const generation = ++directoryRequest;
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  try {
    const response = await completeDirectoryResponse(request);
    if (response.ok) {
      if (cache && generation === directoryRequest) {
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
    event.respondWith(networkFirstNavigation(request, event));
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
