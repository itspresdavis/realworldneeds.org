import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(process.env.RWN_BASELINE_ROOT
  ? join(process.env.RWN_BASELINE_ROOT, "public/sw.js")
  : new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://rwn.test";
const indexUrl = `${origin}/data/search-index.json`;
const encode = (text) => new TextEncoder().encode(text);
const catalog = (id) => ({ records: [{ id }], scopes: {} });
const response = (id) => new Response(JSON.stringify(catalog(id)), {
  headers: { "Content-Type": "application/json", "X-Catalog-Fixture": "complete" }
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 8; index += 1) await new Promise(setImmediate);
};

function partialBody({ neverFinishCancellation = false } = {}) {
  let controller, closed = false, cancellations = 0;
  const stream = new ReadableStream({
    start(value) { controller = value; controller.enqueue(encode('{"records":[')); },
    cancel() {
      closed = true;
      cancellations += 1;
      if (neverFinishCancellation) return new Promise(() => {});
    }
  });
  return {
    response: new Response(stream, { headers: { "Content-Type": "application/json" } }),
    get cancellations() { return cancellations; },
    finish(id = "withdrawn-old") {
      if (closed) return;
      closed = true;
      controller.enqueue(encode(`${JSON.stringify({ id })}],"scopes":{}}`));
      controller.close();
    }
  };
}

function fixture({ saved = catalog("offline-copy") } = {}) {
  const replies = [], calls = [], writes = [], startedWrites = [], timers = new Map(), handlers = new Map();
  const writeBlocks = new Map();
  let cached = saved, now = 0, nextTimer = 0;
  const cache = {
    async put(request, value) {
      // Match CacheStorage: a put consumes the body before completing.
      const payload = await value.json();
      const id = payload.records[0]?.id;
      startedWrites.push(id);
      if (writeBlocks.has(id)) await writeBlocks.get(id).promise;
      cached = payload;
      writes.push(id);
    },
    async match() { return cached ? new Response(JSON.stringify(cached)) : undefined; }
  };
  const context = vm.createContext({
    URL, Request, Response, ReadableStream, AbortController, TextDecoder, Uint8Array,
    self: { location: { origin }, addEventListener(name, handler) { handlers.set(name, handler); } },
    caches: { async open() { return cache; } },
    async fetch(request, options) {
      calls.push({ request, options });
      assert.ok(replies.length, "each network response must be explicitly supplied by the fixture");
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  return {
    replies, calls, writes, startedWrites, timers, writeBlocks,
    get cached() { return cached; },
    request(cache = "force-cache") {
      let pending;
      handlers.get("fetch")({
        request: new Request(`${indexUrl}?v=existing-page`, { cache }),
        respondWith(value) { pending = value; }
      });
      assert.ok(pending, "the actual fetch handler must own catalog requests");
      return pending;
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

const bounded = { timeout: 2000 };

test("a complete retry bypasses an older stalled body and late withdrawn data never enters the cache", bounded, async () => {
  const f = fixture(), oldBody = partialBody();
  f.replies.push(oldBody.response, response("fresh-only"));
  let firstFinished = false, secondFinished = false;
  const first = f.request().then(value => { firstFinished = true; return value; });
  await flush();
  const second = f.request().then(value => { secondFinished = true; return value; });
  try {
    await flush();
    assert.equal(firstFinished, false);
    assert.equal(secondFinished, true, "a stalled body must not acquire the serialized cache-write queue");
    assert.deepEqual(await (await second).json(), catalog("fresh-only"));
    assert.deepEqual(f.writes, ["fresh-only"]);
  } finally {
    oldBody.finish();
    await Promise.all([first, second]);
  }
  assert.deepEqual(f.cached, catalog("fresh-only"));
  assert.deepEqual(f.writes, ["fresh-only"]);
  assert.equal(f.timers.size, 0);
  assert.equal(oldBody.response.body.locked, false);
});

test("a catalog is cached only after its complete body has been received and validated", bounded, async () => {
  const f = fixture(), body = partialBody();
  f.replies.push(body.response);
  const pending = f.request();
  try {
    await flush();
    assert.deepEqual(f.startedWrites, []);
    assert.deepEqual(f.cached, catalog("offline-copy"));
    assert.equal(f.timers.size, 1);
  } finally { body.finish("complete-東京"); }
  assert.deepEqual(await (await pending).json(), catalog("complete-東京"));
  assert.deepEqual(f.writes, ["complete-東京"]);
  assert.equal(f.timers.size, 0);
  assert.equal(body.response.body.locked, false);
});

for (const neverFinishCancellation of [false, true]) {
  test(`body timeout aborts and releases its reader without awaiting ${neverFinishCancellation ? "a stalled" : "normal"} cancellation`, bounded, async () => {
    const f = fixture(), body = partialBody({ neverFinishCancellation });
    f.replies.push(body.response, response("retry-only"));
    const pending = f.request();
    await flush();
    assert.equal([...f.timers.values()][0].delay, 6000, "worker fallback needs time before the client's eight-second deadline");
    f.advance(6000);
    assert.deepEqual(await (await pending).json(), catalog("offline-copy"));
    await flush();
    assert.equal(body.cancellations, 1);
    assert.equal(body.response.body.locked, false);
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(await (await f.request()).json(), catalog("retry-only"));
    assert.deepEqual(f.writes, ["retry-only"]);
  });
}

for (const cache of ["force-cache", "reload"]) {
  test(`${cache}: header timeout handles late headers without caching their body`, bounded, async () => {
    const f = fixture(), headers = deferred();
    f.replies.push(headers.promise, response("retry-only"));
    const pending = f.request(cache);
    const result = cache === "reload" ? assert.rejects(pending, /deadline/) : pending;
    await flush();
    f.advance(6000);
    if (cache === "reload") await result;
    else assert.deepEqual(await (await result).json(), catalog("offline-copy"));
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.equal(f.timers.size, 0);
    const late = partialBody();
    headers.resolve(late.response);
    await flush();
    assert.equal(late.cancellations, 1, "late headers must immediately cancel their unread body");
    assert.equal(late.response.body.locked, false);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(await (await f.request(cache)).json(), catalog("retry-only"));
    assert.deepEqual(f.cached, catalog("retry-only"));
    assert.equal(f.timers.size, 0);
  });
}

test("body reading gets only the remainder of the single header-and-body deadline", bounded, async () => {
  const f = fixture(), headers = deferred(), body = partialBody();
  f.replies.push(headers.promise);
  const pending = f.request("reload"), rejected = assert.rejects(pending, /deadline/);
  await flush();
  f.advance(4000);
  headers.resolve(body.response);
  await flush();
  f.advance(1999);
  await flush();
  assert.equal(body.cancellations, 0);
  assert.equal(f.timers.size, 1);
  f.advance(1);
  await rejected;
  await flush();
  assert.equal(body.cancellations, 1);
  assert.equal(body.response.body.locked, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.cached, catalog("offline-copy"), "reload must reject without discarding or serving the old cache");
});

for (const [name, body] of [
  ["partial JSON", '{"records":['],
  ["null payload", "null"],
  ["missing records", '{"scopes":{}}'],
  ["invalid records", '{"records":null,"scopes":{}}'],
  ["missing scopes", '{"records":[]}'],
  ["null scopes", '{"records":[],"scopes":null}'],
  ["array scopes", '{"records":[],"scopes":[]}'],
  ["string scopes", '{"records":[],"scopes":"old"}']
]) {
  test(`${name} is not cached and cannot satisfy an explicit fresh reload`, bounded, async () => {
    const f = fixture();
    f.replies.push(new Response(body));
    await assert.rejects(f.request("reload"));
    assert.deepEqual(f.startedWrites, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.cached, catalog("offline-copy"));
    assert.equal(f.timers.size, 0);
  });
}

test("malformed-body normal requests can use a valid offline copy and missing copies return 503", bounded, async () => {
  for (const saved of [catalog("offline-copy"), null]) {
    const f = fixture({ saved });
    f.replies.push(new Response('{"records":['));
    const result = await f.request();
    if (saved) assert.deepEqual(await result.json(), saved);
    else assert.equal(result.status, 503);
    assert.deepEqual(f.writes, []);
    assert.equal(f.timers.size, 0);
  }
});

test("successful body cleanup preserves response headers and canonical network reload behavior", bounded, async () => {
  const f = fixture(), incoming = response("fresh-only");
  f.replies.push(incoming);
  const result = await f.request();
  assert.equal(result.headers.get("X-Catalog-Fixture"), "complete");
  assert.deepEqual(await result.json(), catalog("fresh-only"));
  assert.equal(f.calls[0].request.url, indexUrl);
  assert.equal(f.calls[0].options.cache, "reload");
  assert.equal(f.calls[0].options.credentials, "same-origin");
  assert.equal(f.calls[0].options.signal.aborted, false);
  assert.equal(incoming.body.locked, false);
  assert.equal(f.timers.size, 0);
});

test("an independently stalled CacheStorage write retains serialization and skips superseded queued data", bounded, async () => {
  const f = fixture(), oldWrite = deferred();
  f.writeBlocks.set("older-write", oldWrite);
  f.replies.push(response("older-write"), response("superseded-queued"), response("current-only"));
  const first = f.request();
  await flush();
  assert.deepEqual(f.startedWrites, ["older-write"]);
  let secondDone = false, thirdDone = false;
  const second = f.request().then(value => { secondDone = true; return value; });
  await flush();
  const third = f.request().then(value => { thirdDone = true; return value; });
  try {
    await flush();
    assert.equal(secondDone, false);
    assert.equal(thirdDone, false);
    assert.deepEqual(f.startedWrites, ["older-write"], "never bypass an uncancellable old storage write");
    assert.equal(f.timers.size, 0, "network/body resources are already cleaned up; this residual is CacheStorage only");
  } finally {
    oldWrite.resolve();
    await Promise.all([first, second, third]);
  }
  assert.deepEqual(f.writes, ["older-write", "current-only"]);
  assert.deepEqual(f.cached, catalog("current-only"));
});
