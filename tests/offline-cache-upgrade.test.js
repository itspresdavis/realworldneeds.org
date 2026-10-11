import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile("public/sw.js", "utf8");
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
        async match(request) { return files.get(request.url)?.clone(); }
      };
    }
  };
}
function worker(release, caches, fetch) {
  const handlers = new Map();
  const effects = { skipped: false, claimed: false };
  vm.runInNewContext(source.replaceAll("__RWN_OFFLINE_RELEASE__", release), {
    URL, Request, Response, caches, fetch,
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
  await oldCache.put(new Request(indexUrl), new Response("synthetic-removed"));
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
  await cache.put(new Request(indexUrl), new Response("synthetic-removed"));
  const next = worker("new", caches, async (request, options) => { requests.push({ request, options }); return new Response("current-only"); });
  assert.equal(await (await next.request("reload")).text(), "current-only");
  assert.equal(await (await cache.match(new Request(indexUrl))).text(), "current-only");
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
    await cache.put(new Request(indexUrl), new Response("saved offline catalog"));
    let failing = true;
    const next = worker("new", caches, async () => {
      if (!failing) return new Response("current catalog");
      if (failure === "network") throw new Error("Offline");
      return new Response("Unavailable", { status: 503 });
    });
    if (failure === "network") await assert.rejects(next.request("reload"), /Offline/);
    else assert.equal((await next.request("reload")).status, 503);
    assert.equal(await (await next.request()).text(), "saved offline catalog");
    failing = false;
    assert.equal(await (await next.request("reload")).text(), "current catalog");
    assert.equal(await (await cache.match(new Request(indexUrl))).text(), "current catalog");
  });
}

test("late older in-flight responses cannot replace a newer catalog cache", async () => {
  const caches = storage(), older = deferred(), newer = deferred();
  let requests = 0;
  const next = worker("new", caches, () => (++requests === 1 ? older : newer).promise);
  const first = next.request("force-cache", "?v=old");
  const second = next.request("reload");
  newer.resolve(new Response("current-only"));
  assert.equal(await (await second).text(), "current-only");
  older.resolve(new Response("synthetic-removed"));
  await first;
  const cache = await caches.open("rwn-offline-new");
  assert.equal(await (await cache.match(new Request(indexUrl))).text(), "current-only");
});

test("cache quota or access failures do not hide a current network catalog", async () => {
  for (const unavailable of [false, true]) {
    const caches = storage();
    caches.failWrites(true);
    if (unavailable) caches.open = async () => { throw new Error("Storage denied"); };
    const next = worker("new", caches, async () => new Response("current-only"));
    assert.equal(await (await next.request("reload")).text(), "current-only");
  }
});

test("a cache write already in flight cannot finish after and overwrite the newer catalog", async () => {
  const caches = storage(), writing = deferred(), releaseWrite = deferred(), fetchedNew = deferred();
  const open = caches.open;
  caches.open = async (name) => {
    const cache = await open(name), put = cache.put;
    cache.put = async (request, response) => {
      if (await response.clone().text() === "older") { writing.resolve(); await releaseWrite.promise; }
      return put(request, response);
    };
    return cache;
  };
  let requests = 0;
  const next = worker("new", caches, async () => {
    if (++requests === 1) return new Response("older");
    fetchedNew.resolve();
    return new Response("current-only");
  });
  const first = next.request();
  await writing.promise;
  const second = next.request("reload");
  await fetchedNew.promise;
  await new Promise(resolve => setImmediate(resolve));
  releaseWrite.resolve();
  await Promise.all([first, second]);
  const cache = await caches.open("rwn-offline-new");
  assert.equal(await (await cache.match(new Request(indexUrl))).text(), "current-only");
});
