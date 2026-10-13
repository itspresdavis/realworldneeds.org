import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { SAVED_REFRESH_WIDTHS, SAVED_REFRESH_COUNTS, installSavedRefreshFixture, assertSavedRefreshRetained } from "../scripts/qa-saved-refresh.mjs";

const host = "http://127.0.0.1:4181";
const records = [{ id: "first", phoneLinks: [{ href: "tel:+12025550147" }] }, { id: "withdrawn" }];
const ids = ["first", "withdrawn", "unknown"];
function fixture(origin = host) {
  class Storage {
    constructor() { this.entries = new Map(); }
    get length() { return this.entries.size; }
    key(index) { return [...this.entries.keys()][index]; }
    getItem(key) { return this.entries.get(key) ?? null; }
    setItem(key, value) { this.entries.set(String(key), String(value)); }
    removeItem(key) { this.entries.delete(key); }
    clear() { this.entries.clear(); }
  }
  const localStorage = new Storage(), passthrough = [];
  localStorage.setItem("existing-unrelated", "keep this too");
  const context = vm.createContext({ Storage, Event, EventTarget, DOMException, Response, URL, AbortController, setTimeout, clearTimeout,
    location: new URL(`${origin}/directory#saved`), document: new EventTarget(), navigator: { serviceWorker: new EventTarget() },
    localStorage, fetch: (...args) => { passthrough.push(args); return Promise.resolve("native"); } });
  vm.runInContext(`globalThis.window = globalThis; (${installSavedRefreshFixture})(${JSON.stringify(host)},${JSON.stringify(ids)},${JSON.stringify(records)})`, context);
  return { context, probe: context.__rwnSavedRefreshQA, localStorage, passthrough };
}

test("Saved refresh CI covers one extra row and multiple pages on desktop and mobile", () => {
  assert.deepEqual(SAVED_REFRESH_WIDTHS, [1440, 390]);
  assert.deepEqual(SAVED_REFRESH_COUNTS, [61, 121]);
});

test("fixture is origin-scoped and never seeds or intercepts a production document", () => {
  for (const origin of ["https://realworldneeds.com", "http://localhost:4182"]) {
    const { context, probe, localStorage } = fixture(origin);
    assert.equal(probe, undefined);
    assert.equal(localStorage.getItem("rwn-saved-resources"), null);
    assert.equal(localStorage.length, 1);
    assert.equal(context.fetch.name, "fetch");
  }
});

test("fixture dispatches registered controllerchange, holds the real loader reset, and releases reviewed records without writes", async () => {
  const { context, probe, localStorage, passthrough } = fixture();
  const loaderSource = await readFile("public/catalog-request.js", "utf8");
  vm.runInContext(loaderSource.replace("export function", "function"), context);
  const loader = context.createCatalogLoader("/data/search-index.json?v=fixture");
  assert.deepEqual((await loader()).records.map(record => record.id), ["first", "withdrawn"]);
  let refreshed, fulfilled = false;
  context.navigator.serviceWorker.addEventListener("controllerchange", () => { loader.reset(); refreshed = loader().then(payload => { fulfilled = true; return payload; }); });
  probe.begin();
  assert.equal(probe.controllerChanges, 1);
  assert.equal(probe.pending, 1);
  assert.equal(probe.requests.at(-1).cache, "reload");
  assert.equal(probe.requests.at(-1).status, "held");
  await Promise.resolve();
  assert.equal(fulfilled, false);
  assert.throws(() => probe.begin(), /already pending/);
  probe.release({ withdrawn: ["withdrawn"], withoutPhone: ["first"] });
  const payload = await refreshed;
  assert.deepEqual(payload.records.map(record => record.id), ["first"]);
  assert.deepEqual(payload.records[0].phoneLinks, []);
  assert.equal(probe.pending, 0);
  assert.equal(probe.requests.at(-1).status, "fulfilled");
  assert.equal(probe.writes.length, 0);
  assert.equal(probe.stored(), JSON.stringify(ids));
  assert.equal(localStorage.getItem("existing-unrelated"), "keep this too");
  assert.equal(localStorage.getItem("qa-saved-refresh-unrelated"), "keep");
  assert.equal(JSON.stringify(probe.values()), JSON.stringify(probe.baseline));
  assert.throws(() => probe.release(), /No controllerchange/);
  assert.equal(await context.fetch("/data/release.json"), "native");
  assert.equal(await context.fetch("https://example.com/data/search-index.json"), "native");
  assert.equal(passthrough.length, 2);
});

test("held requests remain abortable rather than changing production timeout behavior", async () => {
  const { context, probe } = fixture();
  const controller = new AbortController();
  probe.begin();
  const pending = context.fetch("/data/search-index.json", { cache: "reload", signal: controller.signal });
  assert.equal(probe.pending, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(probe.pending, 0);
  assert.equal(probe.requests.at(-1).status, "aborted");
  assert.equal(probe.writes.length, 0);
});

test("fixture audits set, remove and clear for Saved and every unrelated local key", () => {
  const { context, probe, localStorage } = fixture();
  localStorage.setItem("rwn-saved-resources", "[]");
  localStorage.setItem("unexpected-key", "bad");
  localStorage.removeItem("qa-saved-refresh-unrelated");
  localStorage.clear();
  assert.deepEqual(JSON.parse(JSON.stringify(probe.writes)), [
    { method: "setItem", key: "rwn-saved-resources" }, { method: "setItem", key: "unexpected-key" },
    { method: "removeItem", key: "qa-saved-refresh-unrelated" }, { method: "clear", key: null }
  ]);
  const anotherStore = new context.Storage();
  anotherStore.setItem("not-local-storage", "ok");
  assert.equal(probe.writes.length, 4);
});

function states() {
  const allIds = Array.from({ length: 121 }, (_, index) => `saved-${index}`);
  const baseline = { "qa-saved-refresh-unrelated": "keep", "rwn-saved-resources": JSON.stringify(allIds) };
  const before = { url: `${host}/directory#saved`, timeOrigin: 123, title: "Saved services | Real World Needs", phase: 1, controllerChanges: 1,
    pending: 1, loading: true, moreHidden: true, overflow: false, rows: allIds.map(id => ({ id, unavailable: false, removable: true, unavailableMessage: false })),
    requests: [{ phase: 1, cache: "reload", status: "held" }], keys: [{ phase: 1, key: "Enter", trusted: true }],
    clicks: [{ phase: 1, more: true, href: null, trusted: true }], writes: [], stored: JSON.stringify(allIds), storage: { ...baseline }, baseline,
    focus: { row: allIds[120], id: "", tag: "A", href: `/service/${allIds[120]}`, className: "directory-global-result", remove: null, connected: true, visible: true, body: false, outside: false } };
  const after = structuredClone(before);
  after.pending = 0; after.loading = false;
  after.requests[0].status = "fulfilled";
  after.rows[3].unavailable = true;
  after.rows[3].unavailableMessage = true;
  return { before, after, expected: { ids: allIds, unavailable: [allIds[3]] } };
}

test("refresh oracle rejects both original count/focus regressions and lost latest control identity", () => {
  const { before, after, expected } = states();
  assertSavedRefreshRetained(before, after, expected);
  for (const mutate of [
    state => { state.rows = state.rows.slice(0, 60); state.moreHidden = false; },
    state => { state.focus.row = expected.ids[0]; state.focus.href = `/service/${expected.ids[0]}`; },
    state => { state.focus.className = "is-details"; },
    state => { state.focus.remove = expected.ids[120]; },
    state => { state.focus.connected = false; },
    state => { state.focus.visible = false; },
    state => { state.focus.body = true; },
    state => { state.rows[3].unavailable = false; },
    state => { state.rows[3].removable = false; },
    state => { state.rows[3].unavailableMessage = false; },
    state => { state.rows.splice(3, 1); },
    state => { state.rows.reverse(); }
  ]) {
    const candidate = structuredClone(after); mutate(candidate);
    assert.throws(() => assertSavedRefreshRetained(before, candidate, expected));
  }
});

test("refresh oracle demands a held reset request, native input, actual settlement and unchanged storage", () => {
  for (const [target, mutate] of [
    ["before", state => { state.pending = 0; }], ["before", state => { state.loading = false; }],
    ["before", state => { state.controllerChanges = 0; }], ["before", state => { state.requests[0].cache = "force-cache"; }],
    ["before", state => { state.requests[0].status = "fulfilled"; }], ["before", state => { state.requests.push(state.requests[0]); }],
    ["before", state => { state.keys = []; }], ["before", state => { state.keys[0].trusted = false; }],
    ["before", state => { state.clicks[0].trusted = false; }], ["before", state => { state.clicks[0].href = "tel:+12025550147"; }],
    ["after", state => { state.pending = 1; }], ["after", state => { state.loading = true; }],
    ["after", state => { state.requests[0].status = "aborted"; }], ["after", state => { state.timeOrigin++; }],
    ["after", state => { state.url = `${host}/directory`; }], ["after", state => { state.phase++; }],
    ["after", state => { state.controllerChanges++; }], ["after", state => { state.overflow = true; }],
    ["after", state => { state.writes.push({ method: "setItem", key: "unexpected" }); }],
    ["after", state => { state.stored = "[]"; }],
    ["after", state => { state.storage["qa-saved-refresh-unrelated"] = "changed"; }]
  ]) {
    const state = states(); mutate(state[target]);
    assert.throws(() => assertSavedRefreshRetained(state.before, state.after, state.expected));
  }
});

test("outside-focus oracle requires the very same connected newer target", () => {
  const { before, after, expected } = states();
  before.focus = { row: null, id: "", tag: "A", href: "/", className: null, remove: null, connected: true, visible: true, body: false, outside: true };
  after.focus = { ...before.focus };
  before.outsideSameNode = after.outsideSameNode = true;
  const options = { ...expected, outside: true };
  assertSavedRefreshRetained(before, after, options);
  assert.throws(() => assertSavedRefreshRetained(before, { ...after, outsideSameNode: false }, options));
  assert.throws(() => assertSavedRefreshRetained({ ...before, outsideSameNode: false }, after, options));
});

test("existing Saved runner invokes bounded native-input cases and always removes fixture injection", async () => {
  const source = await readFile("scripts/qa-saved-refresh.mjs", "utf8"), runner = await readFile("scripts/browser-saved-services.mjs", "utf8");
  assert.match(runner, /await verifySavedRefresh\(\{ client, host: HOST, records, navigate, evaluate, capture, waitForUI, qaDir: QA_DIR \}\)/);
  for (const marker of ["Page.addScriptToEvaluateOnNewDocument", "Page.removeScriptToEvaluateOnNewDocument", "saved-refresh-continuity.json", "saved-refresh-expanded-", "saved-refresh-outside-", "saved-refresh-failure.png", "expanded-during-refresh", "newer-row-and-control", "newer-outside-focus"]) assert.ok(source.includes(marker));
  assert.match(source, /navigator\.serviceWorker\.dispatchEvent\(new Event\("controllerchange"\)\)/);
  assert.match(source, /tabs < 12/);
  assert.match(source, /await key\("Enter"\)/);
  assert.match(source, /await key\("Tab"\)/);
  assert.match(source, /finally \{[\s\S]*Page\.removeScriptToEvaluateOnNewDocument[\s\S]*navigate\(client, "about:blank"\)/);
  assert.doesNotMatch(source, /\.click\(|new KeyboardEvent|Input\.dispatchKeyEvent|setOffline|setBypassServiceWorker|8000.*replace|fetch\([^)]*tel:/);
});
