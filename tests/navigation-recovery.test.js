import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/sw.js', 'utf8');
const origin = 'https://rwn.test';
const runtime = '0123456789ab';
const html = title => `<!doctype html><html><head><meta name="rwn-offline-assets" content="${runtime}"><title>${title}</title></head><body>${title}</body></html>`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(setImmediate);
function fixture(network, { fail = '', release = 'current', stores = new Map(), putHook, deleteHook } = {}) {
  const handlers = new Map(), calls = [], writes = [], reads = [], timers = new Map(), background = [];
  let tick = 0, id = 0;
  const caches = {
    async open(name) {
      if (fail === 'open') throw new Error('Cache denied');
      if (!stores.has(name)) stores.set(name, new Map());
      const files = stores.get(name);
      return {
        async match(key) { reads.push(key.url); if (fail === 'match') throw new Error('Read denied'); return files.get(key.url)?.clone(); },
        async put(key, response) { if (fail === 'put') throw new Error('Quota exceeded'); await putHook?.(key, response); writes.push(key.url); files.set(key.url, response.clone()); },
        async delete(key) { await deleteHook?.(key); return files.delete(key.url); }
      };
    },
    async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); }
  };
  vm.runInNewContext(source.replaceAll('__RWN_OFFLINE_RELEASE__', release).replace('/* __RWN_RUNTIME_ID__ */ ""', JSON.stringify(runtime)), {
    URL, Request, Response, AbortController, TextDecoder, Uint8Array, caches,
    fetch(request, options) { calls.push({ request, options }); return network(request, options); },
    setTimeout(callback, delay) { const token = ++id; timers.set(token, { at: tick + delay, callback }); return token; },
    clearTimeout(token) { timers.delete(token); },
    self: { location: { origin }, addEventListener(name, handler) { handlers.set(name, handler); }, clients: { async claim() {} } }
  });
  return {
    caches, stores, calls, writes, reads, timers, background,
    async seed(path = '/directory', value = html('cached')) { const cache = await caches.open(`rwn-offline-${release}`); await cache.put(new Request(`${origin}${path}`), new Response(value, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })); writes.length = 0; },
    request(path = '/directory?query=private') { let result; handlers.get('fetch')({ request: { url: origin + path, method: 'GET', mode: 'navigate' }, respondWith(promise) { result = promise; }, waitUntil(promise) { background.push(promise); } }); return result; },
    advance(ms) { tick += ms; for (const [token, timer] of [...timers]) if (timer.at <= tick) { timers.delete(token); timer.callback(); } },
    async settle() { await Promise.all(background); },
    async saved(path = '/directory') { return (await (await caches.open(`rwn-offline-${release}`)).match(new Request(origin + path)))?.text(); }
  };
}

for (const status of [503, 504]) for (const exact of [true, false]) test(`${status} uses compatible ${exact ? 'exact' : 'root'} directory with a response-only offline marker`, async () => {
  const f = fixture(async () => new Response('server unavailable', { status }));
  await f.seed(exact ? '/directory/help/food' : '/directory');
  const response = await f.request('/directory/help/food?query=private');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /name="rwn-offline-navigation"/);
  assert.doesNotMatch(await f.saved(exact ? '/directory/help/food' : '/directory'), /rwn-offline-navigation/);
  assert.ok(f.reads.every(path => !path.includes('?')));
  assert.deepEqual(f.writes, []);
});
for (const status of [503, 504]) test(`${status} without a compatible current copy preserves the server response`, async () => {
  const f = fixture(async () => new Response('server unavailable', { status }));
  await f.seed('/directory', html('wrong schema').replace(runtime, 'old-runtime'));
  await (await f.caches.open('rwn-offline-old')).put(new Request(origin + '/directory'), new Response(html('retired')));
  const response = await f.request();
  assert.equal(response.status, status); assert.equal(await response.text(), 'server unavailable');
});
for (const body of [false, true]) test(`held navigation ${body ? 'body' : 'headers'} recovers within six seconds and never writes late bytes`, async () => {
  const held = deferred(); let cancel = false;
  const response = body ? new Response(new ReadableStream({ start(controller) { held.promise.then(() => { try { controller.enqueue(new TextEncoder().encode(html('late'))); controller.close(); } catch {} }); }, cancel() { cancel = true; } })) : null;
  const f = fixture(async () => body ? response : held.promise);
  await f.seed(); let completed = false;
  const pending = f.request().then(response => { completed = true; return response; });
  await flush(); f.advance(5999); await flush(); assert.equal(completed, false);
  f.advance(1); await flush();
  assert.equal(completed, true, 'deadline must cover the complete HTML body');
  assert.match(await (await pending).text(), /cached/);
  assert.equal(f.calls[0].options.signal.aborted, true);
  held.resolve(body ? undefined : new Response(html('late'))); await flush(); await f.settle();
  assert.deepEqual(f.writes, []); assert.match(await f.saved(), /cached/);
  if (body) assert.equal(cancel, true);
  assert.equal(f.timers.size, 0);
});

test('timeout without cache returns an honest 503', async () => {
  const f = fixture(() => new Promise(() => {})); let completed = false;
  const pending = f.request().then(response => { completed = true; return response; });
  await flush(); f.advance(6000); await flush(); assert.equal(completed, true);
  const response = await pending; assert.equal(response.status, 503); assert.match(await response.text(), /offline|unavailable/i);
});
for (const status of [404, 410, 401, 403, 429, 500]) test(`real HTTP ${status} is never replaced by the cached directory`, async () => {
  const f = fixture(async () => new Response(`genuine ${status}`, { status })); await f.seed();
  const response = await f.request(); assert.equal(response.status, status); assert.equal(await response.text(), `genuine ${status}`);
});
for (const path of ['/service/withheld', '/about', '/directoryish']) test(`${path} transient failure remains its original document`, async () => {
  const f = fixture(async () => new Response('source-hidden notice', { status: 503 })); await f.seed();
  assert.equal((await f.request(path)).status, 503); assert.deepEqual(f.reads, []);
});
for (const title of ['withheld notice', 'new release']) test(`successful incompatible ${title} remains the network document`, async () => {
  const f = fixture(async () => new Response(`<title>${title}</title>`)); await f.seed();
  assert.equal(await (await f.request()).text(), `<title>${title}</title>`); await f.settle(); assert.deepEqual(f.writes, []);
});
test('network rejection retains exact/root offline fallback', async () => {
  const f = fixture(async () => { throw new Error('offline'); }); await f.seed();
  assert.match(await (await f.request('/directory/help/food')).text(), /cached/);
});
for (const fail of ['open', 'put', 'match']) test(`${fail} failure cannot hide a current usable network response`, async () => {
  const f = fixture(async () => new Response(html('current')), { fail });
  assert.match(await (await f.request()).text(), /current/); await f.settle();
});
for (const fail of ['open', 'match']) test(`${fail} failure during fallback preserves original transient response`, async () => {
  const f = fixture(async () => new Response('unavailable', { status: 503 }), { fail });
  assert.equal((await f.request()).status, 503);
});
test('older in-flight navigation cannot overwrite the newer compatible page', async () => {
  const held = deferred(); let requests = 0;
  const f = fixture(() => ++requests === 1 ? held.promise : Promise.resolve(new Response(html('newer')))); await f.seed();
  const older = f.request(); await flush(); await f.request();
  held.resolve(new Response(html('older'))); await older; await f.settle();
  assert.match(await f.saved(), /newer/);
});
test('a blocked cache write does not block network delivery and cannot outlive a newer ordered write', async () => {
  const entered = deferred(), release = deferred(); let requests = 0;
  const f = fixture(async () => new Response(html(++requests === 1 ? 'older' : 'newer')), { putHook: async (_key, response) => { if ((await response.clone().text()).includes('older')) { entered.resolve(); await release.promise; } } });
  let completed = false; const older = f.request().then(response => { completed = true; return response; }); await entered.promise; await flush();
  assert.equal(completed, true, 'cache persistence cannot hold the navigation open');
  await f.request(); release.resolve(); await older; await f.settle(); assert.match(await f.saved(), /newer/);
});
test('late old-worker navigation cannot recreate its deleted cache after activation', async () => {
  const held = deferred(), stores = new Map(); const f = fixture(() => held.promise, { release: 'old', stores });
  await f.seed(); const pending = f.request(); await flush(); await f.caches.delete('rwn-offline-old');
  stores.set('rwn-offline-new', new Map()); held.resolve(new Response(html('late old'))); await pending; await f.settle();
  assert.equal(stores.has('rwn-offline-old'), false); assert.equal(stores.get('rwn-offline-new').size, 0);
});
test('404 withdrawal invalidates the cached exact page after any already-started old writer', async () => {
  const entered = deferred(), release = deferred(); let requests = 0;
  const f = fixture(async () => ++requests === 1 ? new Response(html('older')) : new Response('withdrawn', { status: 404 }), { putHook: async (_key, response) => { if ((await response.clone().text()).includes('older')) { entered.resolve(); await release.promise; } } });
  const first = f.request('/directory/help/food'); await entered.promise; const withdrawal = await f.request('/directory/help/food');
  assert.equal(withdrawal.status, 404); release.resolve(); await first; await f.settle(); assert.equal(await f.saved('/directory/help/food'), undefined);
});

test('review: consumed newer response persists behind a slow older cache write', async () => {
  const entered = deferred(), release = deferred(); let requests = 0;
  const f = fixture(async () => new Response(html(++requests === 1 ? 'older' : 'newer')), { putHook: async (_key, response) => { if ((await response.clone().text()).includes('older')) { entered.resolve(); await release.promise; } } });
  const first = f.request(); await entered.promise;
  const current = await f.request(); assert.match(await current.text(), /newer/);
  release.resolve(); await first; await f.settle();
  assert.match(await f.saved(), /newer/);
});
test('review: a transient follow-up cannot cancel a queued withdrawal', async () => {
  const entered = deferred(), release = deferred(); let requests = 0;
  const f = fixture(async () => ++requests === 1 ? new Response(html('older')) : requests === 2 ? new Response('withdrawn', { status: 410 }) : new Response('temporarily unavailable', { status: 503 }), { putHook: async (_key, response) => { if ((await response.clone().text()).includes('older')) { entered.resolve(); await release.promise; } } });
  await f.seed('/directory/help/food', html('previously public'));
  const first = f.request('/directory/help/food'); await entered.promise;
  assert.equal((await f.request('/directory/help/food')).status, 410);
  await f.request('/directory/help/food');
  release.resolve(); await first; await f.settle();
  assert.equal(await f.saved('/directory/help/food'), undefined);
});
test('review: an incompatible withdrawal document is not resurrected on transient follow-up', async () => {
  let requests = 0;
  const f = fixture(async () => ++requests === 1 ? new Response('<title>source-hidden</title>') : new Response('temporarily unavailable', { status: 503 }));
  await f.seed('/directory/help/food', html('previously public'));
  assert.match(await (await f.request('/directory/help/food')).text(), /source-hidden/);
  await f.settle();
  assert.doesNotMatch(await (await f.request('/directory/help/food')).text(), /previously public/);
});

test('review: finishing older put cannot clear withdrawal while ordered deletion is pending', async () => {
  const entered = deferred(), release = deferred(), deleting = deferred(), releaseDelete = deferred(); let requests = 0, deleteStarted = false;
  const f = fixture(async () => ++requests === 1 ? new Response(html('older')) : requests === 2 ? new Response('withdrawn', { status: 410 }) : new Response('unavailable', { status: 503 }), {
    putHook: async (_key, response) => { if ((await response.clone().text()).includes('older')) { entered.resolve(); await release.promise; } },
    deleteHook: async () => { deleteStarted = true; deleting.resolve(); await releaseDelete.promise; }
  });
  await f.seed('/directory/help/food', html('previously public'));
  const first = f.request('/directory/help/food'); await entered.promise;
  assert.equal((await f.request('/directory/help/food')).status, 410);
  release.resolve(); await flush(); await flush(); assert.equal(deleteStarted, true, 'observed withdrawal must begin its ordered deletion'); await deleting.promise;
  const fallback = await f.request('/directory/help/food');
  const body = await fallback.text();
  releaseDelete.resolve(); await first; await f.settle();
  assert.doesNotMatch(body, /previously public|<title>older/);
});
