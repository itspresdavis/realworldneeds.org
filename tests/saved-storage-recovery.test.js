import { searchGeographyChoices } from "../src/utils/search.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { installSavedStorageFixture } from "../scripts/qa-saved-storage.mjs";

const root = process.env.RWN_STORAGE_SOURCE_ROOT ? new URL(`file://${process.env.RWN_STORAGE_SOURCE_ROOT}/`) : new URL("../", import.meta.url);
const app = await readFile(new URL("src/app.js", root), "utf8");
const service = await readFile(new URL("public/service-actions.js", root), "utf8");
const privacy = (await readFile(new URL("src/utils/privacy.js", root), "utf8")).replaceAll("export ", "");
const between = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
  return source.slice(first, last);
};

function storageFixture(initial = '["first","unavailable-record"]') {
  const values = new Map([["rwn-saved-resources", initial], ["unrelated", "keep"]]);
  let denial = "", writes = 0;
  const storage = {
    getItem(key) { if (denial === "read") throw new Error("Denied read"); return values.get(key) ?? null; },
    setItem(key, value) { if (denial === "write") throw new Error("Quota"); writes++; values.set(key, value); },
    removeItem(key) { if (denial === "write") throw new Error("Removal denied"); writes++; values.delete(key); }
  };
  const events = {}, window = { addEventListener: (name, callback) => { events[name] = callback; } };
  Object.defineProperty(window, "localStorage", { get() { if (denial === "getter") throw new Error("Denied storage getter"); return storage; } });
  return { window, events, values, storage, deny: value => { denial = value; }, writes: () => writes };
}

function finderFixture({ denied = "", initial } = {}) {
  const f = storageFixture(initial); f.deny(denied);
  const document = { activeElement: null, dispatchEvent() {} }, nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, attributes: {}, hidden: false, textContent: "", innerHTML: "", events: {},
      classList: { toggle() {} }, setAttribute(name, value) { this.attributes[name] = String(value); },
      focus() { document.activeElement = this; }, addEventListener(name, callback) { this.events[name] = callback; } });
    return nodes.get(id);
  };
  document.getElementById = node;
  const records = [{ id: "first", name: "First", kind: "direct" }, { id: "second", name: "Second", kind: "direct" }];
  const state = { savedIds: new Set(), savedStorageUnavailable: false, savedOnly: false, filtered: records, visibleResults: 8,
    viewMode: "aid", query: "First", accessMode: "all", activeTypes: new Set(["food"]), selectedId: "first", inspectorOpen: true };
  let resultsRenders = 0, panelRenders = 0;
  const messages = [], history = [];
  const context = vm.createContext({ window: f.window, document, state, resources: records, URL, URLSearchParams,
    renderResourcePanel() { panelRenders++; }, renderClusterTray() {}, wakeGlobe() {}, syncGlobePointLayer() {},
    availableResources: () => records, matchesResource: record => !state.query || record.name === state.query,
    searchGeographyChoices, resourceSearchScore: () => 1, initialResultCount: () => 8, pinSignature: "",
    CustomEvent: class { constructor(type) { this.type = type; } },
    resourceCard(record) { resultsRenders++; return `<article>${record.id}</article>`; },
    refreshSearchPreparation() {}, nearbyExactCount: () => 0, notify: message => messages.push(message),
    writeFinderHistory: mode => history.push(mode), hasMapCoordinates: () => true,
    clearUserLocation: () => { state.userLocation = null; context.updateFilters(); }
  });
  const load = between(app, "function loadSavedResources()", "\nconst requestedResource");
  const controls = between(app, '  const savedToggle = document.getElementById("toggleSaved");', "  renderLiveSourceState();");
  const counts = between(app, "  const mappedCount = state.filtered.filter(hasMapCoordinates).length;", '  const savedToggle = document.getElementById("toggleSaved");');
  const globeEmpty = between(app, '  const empty = document.getElementById("globeEmpty");', "\n}\n\nfunction serviceLayerTags(");
  const filters = between(app, "function updateFilters()", "\nfunction nearbyExactCount(");
  const results = between(app, "function emptyResultsCopy(", "\nfunction setSelected(");
  const actions = between(app, "function toggleSavedResource(", "\nasync function copyText(");
  const legacyRefresh = app.includes("  const refreshSavedResources = () => {")
    ? between(app, "  const refreshSavedResources = () => {", '  window.addEventListener("pageshow", refreshSavedResources);') : "";
  const listeners = between(app, '  window.addEventListener("pageshow", refreshSavedResources);', '  document.getElementById("downloadDirectory").addEventListener');
  const clear = between(app, '  document.getElementById("clearBrowserData").addEventListener', '  window.addEventListener("rwn:offline-unavailable"');
  vm.runInContext(`${privacy}\n${load}\nfunction renderControls() { const aidMode = state.viewMode === "aid"; ${counts}\n${controls}\n${globeEmpty} }\n${filters}\n${results}\n${actions}\n${legacyRefresh}\n${listeners}\n${clear}`, context);
  state.savedIds = context.loadSavedResources();
  context.updateFilters();
  return { ...f, document, node, state, context, messages, history,
    click(id) { node(id).focus(); node(id).events.click(); },
    rowRenders: () => resultsRenders, panelRenders: () => panelRenders };
}

for (const denied of ["getter", "read"]) {
  test(`finder ${denied} denial is unavailable rather than an empty saved list`, () => {
    const f = finderFixture({ denied });
    assert.equal(f.state.savedStorageUnavailable, true);
    assert.equal(f.node("savedCount").textContent, "Unavailable");
    assert.equal(f.node("retrySavedServices").hidden, false);
    assert.match(f.node("savedStorageStatus").textContent, /could not be read/);
    assert.equal(f.state.filtered.length, 1, "ordinary searching remains usable");
    f.click("toggleSaved");
    assert.match(f.node("resourceGrid").innerHTML, /Saved services are unavailable/);
    assert.doesNotMatch(f.node("resourceGrid").innerHTML, /No saved services yet/);
    assert.match(f.node("globeEmpty").innerHTML, /Saved services are unavailable/);
    assert.doesNotMatch(f.node("globeEmpty").innerHTML, /No saved services match/);
    assert.doesNotMatch(f.node("resultCount").textContent, /Showing 0 of 0/);
    assert.equal(f.node("searchStatus").textContent, "Saved list unavailable");
    assert.equal(f.node("globeCount").textContent, "Saved unavailable");
    assert.equal(f.node("matchingResultCount").textContent, "Saved unavailable");
    assert.equal(f.values.get("rwn-saved-resources"), '["first","unavailable-record"]');
    assert.equal(f.values.get("unrelated"), "keep"); assert.equal(f.writes(), 0);
  });
}

test("later finder denial retains the last in-memory list, selection, pagination and rows with a stale-state warning", () => {
  const f = finderFixture(); f.click("toggleSaved");
  f.state.visibleResults = 120;
  const renders = f.rowRenders();
  f.deny("read"); f.events.pageshow();
  assert.deepEqual([...f.state.savedIds], ["first"]);
  assert.equal(f.state.selectedId, "first"); assert.equal(f.state.inspectorOpen, true);
  assert.equal(f.state.visibleResults, 120); assert.equal(f.rowRenders(), renders);
  assert.match(f.node("resultCount").textContent, /previously loaded.*unavailable/);
  assert.match(f.node("savedStorageStatus").textContent, /may be out of date/);
  assert.equal(f.node("matchingResultCount").textContent, "Saved unavailable");
  assert.equal(f.node("savedCount").textContent, "Unavailable"); assert.equal(f.writes(), 0);
});

for (const initial of ['[]', '["first","unavailable-record"]']) {
  test(`finder retries recover a ${initial === '[]' ? 'genuine empty' : 'populated'} list without changing filters or history`, () => {
    const f = finderFixture({ denied: "read", initial }); f.click("toggleSaved");
    const before = { query: f.state.query, access: f.state.accessMode, types: [...f.state.activeTypes], history: [...f.history] };
    for (let i = 0; i < 3; i++) {
      f.click("retrySavedServices");
      assert.equal(f.document.activeElement, f.node("retrySavedServices"));
      assert.equal(f.node("retrySavedServices").hidden, false);
      assert.match(f.node("resourceGrid").innerHTML, /Saved services are unavailable/);
    }
    f.deny(""); f.click("retrySavedServices");
    assert.equal(f.node("savedStorageStatus").hidden, true); assert.equal(f.node("savedStorageStatus").textContent, "");
    assert.equal(f.node("retrySavedServices").hidden, true); assert.equal(f.state.savedStorageUnavailable, false);
    assert.equal(f.document.activeElement, f.node("toggleSaved"), "a hidden Retry must return focus to Saved");
    assert.equal(f.node("savedCount").textContent, initial === '[]' ? "0" : "1");
    assert.match(f.node("resourceGrid").innerHTML, initial === '[]' ? /No saved services yet/ : /<article>first/);
    assert.deepEqual({ query: f.state.query, access: f.state.accessMode, types: [...f.state.activeTypes], history: [...f.history] }, before);
    assert.equal(f.values.get("rwn-saved-resources"), initial); assert.equal(f.writes(), 0);
  });
}

test("storage events reread only the saved key or clear and do not steal unrelated focus on recovery", () => {
  const f = finderFixture({ denied: "read" }); f.node("resourceSearch").focus();
  f.deny(""); f.events.storage({ key: "other-key" }); assert.equal(f.state.savedStorageUnavailable, true);
  f.events.storage({ key: "rwn-saved-resources" }); assert.equal(f.state.savedStorageUnavailable, false);
  assert.equal(f.document.activeElement, f.node("resourceSearch"));
  f.values.delete("rwn-saved-resources"); f.events.storage({ key: null });
  assert.equal(f.node("savedCount").textContent, "0"); assert.equal(f.writes(), 0);
});

test("finder repeated save/remove uses returned persisted IDs and preserves unavailable IDs and unrelated storage", () => {
  const f = finderFixture();
  for (const expected of [false, true, false]) {
    f.context.toggleSavedResource("first");
    assert.equal(f.state.savedIds.has("first"), expected);
    assert.equal(JSON.parse(f.values.get("rwn-saved-resources")).includes("first"), expected);
    assert.ok(JSON.parse(f.values.get("rwn-saved-resources")).includes("unavailable-record"));
  }
  assert.equal(f.state.savedStorageUnavailable, false); assert.equal(f.values.get("unrelated"), "keep");
});

for (const denied of ["read", "write"]) {
  test(`finder ${denied} failure never reports a successful mutation or loses IDs`, () => {
    const f = finderFixture(); f.deny(denied); f.context.toggleSavedResource("first");
    assert.match(f.messages.at(-1), /could not be changed/);
    assert.equal(f.values.get("rwn-saved-resources"), '["first","unavailable-record"]');
    assert.equal(f.state.savedStorageUnavailable, denied === "read"); assert.equal(f.writes(), 0);
  });
}

test("a failed mutation preserves an expanded Saved view when persisted membership is unchanged", () => {
  const f = finderFixture();
  for (let i = 2; i < 20; i++) f.context.resources.push({ id: `row-${i}`, name: `Row ${i}`, kind: "direct" });
  f.values.set("rwn-saved-resources", JSON.stringify(f.context.resources.map(record => record.id)));
  f.state.query = ""; f.click("toggleSaved");
  f.state.visibleResults = 16; f.context.renderResults();
  const before = f.node("resourceGrid").innerHTML;
  f.deny("write"); f.context.toggleSavedResource("first");
  assert.equal(f.state.visibleResults, 16); assert.equal(f.state.savedIds.size, 20);
  assert.equal(f.node("resourceGrid").innerHTML, before);
  assert.match(f.messages.at(-1), /could not be changed/); assert.equal(f.writes(), 0);
  assert.doesNotMatch(f.node("resultCount").textContent, /unavailable/);
});

for (const stillDenied of [false, true]) {
  test(`explicit Clear rereads availability when reads ${stillDenied ? 'remain denied' : 'recover'}`, () => {
    const f = finderFixture({ denied: "read" });
    if (!stillDenied) f.deny("");
    f.click("clearBrowserData");
    assert.equal(f.values.has("rwn-saved-resources"), false); assert.equal(f.values.get("unrelated"), "keep");
    assert.equal(f.state.savedIds.size, 0); assert.equal(f.state.savedOnly, false);
    assert.equal(f.state.savedStorageUnavailable, stillDenied);
    assert.equal(f.node("savedCount").textContent, stillDenied ? "Unavailable" : "0");
    assert.equal(f.node("retrySavedServices").hidden, !stillDenied);
    assert.equal(f.writes(), 1); assert.match(f.messages.at(-1), /cleared/);
  });
}

test("failed explicit Clear leaves Saved data and presentation unchanged", () => {
  const f = finderFixture(); f.click("toggleSaved"); f.deny("write");
  f.click("clearBrowserData");
  assert.equal(f.values.get("rwn-saved-resources"), '["first","unavailable-record"]');
  assert.equal(f.state.savedOnly, true); assert.equal(f.node("savedCount").textContent, "1");
  assert.equal(f.writes(), 0); assert.match(f.messages.at(-1), /could not be cleared/);
});

function serviceFixture(initial) {
  const f = storageFixture(initial), status = { textContent: "" }, attributes = {};
  const button = { disabled: false, textContent: "", setAttribute(name, value) { attributes[name] = value; }, addEventListener(name, callback) { this[name] = callback; } };
  const context = vm.createContext({ window: f.window, URL, URLSearchParams, status,
    utility: { querySelector: () => button }, document: { querySelector: () => ({ dataset: { serviceId: "first" } }) } });
  vm.runInContext(`${privacy}\n${between(service, '  const saveButton = utility.querySelector', '\n  const publicDetails =')}\nglobalThis.announce = announce;`, context);
  return { ...f, status, button, attributes, announce: context.announce };
}

for (const denied of ["getter", "read"]) for (const initial of ['[]', '["first"]']) {
  test(`service recovery from ${denied} denial clears only its storage error for ${initial}`, () => {
    const f = serviceFixture(initial); f.deny(denied); f.events.pageshow();
    assert.equal(f.button.disabled, true); assert.match(f.status.textContent, /Saving is unavailable/);
    f.deny(""); f.events.pageshow();
    assert.equal(f.button.disabled, false); assert.equal(f.status.textContent, "");
    assert.equal(f.attributes["aria-pressed"], initial === '[]' ? "false" : "true");
    assert.equal(f.writes(), 0); assert.equal(f.values.get("rwn-saved-resources"), initial);
  });
}

test('service storage recovery clears its localized failure without relying on displayed wording', () => {
  const f = serviceFixture('[]');
  f.deny('read'); f.events.pageshow();
  assert.equal(f.button.disabled, true);
  f.status.textContent = 'No se puede guardar en este navegador.';
  f.deny(''); f.events.pageshow();
  assert.equal(f.button.disabled, false);
  assert.equal(f.status.textContent, '');
});

for (const message of ["Service details copied.", "Link copied. You can paste it into a message.", "Copy is unavailable in this browser.", "Opening the print dialog."]) {
  test(`service storage recovery preserves newer feedback: ${message}`, () => {
    const f = serviceFixture('["first"]'); f.deny("read"); f.events.pageshow();
    f.announce(message); f.deny(""); f.events.storage({ key: "rwn-saved-resources" });
    assert.equal(f.status.textContent, message); assert.equal(f.button.disabled, false); assert.equal(f.writes(), 0);
  });
}

for (const allowed of [false, true]) {
  test(`CI storage fixture ${allowed ? 'limits denial and write tracking to its Saved key' : 'does nothing outside its exact local origin'}`, () => {
    const values = new Map();
    class Storage {
      getItem(name) { return values.get(name) ?? null; }
      setItem(name, value) { values.set(name, value); }
      removeItem(name) { values.delete(name); }
    }
    const storage = new Storage(), window = { localStorage: storage };
    const context = vm.createContext({ window, Storage, DOMException, document: { addEventListener() {} }, location: { origin: allowed ? "http://127.0.0.1:4181" : "https://example.org" } });
    vm.runInContext(`(${installSavedStorageFixture.toString()})("http://127.0.0.1:4181", ["first"])`, context);
    if (!allowed) { assert.equal(values.size, 0); assert.equal(window.__rwnSavedStorageQA, undefined); return; }
    const probe = window.__rwnSavedStorageQA;
    assert.throws(() => storage.getItem("rwn-saved-resources"), { name: "SecurityError" });
    assert.equal(storage.getItem("qa-saved-unrelated"), "keep");
    assert.equal(probe.stored(), '["first"]'); assert.equal(probe.writes, 0);
    probe.replace([]); probe.denied = false;
    assert.equal(storage.getItem("rwn-saved-resources"), '[]'); assert.equal(probe.writes, 0);
    storage.setItem("rwn-saved-resources", '["second"]'); assert.equal(probe.writes, 1);
    storage.removeItem("rwn-saved-resources"); assert.equal(probe.writes, 2);
    storage.setItem("unrelated", "keep"); assert.equal(probe.writes, 2);
  });
}

test("Saved storage CI reuses native Enter delivery and reseeds a fresh document for every viewport", async () => {
  const source = await readFile(new URL("../scripts/qa-saved-storage.mjs", import.meta.url), "utf8");
  assert.match(source, /await pressConnectivityRecoveryKey\(client, "Enter", 13\)/);
  assert.doesNotMatch(source, /Input\.dispatchKeyEvent/);
  assert.match(source, /for \(const width of \[1440, 390\]\)[\s\S]*?await navigate\(client, "about:blank"\);[\s\S]*?await navigate\(client, `\$\{host\}/);
  assert.match(source, /clicks\.length === before \+ 1[\s\S]*?clicks\.at\(-1\)\.trusted/);
  assert.match(source, /current\.timeOrigin !== previousTimeOrigin/);
});
