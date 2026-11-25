import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile("public/sw.js", "utf8");
const catalogText = id => JSON.stringify({ records: [{ id }], scopes: {} });
const origin = "https://rwn.test";
const indexUrl = `${origin}/data/search-index.json`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
function storage() {
  const entries = new Map();
  let failPut = false;
  return {
    entries,
    failWrites(value) { failPut = value; },
    async keys() { return [...entries.keys()]; },
    async delete(name) { return entries.delete(name); },
    async open(name) {
      if (!entries.has(name)) entries.set(name, new Map());
      const files = entries.get(name);
      return {
        async put(request, response) { if (failPut) throw new Error("Quota exceeded"); files.set(request.url, response.clone()); },
        async match(request) { return files.get(request.url)?.clone(); },
        async delete(request) { return files.delete(request.url); }
      };
    }
  };
}
function worker(release, caches, fetch) {
  const handlers = new Map();
  const effects = { skipped: false, claimed: false };
  vm.runInNewContext(source.replaceAll("__RWN_OFFLINE_RELEASE__", release), {
    URL, Request, Response, caches, fetch, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    self: {
      location: { origin }, addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() { effects.skipped = true; },
      clients: { async claim() { effects.claimed = true; } }
    }
  });
  const lifecycle = (type) => {
    let result;
    handlers.get(type)({ waitUntil(promise) { result = promise; } });
    return result;
  };
  const request = (cache = "force-cache", query = "") => {
    let result;
    handlers.get("fetch")({ request: new Request(`${indexUrl}${query}`, { cache }), respondWith(promise) { result = promise; } });
    return result;
  };
  return { effects, lifecycle, request };
}

test("failed worker installation preserves the old release until a complete retry can activate", async () => {
  const caches = storage();
  const old = worker("old", caches, async () => new Response("old core"));
  await old.lifecycle("install"); await old.lifecycle("activate");
  const oldCache = await caches.open("rwn-offline-old");
  await oldCache.put(new Request(indexUrl), new Response(catalogText("synthetic-removed")));
  const unrelated = await caches.open("another-app");
  await unrelated.put(new Request(`${origin}/other`), new Response("keep"));
  const failed = worker("next", caches, async (path) => new Response("core", { status: path === "/directory.js" ? 503 : 200 }));
  await assert.rejects(failed.lifecycle("install"), /required offline asset/);
  assert.equal(failed.effects.skipped, false);
  assert.equal(failed.effects.claimed, false);
  assert.ok(caches.entries.has("rwn-offline-old"));
  assert.equal(caches.entries.has("rwn-offline-next"), false);
  const next = worker("next", caches, async () => new Response("new core"));
  await next.lifecycle("install");
  assert.equal(next.effects.skipped, true);
  assert.ok(caches.entries.has("rwn-offline-old"), "purge belongs to activation only");
  await next.lifecycle("activate");
  assert.equal(next.effects.claimed, true);
  assert.deepEqual(await caches.keys(), ["another-app", "rwn-offline-next"]);
  assert.equal(await (await caches.open("rwn-offline-next")).match(new Request(indexUrl)), undefined);
});

test("reload bypasses both the old offline copy and force-cache HTTP requests", async () => {
  const caches = storage(), requests = [];
  const cache = await caches.open("rwn-offline-new");
  await cache.put(new Request(indexUrl), new Response(catalogText("synthetic-removed")));
  const next = worker("new", caches, async (request, options) => { requests.push({ request, options }); return new Response(catalogText("current-only")); });
  assert.equal(await (await next.request("reload")).text(), catalogText("current-only"));
  assert.equal(await (await cache.match(new Request(indexUrl))).text(), catalogText("current-only"));
  assert.equal(requests[0].options.cache, "reload");
  await next.request("force-cache", "?v=older-client");
  assert.equal(requests[1].options.cache, "reload", "old-client HTTP caches cannot repopulate the new offline cache");
  for (const call of requests) {
    assert.equal(call.request.url, indexUrl);
    assert.equal(call.options.credentials, "same-origin");
  }
});

for (const failure of ["network", "http"]) {
  test(`explicit reload ${failure} failure never returns stale data, normal offline search still works`, async () => {
    const caches = storage();
    const cache = await caches.open("rwn-offline-new");
    await cache.put(new Request(indexUrl), new Response(catalogText("saved offline catalog")));
    let failing = true;
    const next = worker("new", caches, async () => {
      if (!failing) return new Response(catalogText("current catalog"));
      if (failure === "network") throw new Error("Offline");
      return new Response("Unavailable", { status: 503 });
    });
    if (failure === "network") await assert.rejects(next.request("reload"), /Offline/);
    else assert.equal((await next.request("reload")).status, 503);
    assert.equal(await (await next.request()).text(), catalogText("saved offline catalog"));
    failing = false;
    assert.equal(await (await next.request("reload")).text(), catalogText("current catalog"));
    assert.equal(await (await cache.match(new Request(indexUrl))).text(), catalogText("current catalog"));
  });
}

test("late older in-flight responses cannot replace a newer catalog cache", async () => {
  const caches = storage(), older = deferred(), newer = deferred();
  let requests = 0;
  const next = worker("new", caches, () => (++requests === 1 ? older : newer).promise);
  const first = next.request("force-cache", "?v=old");
  const second = next.request("reload");
  newer.resolve(new Response(catalogText("current-only")));
  assert.equal(await (await second).text(), catalogText("current-only"));
  older.resolve(new Response(catalogText("synthetic-removed")));
  await first;
  const cache = await caches.open("rwn-offline-new");
  assert.equal(await (await cache.match(new Request(indexUrl))).text(), catalogText("current-only"));
});

test("cache quota or access failures do not hide a current network catalog", async () => {
  for (const unavailable of [false, true]) {
    const caches = storage();
    caches.failWrites(true);
    if (unavailable) caches.open = async () => { throw new Error("Storage denied"); };
    const next = worker("new", caches, async () => new Response(catalogText("current-only")));
    assert.equal(await (await next.request("reload")).text(), catalogText("current-only"));
  }
});

test("a cache write already in flight cannot finish after and overwrite the newer catalog", async () => {
  const caches = storage(), writing = deferred(), releaseWrite = deferred(), fetchedNew = deferred();
  const open = caches.open;
  caches.open = async (name) => {
    const cache = await open(name), put = cache.put;
    cache.put = async (request, response) => {
      if (await response.clone().text() === catalogText("older")) { writing.resolve(); await releaseWrite.promise; }
      return put(request, response);
    };
    return cache;
  };
  let requests = 0;
  const next = worker("new", caches, async () => {
    if (++requests === 1) return new Response(catalogText("older"));
    fetchedNew.resolve();
    return new Response(catalogText("current-only"));
  });
  const first = next.request();
  await writing.promise;
  const second = next.request("reload");
  await fetchedNew.promise;
  await new Promise(resolve => setImmediate(resolve));
  releaseWrite.resolve();
  await Promise.all([first, second]);
  const cache = await caches.open("rwn-offline-new");
  assert.equal(await (await cache.match(new Request(indexUrl))).text(), catalogText("current-only"));
});

for (const status of [401, 403, 404, 410]) test("authoritative catalog denial/removal HTTP " + status + " retires the cached index", async () => {
  const caches = storage(), cache = await caches.open("rwn-offline-new");
  await cache.put(new Request(indexUrl), new Response(catalogText("withdrawn")));
  let mode = "removed";
  const next = worker("new", caches, async () => {
    if (mode === "offline") throw Error("Offline");
    return mode === "fresh" ? new Response(catalogText("current")) : new Response("Removed", { status });
  });
  assert.equal((await next.request()).status, status);
  assert.equal(await cache.match(new Request(indexUrl)), undefined);
  mode = "offline";
  assert.equal((await next.request()).status, 503, "later transport failure cannot resurrect removed data");
  mode = "fresh";
  assert.equal(await (await next.request()).text(), catalogText("current"));
});

test("temporary catalog fallback is explicitly marked, without poisoning the stored or refreshed response", async () => {
  const caches = storage(), cache = await caches.open("rwn-offline-new");
  await cache.put(new Request(indexUrl), new Response(catalogText("saved"), { headers: { "Content-Type": "application/json", "Content-Length": "1", "Content-Encoding": "gzip" } }));
  let failure = true;
  const next = worker("new", caches, async () => failure ? new Response("Unavailable", { status: 503 }) : new Response(catalogText("fresh")));
  const fallback = await next.request();
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get("X-RWN-Catalog-Cache"), "stale");
  assert.equal(fallback.headers.get("Content-Length"), null);
  assert.equal(fallback.headers.get("Content-Encoding"), null);
  assert.equal(await fallback.text(), catalogText("saved"));
  assert.equal((await cache.match(new Request(indexUrl))).headers.get("X-RWN-Catalog-Cache"), null);
  failure = false;
  const fresh = await next.request();
  assert.equal(fresh.headers.get("X-RWN-Catalog-Cache"), null);
  assert.equal(await fresh.text(), catalogText("fresh"));
});

test("withdrawal waits behind an already-started catalog write and cannot leave the old payload cached", async () => {
  const caches = storage(), writing = deferred(), release = deferred();
  const open = caches.open;
  caches.open = async name => {
    const cache = await open(name), put = cache.put;
    cache.put = async (request, response) => { writing.resolve(); await release.promise; return put(request, response); };
    return cache;
  };
  let attempt = 0;
  const next = worker("new", caches, async () => ++attempt === 1 ? new Response(catalogText("old")) : new Response("Removed", { status: 410 }));
  const old = next.request();
  await writing.promise;
  const removed = next.request();
  await new Promise(setImmediate);
  release.resolve();
  await old;
  assert.equal((await removed).status, 410);
  assert.equal(await (await caches.open("rwn-offline-new")).match(new Request(indexUrl)), undefined);
});
