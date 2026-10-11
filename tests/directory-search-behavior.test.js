import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/directory.js", import.meta.url), "utf8");
function bodyBetween(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const catalogSource = bodyBetween("const loadCatalog=", "const clearGlobalResults=");
const paginationSource = bodyBetween("const renderNext=", "more.addEventListener");
const applySource = bodyBetween("const apply=", "const reset=");

function catalogFixture(fetch) {
  const context = vm.createContext({ fetch, catalogPromise: undefined, freshCatalog: false, searchIndexUrl: "/data/search-index.json?v=test" });
  vm.runInContext(`${catalogSource}\nglobalThis.load = loadCatalog;`, context);
  return context;
}
const catalog = { records: [], scopes: {} };
const response = (payload = catalog) => ({ ok: true, json: async () => payload });

test("a transient index failure can be retried without reloading the directory", async () => {
  let attempts = 0;
  const f = catalogFixture(async () => { if (++attempts === 1) throw new Error("Offline"); return response(); });
  await assert.rejects(f.load(), /Offline/);
  assert.equal(f.catalogPromise, undefined);
  assert.equal(await f.load(), catalog);
  assert.equal(attempts, 2);
});

test("HTTP and malformed-index failures also permit recovery", async () => {
  for (const initial of [{ ok: false, status: 503 }, response({ records: null, scopes: {} })]) {
    let attempts = 0;
    const f = catalogFixture(async () => ++attempts === 1 ? initial : response());
    await assert.rejects(f.load());
    assert.equal(await f.load(), catalog);
    assert.equal(attempts, 2);
  }
});

test("concurrent index users share one request and successful data stays cached", async () => {
  let attempts = 0;
  const requests = [];
  const f = catalogFixture(async (...args) => { attempts += 1; requests.push(args); return response(); });
  const first = f.load();
  assert.equal(f.load(), first);
  await first;
  assert.equal(await f.load(), catalog);
  assert.equal(attempts, 1);
  assert.equal(requests[0][0], "/data/search-index.json?v=test");
  assert.equal(requests[0][1].credentials, "same-origin");
});

function pageFixture(total) {
  const appended = [];
  const f = vm.createContext({
    activeMatches: Array.from({ length: total }, (_, id) => ({ id })), visibleCount: 0,
    MAX_RESULTS: 60, scopedCount: 2019, resultRow: (record) => record,
    resultList: { append: (...rows) => appended.push(...rows) }, more: {}, resultSummary: {}
  });
  vm.runInContext(`${paginationSource}\nglobalThis.next = renderNext;`, f);
  return { f, appended };
}

for (const total of [0, 1, 60, 61, 120, 302]) {
  test(`${total} matches can all be reached in ordered batches without duplicates`, () => {
    const { f, appended } = pageFixture(total);
    do {
      const previous = appended.length;
      const first = f.next();
      assert.ok(appended.length - previous <= 60);
      if (previous < total) assert.equal(first.id, previous);
      assert.equal(f.more.hidden, appended.length === total);
    } while (!f.more.hidden);
    assert.equal(appended.length, total);
    assert.deepEqual(appended.map((row) => row.id), Array.from({ length: total }, (_, id) => id));
    assert.equal(f.resultSummary.textContent, `Showing ${total} of ${total} matches across 2,019 listings`);
  });
}

test("an older pending search cannot replace newer input or reset state", async () => {
  let resolve;
  let renderCalls = 0;
  const pending = new Promise((done) => { resolve = done; });
  const f = vm.createContext({
    input: { value: "New York" }, activeCategory: "", generation: 0, composing: false,
    queryTokens: (value) => value.split(" "), clear: {}, root: { classList: { toggle() {} } },
    count: {}, loadCatalog: () => pending,
    syncCategoryLabels: () => { renderCalls += 1; }
  });
  vm.runInContext(`${applySource}\nglobalThis.search = apply;`, f);
  const running = f.search();
  f.input.value = "Bowery";
  f.generation += 1;
  resolve(catalog);
  await running;
  assert.equal(f.input.value, "Bowery");
  assert.equal(renderCalls, 0);
});

test("shipped directory entry stays self-contained for existing offline workers", async () => {
  const client = await readFile("dist/directory.js", "utf8");
  const { directoryRelease, offlineAssets } = JSON.parse(await readFile("dist/data/release.json", "utf8"));
  assert.match(client, /directory-global-result-wrap/);
  assert.doesNotMatch(client, /from[\s]*["\'].*search\.js/);
  assert.doesNotMatch(client, /import.*directory-results/);
  assert.ok(Buffer.byteLength(client) <= 14_000, "bundled entry must stay inside the existing directory client budget");
  const page = await readFile("dist/directory/index.html", "utf8");
  assert.ok(page.includes(`${offlineAssets["/directory.js"]}?v=${directoryRelease}`));
  const worker = await readFile("dist/sw.js", "utf8");
  assert.doesNotMatch(worker, /"\/directory-results\.js"/);
  assert.match(source, /aria-controls="directory-global-list"/);
  assert.match(source, /renderNext\(\)\?\.querySelector\("a"\)\?\.focus\(\)/);
});


test("a failed older search cannot clear newer results after input changes or reset", async () => {
  let reject;
  let clearCalls = 0;
  const pending = new Promise((_, fail) => { reject = fail; });
  const f = vm.createContext({
    input: { value: "New York" }, activeCategory: "", generation: 0, composing: false,
    queryTokens: (value) => value.split(" "), clear: {}, root: { classList: { toggle() {} } },
    count: {}, loadCatalog: () => pending, clearGlobalResults: () => { clearCalls += 1; }
  });
  vm.runInContext(`${applySource}\nglobalThis.search = apply;`, f);
  const running = f.search();
  f.generation += 1;
  f.input.value = "";
  f.count.textContent = "60 listings on this page";
  reject(new Error("Old request failed"));
  await running;
  assert.equal(clearCalls, 0);
  assert.equal(f.count.textContent, "60 listings on this page");
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const controllerSource = bodyBetween('navigator.serviceWorker?.addEventListener("controllerchange"', 'input?.addEventListener("focus"');

function updateFixture(fetch) {
  let changed, cleared = 0, searches = 0, cancelled;
  const f = vm.createContext({
    fetch, catalogPromise: undefined, freshCatalog: false, searchIndexUrl: "/data/search-index.json?v=old",
    input: { value: "Fixture" }, activeCategory: "food", generation: 0, inputTimer: 42,
    navigator: { serviceWorker: { addEventListener(type, handler) { assert.equal(type, "controllerchange"); changed = handler; } } },
    clearTimeout(timer) { cancelled = timer; },
    clearGlobalResults() { cleared += 1; },
    apply() { searches += 1; }
  });
  vm.runInContext(`${catalogSource}\n${controllerSource}\nglobalThis.load = loadCatalog;`, f);
  return { f, change: () => changed(), effects: () => ({ cleared, searches, cancelled }) };
}

test("controller replacement discards an old catalog and search results without resetting input or category", async () => {
  const calls = [];
  const old = { records: [{ id: "synthetic-removed" }], scopes: {} };
  const fresh = { records: [], scopes: {} };
  const fixture = updateFixture(async (...args) => { calls.push(args); return response(calls.length === 1 ? old : fresh); });
  const { f } = fixture;
  assert.equal(await f.load(), old);
  fixture.change();
  assert.equal(f.catalogPromise, undefined);
  assert.equal(f.generation, 1);
  assert.equal(f.input.value, "Fixture");
  assert.equal(f.activeCategory, "food");
  assert.deepEqual(fixture.effects(), { cleared: 1, searches: 1, cancelled: 42 });
  assert.equal(await f.load(), fresh);
  assert.equal(calls[1][0], "/data/search-index.json");
  assert.equal(calls[1][1].cache, "reload");
  assert.equal(calls[1][1].credentials, "same-origin");
  assert.doesNotMatch(controllerSource, /location|reload\(|input\.value|activeCategory=/);
});

test("an older failed request cannot discard the newer catalog promise after replacement", async () => {
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const fixture = updateFixture(() => (++calls === 1 ? old : fresh).promise);
  const previous = fixture.f.load();
  const previousRejected = assert.rejects(previous, /Old request/);
  fixture.change();
  const current = fixture.f.load();
  old.reject(new Error("Old request"));
  await previousRejected;
  assert.equal(fixture.f.catalogPromise, current);
  assert.equal(fixture.f.load(), current);
  fresh.resolve(response());
  assert.equal(await current, catalog);
  assert.equal(calls, 2);
});

test("an older successful request cannot overwrite a replacement catalog", async () => {
  const old = deferred();
  let calls = 0;
  const fixture = updateFixture(() => ++calls === 1 ? old.promise : Promise.resolve(response()));
  const previous = fixture.f.load();
  fixture.change();
  const current = fixture.f.load();
  await current;
  old.resolve(response({ records: [{ id: "synthetic-removed" }], scopes: {} }));
  await previous;
  assert.equal(fixture.f.catalogPromise, current);
  assert.equal(await fixture.f.load(), catalog);
});

test("replacement reload failure stays retryable without restoring the previous catalog", async () => {
  for (const failure of [new Error("Offline"), { ok: false, status: 503 }, response({ records: null, scopes: {} })]) {
    let calls = 0;
    const fixture = updateFixture(async (_, options) => {
      if (++calls === 1) return response({ records: [{ id: "synthetic-removed" }], scopes: {} });
      assert.equal(options.cache, "reload");
      if (calls === 2) { if (failure instanceof Error) throw failure; return failure; }
      return response();
    });
    await fixture.f.load();
    fixture.change();
    await assert.rejects(fixture.f.load());
    assert.equal(fixture.f.catalogPromise, undefined);
    assert.equal(fixture.f.input.value, "Fixture");
    assert.equal(await fixture.f.load(), catalog);
    assert.equal(calls, 3);
  }
});

test("repeated controller replacements invalidate earlier search generations without reloading the document", async () => {
  const fixture = updateFixture(async () => response());
  fixture.change(); fixture.change();
  assert.equal(fixture.f.generation, 2);
  assert.equal(fixture.f.input.value, "Fixture");
  assert.equal(fixture.effects().searches, 2);
});

test("a pre-replacement focus prefetch cannot restore older category chips", async () => {
  const pending = deferred();
  let focus, categories = 0;
  const fixture = updateFixture(() => pending.promise);
  fixture.f.input.addEventListener = (type, handler) => { assert.equal(type, "focus"); focus = handler; };
  fixture.f.syncCategoryLabels = () => { categories += 1; };
  const focusSource = bodyBetween('input?.addEventListener("focus"', 'input?.addEventListener("input"');
  vm.runInContext(focusSource, fixture.f);
  focus();
  fixture.change();
  pending.resolve(response({ records: [{ id: "synthetic-removed" }], scopes: {} }));
  await pending.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(categories, 0);
});
