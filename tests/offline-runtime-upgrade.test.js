import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile("public/sw.js", "utf8");
const origin = "https://rwn.test";
const archiveName = "rwn-offline-runtime-v1";
const asset = (body, name = "directory-enhancements", extension = "css") => {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  return { body, path: `/${name}.${hash}.${extension}`, canonical: `/${name}.${extension}` };
};
const runtimeId = (assets, optional = []) => createHash("sha256").update(JSON.stringify({ required: Object.fromEntries(assets.map(item => [item.canonical, item.path])), optional: Object.fromEntries(optional.map(item => [item.canonical, item.path])) })).digest("hex").slice(0, 12);
const htmlFor = (assets, title = "fixture", optional = []) => `<title>${title}</title><meta name="rwn-offline-assets" content="${runtimeId(assets, optional)}" />`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function storage() {
  const entries = new Map();
  const failures = new Set();
  return {
    entries, failures,
    async keys() { return [...entries.keys()]; },
    async delete(name) { return entries.delete(name); },
    async open(name) {
      if (failures.has("open") || failures.has(name)) throw new Error("Storage denied");
      if (!entries.has(name)) entries.set(name, new Map());
      const files = entries.get(name);
      return {
        async put(key, response) { if (failures.has("put")) throw new Error("Quota exceeded"); files.set(key.url, response.clone()); },
        async match(key) { if (failures.has("match")) throw new Error("Read denied"); return files.get(key.url)?.clone(); },
        async keys() { return [...files.keys()].map(url => new Request(url)); },
        async delete(key) { return files.delete(key.url); }
      };
    }
  };
}

function worker(release, caches, assets, fetch, optional = []) {
  const handlers = new Map();
  const effects = { skipped: false, claimed: false };
  const manifest = Object.fromEntries(assets.map(item => [item.canonical, item.path]));
  const manifestId = runtimeId(assets, optional);
  const network = fetch || (async request => {
    const path = new URL(typeof request === "string" ? request : request.url, origin).pathname;
    return new Response([...assets, ...optional].find(item => item.path === path)?.body || `core ${release}${path === "/directory" ? `<meta name="rwn-offline-assets" content="${manifestId}" />` : ""}`);
  });
  vm.runInNewContext(source.replaceAll("__RWN_OFFLINE_RELEASE__", release).replace("/* __RWN_RUNTIME_ASSETS__ */ {}", JSON.stringify(manifest)).replace("/* __RWN_OPTIONAL_ASSETS__ */ {}", JSON.stringify(Object.fromEntries(optional.map(item => [item.canonical, item.path])))).replace('/* __RWN_RUNTIME_ID__ */ ""', JSON.stringify(manifestId)), {
    URL, Request, Response, AbortController, TextDecoder, setTimeout, clearTimeout, Uint8Array, crypto: webcrypto, caches, fetch: network,
    self: { location: { origin }, addEventListener(name, fn) { handlers.set(name, fn); },
      async skipWaiting() { effects.skipped = true; }, clients: { async claim() { effects.claimed = true; } } }
  });
  return {
    effects, manifestId,
    lifecycle(name, data) { let promise; handlers.get(name)({ data, waitUntil(value) { promise = value; } }); return promise; },
    request(path, mode) {
      let promise;
      const request = mode === "navigate" ? { url: `${origin}${path}`, method: "GET", mode } : new Request(`${origin}${path}`);
      handlers.get("fetch")({ request, respondWith(value) { promise = value; }, waitUntil() {} });
      return promise;
    }
  };
}
async function activate(instance) { await instance.lifecycle("install"); await instance.lifecycle("activate"); }

test("new immutable asset requests never return canonical stale bytes or another version", async () => {
  const caches = storage();
  const old = asset("old css"), next = asset("new css");
  const cache = await caches.open("rwn-offline-new");
  await cache.put(new Request(`${origin}${next.canonical}`), new Response(old.body));
  await cache.put(new Request(`${origin}${old.path}`), new Response(old.body));
  const current = worker("new", caches, [next]);
  assert.equal(await (await current.request(`${next.path}?v=new&q=private`)).text(), next.body);
  assert.equal(await (await cache.match(new Request(`${origin}${next.path}`))).text(), next.body);
  assert.ok([...caches.entries.get("rwn-offline-new").keys()].every(key => !key.includes("?")));
});

test("activation keeps exact old code for old tabs while discarding prior HTML and catalog", async () => {
  const caches = storage();
  const before = asset("old saved code", "saved-services", "js"), after = asset("new saved code", "saved-services", "js");
  await activate(worker("old", caches, [before]));
  const old = await caches.open("rwn-offline-old");
  await old.put(new Request(`${origin}/data/search-index.json`), new Response("withdrawn fixture"));
  await (await caches.open("unrelated")).put(new Request(`${origin}/other`), new Response("keep"));
  await activate(worker("new", caches, [after]));
  const offline = worker("new", caches, [after], async () => { throw new Error("Offline"); });
  assert.equal(await (await offline.request(`${before.path}?v=old&attempt=1`)).text(), before.body);
  assert.equal(await (await offline.request(after.path)).text(), after.body);
  assert.equal(caches.entries.has("rwn-offline-old"), false);
  assert.equal(caches.entries.has("unrelated"), true);
  assert.ok([...caches.entries.get(archiveName).keys()].every(key => /\.[a-f0-9]{12}\.(css|js)$/.test(key)));
  assert.equal(await (await offline.request("/data/search-index.json")).text(), "Directory unavailable");
  assert.match(await (await offline.request("/directory?query=private", "navigate")).text(), /^core new<meta/);
});

test("a rollback warms its matching manifest and preserves the other tab's newer runtime", async () => {
  const caches = storage(), a = asset("release a"), b = asset("release b");
  await activate(worker("a", caches, [a]));
  await activate(worker("b", caches, [b]));
  await activate(worker("a", caches, [a]));
  const offline = worker("a", caches, [a], async () => { throw new Error("Offline"); });
  for (const item of [a, b]) assert.equal(await (await offline.request(item.path)).text(), item.body);
  assert.equal(caches.entries.has("rwn-offline-b"), false);
});

for (const failure of ["network", "http", "wrong bytes", "opaque"]) {
  test(`failed ${failure} candidate leaves the old offline release and archive intact`, async () => {
    const caches = storage(), a = asset("before"), b = asset("after");
    await activate(worker("a", caches, [a]));
    const before = [...caches.entries.get(archiveName).keys()];
    const broken = worker("b", caches, [b], async request => {
      if (request === "/directory") return new Response(htmlFor([b]));
      if (request !== b.path) return new Response("core");
      if (failure === "network") throw new Error("Offline");
      if (failure === "opaque") return { ok: true, type: "opaque" };
      return new Response("wrong bytes", { status: failure === "http" ? 503 : 200 });
    });
    await assert.rejects(broken.lifecycle("install"));
    assert.equal(broken.effects.skipped, false);
    assert.equal(caches.entries.has("rwn-offline-b"), false);
    assert.equal(caches.entries.has("rwn-offline-a"), true);
    assert.deepEqual([...caches.entries.get(archiveName).keys()], before);
  });
}

test("candidate waits for delayed writers before removing an incomplete release", async () => {
  const caches = storage(), a = asset("next"), delayed = deferred();
  let ended = false;
  const broken = worker("broken", caches, [a], async path => {
    if (path === "/directory") return new Response(htmlFor([a]));
    if (path === "/directory.js") return new Response("failed", { status: 503 });
    if (path === a.path) { await delayed.promise; ended = true; return new Response(a.body); }
    return new Response("core");
  });
  const installing = broken.lifecycle("install");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ended, false);
  assert.equal(caches.entries.has("rwn-offline-broken"), true);
  delayed.resolve();
  await assert.rejects(installing);
  assert.equal(ended, true);
  assert.equal(caches.entries.has("rwn-offline-broken"), false);
});

test("new network HTML before a failed upgrade cannot replace the compatible offline shell", async () => {
  const caches = storage(), a = asset("before"), b = asset("after");
  await activate(worker("a", caches, [a]));
  const current = worker("a", caches, [a], async () => new Response(htmlFor([b], "new HTML")));
  assert.match(await (await current.request("/directory?query=private", "navigate")).text(), /new HTML/);
  const candidate = worker("b", caches, [b], async () => new Response("failed", { status: 503 }));
  await assert.rejects(candidate.lifecycle("install"));
  const offline = worker("a", caches, [a], async () => { throw new Error("Offline"); });
  assert.match(await (await offline.request("/directory", "navigate")).text(), /^core a<meta/);
  assert.equal(await (await offline.request(a.path)).text(), a.body);
  assert.equal((await offline.request(b.path)).status, 503);
});

test("deployment changes during installation cannot pair one manifest with another HTML shell", async () => {
  const caches = storage(), a = asset("before"), b = asset("after");
  const candidate = worker("a", caches, [a], async request => new Response(request === "/directory" ? htmlFor([b]) : request === a.path ? a.body : "core"));
  await assert.rejects(candidate.lifecycle("install"), /required offline asset: \/directory/);
  assert.equal(candidate.effects.skipped, false);
  assert.equal(caches.entries.has("rwn-offline-a"), false);
});

test("late queued old-runtime fetch cannot overwrite a newer runtime", async () => {
  const caches = storage(), a = asset("old bytes"), b = asset("new bytes"), delayed = deferred();
  const old = worker("old", caches, [a], async () => { await delayed.promise; return new Response(a.body); });
  const pending = old.request(a.path);
  await new Promise(resolve => setImmediate(resolve));
  await activate(worker("new", caches, [b]));
  delayed.resolve();
  assert.equal(await (await pending).text(), a.body);
  assert.equal(caches.entries.has("rwn-offline-old"), false, "retired release must not be recreated by late requests");
  const next = worker("new", caches, [b], async () => { throw new Error("Offline"); });
  assert.equal(await (await next.request(b.path)).text(), b.body);
});

for (const error of ["open", "put", "match"]) {
  test(`runtime ${error} failure still returns verified usable network bytes`, async () => {
    const caches = storage(), a = asset("network"); caches.failures.add(error);
    const current = worker("new", caches, [a]);
    assert.equal(await (await current.request(a.path)).text(), a.body);
  });
}

test("archive storage failure cannot prevent activation or current-release offline reads", async () => {
  const caches = storage(), a = asset("offline"); caches.failures.add(archiveName);
  const current = worker("new", caches, [a]);
  await activate(current);
  assert.equal(current.effects.claimed, true);
  const offline = worker("new", caches, [a], async () => { throw new Error("Offline"); });
  assert.equal(await (await offline.request(a.path)).text(), a.body);
});

test("archive is bounded, protects the active manifest, and never accepts arbitrary versions", async () => {
  const caches = storage();
  const archive = await caches.open(archiveName);
  const active = asset("active");
  await archive.put(new Request(`${origin}${active.path}`), new Response(active.body));
  for (let i = 0; i < 70; i++) {
    const item = asset(`old ${i}`);
    await archive.put(new Request(`${origin}${item.path}`), new Response(item.body));
  }
  await activate(worker("new", caches, [active]));
  assert.equal(caches.entries.get(archiveName).size, 64);
  assert.equal(await (await archive.match(new Request(`${origin}${active.path}`))).text(), active.body);
  const external = asset("unknown historical runtime");
  const current = worker("new", caches, [active], async () => new Response(external.body));
  assert.equal(await (await current.request(external.path)).text(), external.body);
  assert.equal(caches.entries.get(archiveName).size, 64);
  assert.equal(await archive.match(new Request(`${origin}${external.path}`)), undefined);
  const expired = asset("old 0");
  assert.equal((await current.request(expired.path)).status, 503, "must not substitute differently hashed network bytes");
});

test("clear-browser-data includes the bounded runtime archive and leaves unrelated caches alone", async () => {
  const caches = storage(), a = asset("runtime");
  const current = worker("new", caches, [a]);
  await activate(current); await caches.open("unrelated");
  await current.lifecycle("message", { type: "CLEAR_RWN_OFFLINE" });
  assert.deepEqual(await caches.keys(), ["unrelated"]);
});

test("intermittent archive write failure still prunes older entries and completes activation", async () => {
  const caches = storage(), active = asset("active");
  const archive = await caches.open(archiveName);
  for (let i = 0; i < 70; i++) {
    const item = asset(`old ${i}`);
    await archive.put(new Request(`${origin}${item.path}`), new Response(item.body));
  }
  const current = worker("new", caches, [active]);
  await current.lifecycle("install");
  const open = caches.open.bind(caches);
  caches.open = async name => {
    const cache = await open(name);
    if (name === archiveName) cache.put = async () => { throw new Error("Quota exceeded"); };
    return cache;
  };
  await current.lifecycle("activate");
  assert.equal(current.effects.claimed, true);
  assert.equal(caches.entries.get(archiveName).size, 64);
  const offline = worker("new", caches, [active], async () => { throw new Error("Offline"); });
  assert.equal(await (await offline.request(active.path)).text(), active.body);
});


test("locale and transitive search dependencies upgrade atomically and preserve exact old-tab bytes", async () => {
  const caches = storage();
  const before = [asset("old locale", "language", "js"), asset("old intent", "src/utils/search-intent-entry", "js"), asset("old matcher", "src/utils/search", "js")];
  const after = before.map(item => asset(item.body.replace("old", "new"), item.canonical.slice(1, -3), "js"));
  await activate(worker("old-graph", caches, before));
  const interrupted = worker("new-graph", caches, after, async path => new Response(path === after[2].path ? "wrong dependency" : path === "/directory" ? htmlFor(after) : after.find(item => item.path === path)?.body || "core"));
  await assert.rejects(interrupted.lifecycle("install"));
  assert.equal(interrupted.effects.skipped, false);
  assert.equal(caches.entries.has("rwn-offline-new-graph"), false);
  assert.equal(caches.entries.has("rwn-offline-old-graph"), true);
  await activate(worker("new-graph", caches, after));
  const offline = worker("new-graph", caches, after, async () => { throw new Error("offline"); });
  for (const item of [...before, ...after]) assert.equal(await (await offline.request(item.path)).text(), item.body);
  assert.equal(offline.request("/src/private.account.0123456789ab.js"), undefined);
  assert.equal(offline.request("/api/account.0123456789ab.json"), undefined);
  assert.equal(offline.request("/src/utils/search.js"), undefined);
  assert.equal(offline.request(after[1].path.replace(/\.js$/, ".json")), undefined);
  assert.equal(offline.request(after[0].path.replace(/\.js$/, ".css")), undefined);
});

test("optional postal data is not warmed, is byte-verified on demand, and can survive old-tab upgrades", async () => {
  const caches = storage(), runtime = asset("intent", "src/utils/search-intent-entry", "js"), postal = asset('{"02108":[42.36,-71.06]}', "data/postal-areas", "json");
  const calls = [];
  const current = worker("postal-a", caches, [runtime], async path => {
    const requested = typeof path === "string" ? path : new URL(path.url).pathname;
    calls.push(requested);
    return new Response(requested === postal.path ? postal.body : requested === runtime.path ? runtime.body : requested === "/directory" ? htmlFor([runtime], "fixture", [postal]) : "core");
  }, [postal]);
  await activate(current);
  assert.equal(calls.includes(postal.path), false);
  assert.equal(current.request(postal.path.replace(/\.json$/, ".js")), undefined);
  assert.equal(await (await current.request(postal.path)).text(), postal.body);
  const cached = await caches.open("rwn-offline-postal-a");
  await cached.put(new Request(origin + postal.path), new Response("mismatched cached bytes"));
  const noNetwork = worker("postal-a", caches, [runtime], async () => { throw new Error("offline"); }, [postal]);
  assert.equal((await noNetwork.request(postal.path)).status, 503);
  assert.equal(await cached.match(new Request(origin + postal.path)), undefined);
  await current.request(postal.path);
  await current.lifecycle("activate");
  const nextPostal = asset('{"02108":[42.361,-71.06]}', "data/postal-areas", "json");
  await activate(worker("postal-b", caches, [runtime], undefined, [nextPostal]));
  const oldTab = worker("postal-b", caches, [runtime], async () => { throw new Error("offline"); }, [nextPostal]);
  assert.equal(await (await oldTab.request(postal.path)).text(), postal.body);
  assert.equal((await oldTab.request(nextPostal.path)).status, 503, "an unused optional reference is truthfully unavailable offline");
});
