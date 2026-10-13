import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { catalogFixture, deferred, directory, payload, response, settle } from "./helpers/catalog-fixture.js";

const between = (start, end) => directory.slice(directory.indexOf(start), directory.indexOf(end, directory.indexOf(start)));
function searchFixture(fetch) {
  const catalog = catalogFixture("directory", fetch);
  const effects = { history: 0, restore: 0, rendered: 0 };
  const document = {};
  const input = { value: "current", focus() { document.activeElement = input; } };
  const retry = { hidden: true, attributes: {}, focus() { document.activeElement = retry; },
    setAttribute(key, value) { this.attributes[key] = value; }, getAttribute(key) { return this.attributes[key]; } };
  const results = { hidden: true }, shellClasses = new Set(), events = {};
  const context = vm.createContext({
    document, input, retry, country: { value: "US" }, activeCategory: "food", composing: false, generation: 0,
    clear: {}, root: { classList: { toggle() {} } }, navigator: { onLine: true },
    queryTokens: text => text ? [text] : [], normalize: text => text, scoreRecord: () => 1,
    loadCatalog: catalog.load, results, resultList: { replaceChildren() {}, append() {} },
    shell: { classList: { add(value) { shellClasses.add(value); } } }, collator: new Intl.Collator(),
    scopedRecords: data => data.records.map(record => ({ ...record, country: "US", name: record.id, categoryLabels: ["food"] })),
    syncCategoryLabels() {}, activeMatches: [], visibleCount: 0, scopedCount: 0, restored: null, restorePending: false,
    renderNext() { effects.rendered++; }, format: value => String(value),
    clearGlobalResults() { results.hidden = true; shellClasses.delete("has-global-search"); },
    announce(text) { effects.message = text; }, restoreView() { effects.restore++; },
    queueView() {}, remember() { effects.history++; }, cancelInput() {}, stopRestore() {}, renderChips() {},
    listen(node, type, callback) { events[type] = callback; },
    showConnectivityState() {}
  });
  document.activeElement = input;
  const showRetry = between("const showRetry=", "const country=");
  const apply = between("const apply=", "const reset=");
  const reset = between("const reset=", "let inputTimer;");
  vm.runInContext(`${showRetry}\n${apply}\n${reset}\nglobalThis.search=apply;globalThis.resetSearch=reset;`, context);
  const retryListener = between('listen(retry,"click"', 'listen(chips,"click"');
  if (retryListener) vm.runInContext(retryListener, context);
  return { ...catalog, document, input, retry, results, context, effects,
    search: context.search, reset: context.resetSearch, clickRetry: () => events.click?.(),
    leave() { context.generation++; }
  };
}

for (const stage of ["headers", "JSON"]) {
  test(`directory ${stage} stall exposes Retry, retains filters/static browsing and recovers with keyboard focus`, async () => {
    const stalled = deferred(), fresh = deferred();
    let attempts = 0;
    const f = searchFixture(() => ++attempts === 1 ? (stage === "headers" ? stalled.promise : { ok: true, json: () => stalled.promise }) : fresh.promise);
    f.search(); await settle();
    assert.match(f.effects.message, /Searching/);
    f.advance(8000); await settle();
    assert.equal(f.retry.hidden, false);
    assert.equal(f.results.hidden, true, "static browse results remain available");
    assert.equal(f.input.value, "current");
    assert.equal(f.context.country.value, "US");
    assert.equal(f.context.activeCategory, "food");
    f.retry.focus(); f.clickRetry(); await settle();
    assert.equal(f.retry.hidden, false);
    assert.equal(f.document.activeElement, f.retry);
    assert.equal(f.retry.getAttribute("aria-disabled"), "true");
    for (let i = 0; i < 5; i++) f.clickRetry();
    await settle(); assert.equal(attempts, 2);
    fresh.resolve(response()); await settle();
    assert.equal(f.results.hidden, false);
    assert.equal(f.retry.hidden, true);
    assert.equal(f.document.activeElement, f.input);
    assert.equal(f.effects.rendered, 1);
  });
}

test("directory Clear cancels the pending presentation without late failure or success restoring it", async () => {
  for (const outcome of ["success", "failure"]) {
    const pending = deferred();
    const f = searchFixture(() => pending.promise);
    f.search(); await settle(); f.reset();
    const rendered = f.effects.rendered;
    if (outcome === "success") pending.resolve(response());
    else pending.reject(new Error("offline"));
    await settle();
    assert.equal(f.input.value, ""); assert.equal(f.context.country.value, "");
    assert.equal(f.context.activeCategory, ""); assert.equal(f.retry.hidden, true);
    assert.equal(f.results.hidden, true); assert.equal(f.effects.rendered, rendered);
    assert.equal(f.document.activeElement, f.input);
  }
});

test("directory Retry never steals focus moved to another control", async () => {
  const fresh = deferred(); let attempts = 0;
  const f = searchFixture(() => ++attempts === 1 ? Promise.reject(new Error("offline")) : fresh.promise);
  await f.search(); f.retry.focus(); f.clickRetry(); await settle();
  const other = {}; f.document.activeElement = other;
  fresh.resolve(response()); await settle();
  assert.equal(f.document.activeElement, other);
});

test("directory Back/newer navigation supersedes a timeout without changing its presentation", async () => {
  const f = searchFixture(() => new Promise(() => {}));
  f.search(); await settle(); f.leave();
  f.effects.message = "Restored previous page";
  f.advance(8000); await settle();
  assert.equal(f.effects.message, "Restored previous page");
  assert.equal(f.retry.hidden, true);
});
