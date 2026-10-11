import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { readDirectoryState, writeDirectoryState, restoreDirectoryView } from "../public/directory-state.js";
import { createResultRow } from "../public/directory-results.js";

const awaitStateSource = await readFile("public/directory-state.js", "utf8");
const source = await readFile("public/directory.js", "utf8");
const applySource = source.slice(source.indexOf("const apply="), source.indexOf("const reset="));
const restoreViewSource = source.slice(source.indexOf("const restoreView="), source.indexOf("const apply="));

test("directory state remains scoped to one path and never changes the URL", () => {
  const value = { query: "  New   York  ", country: "United States", category: "food", shown: 120, scroll: 2200, focus: "/service/bowery-mission" };
  const history = { state: { unrelated: { retained: true } }, replaceState(...args) { assert.equal(args.length, 2, "no URL argument"); this.state = args[0]; } };
  writeDirectoryState(history, "/directory", value);
  assert.deepEqual(history.state.unrelated, { retained: true });
  assert.deepEqual(readDirectoryState(history.state, "/directory"), value);
  assert.equal(readDirectoryState(history.state, "/directory/help/food"), null);
  assert.equal(readDirectoryState(history.state, "/directory/page/2"), null);
  assert.doesNotMatch(source + awaitStateSource, /localStorage|sessionStorage|URLSearchParams|searchParams\.set/);
});

test("malformed history is bounded and a restricted history API does not break browsing", () => {
  assert.equal(readDirectoryState(null, "/directory"), null);
  const malformed = readDirectoryState({ rwnDirectory: { path: "/directory", query: {}, category: null, country: [], shown: Infinity, scroll: -80, focus: "https://example.org/" } }, "/directory");
  assert.deepEqual(malformed, { query: "", category: "", country: "", shown: 60, scroll: 0, focus: "" });
  assert.equal(readDirectoryState({ rwnDirectory: { path: "/directory", query: "a".repeat(2000), shown: 100000, scroll: NaN, focus: "/service/ok?private=value" } }, "/directory").query.length, 1024);
  assert.doesNotThrow(() => writeDirectoryState({ replaceState() { throw new Error("denied"); } }, "/directory", {}));
});

test("the real restore handler reads history.state and restores the filter controls", () => {
  let calls = 0;
  const history = { state: null, replaceState(value) { this.state = value; } };
  writeDirectoryState(history, "/directory", { query: "WIC", category: "food", country: "United States", shown: 120, scroll: 900 });
  const f = vm.createContext({ history, location: { pathname: "/directory", hash: "" }, readDirectoryState,
    restored: null, restorePending: false, clearTimeout() {}, inputTimer: null,
    input: {}, activeCategory: "", country: {}, renderChips() {}, apply: () => calls++ });
  const restoreSource = source.slice(source.indexOf("const restore="), source.indexOf('window.addEventListener("popstate"'));
  vm.runInContext(`${restoreSource}\nrestore();`, f);
  assert.equal(f.input.value, "WIC"); assert.equal(f.activeCategory, "food");
  assert.equal(f.country.value, "United States"); assert.equal(f.restored.shown, 120);
  assert.equal(f.restorePending, true); assert.equal(calls, 1);
  f.stopRestore = () => { f.restorePending = false; };
  f.location.hash = "#saved";
  vm.runInContext("restore();", f);
  assert.equal(f.restorePending, false, "Saved owns focus and scrolling on fragment navigation");
  assert.equal(calls, 1, "hash navigation must not rerender hidden directory results");
  f.location.hash = "#directory-results";
  vm.runInContext("restore();", f);
  assert.equal(calls, 2, "ordinary listing anchors still restore filters and loaded batches");
  assert.equal(f.restorePending, true);
});

test("reconnection retries a country-only search after its results were hidden by a failed request", () => {
  let searches = 0;
  const f = vm.createContext({ showConnectivityState() {}, results: { hidden: true },
    input: { value: "" }, activeCategory: "", country: { value: "France" }, apply: () => searches++ });
  const changeSource = source.slice(source.indexOf("const connectivityChanged="), source.indexOf('window.addEventListener("online",connectivityChanged)'));
  vm.runInContext(`${changeSource}\nconnectivityChanged();`, f);
  assert.equal(searches, 1);
});

test("a second refresh while restoration loads preserves the saved position and target", () => {
  const history = { state: null, replaceState(value) { this.state = value; } };
  const f = vm.createContext({ history, writeDirectoryState, location: { pathname: "/directory" },
    input: { value: "WIC" }, activeCategory: "food", country: { value: "United States" }, visibleCount: 0,
    restorePending: true, restored: { shown: 120, scroll: 900, focus: "/service/example" },
    window: { scrollY: 0 }, document: { activeElement: {} } });
  const rememberSource = source.slice(source.indexOf("const remember="), source.indexOf("const stopRestore="));
  vm.runInContext(`${rememberSource}\nremember();`, f);
  assert.equal(history.state.rwnDirectory.shown, 120);
  assert.equal(history.state.rwnDirectory.scroll, 900);
  assert.equal(history.state.rwnDirectory.focus, "/service/example");
});

function searchFixture({ country = "", category = "", query = "", restored = null } = {}) {
  const records = [
    { id: "physical-fr", country: "France", kind: "direct", categoryLabels: ["Food"], name: "Meals" },
    { id: "finder-fr", country: "France", kind: "locator", categoryLabels: ["Food"], name: "Food finder" },
    { id: "health-fr", country: "France", kind: "locator", categoryLabels: ["Health care"], name: "Health finder" },
    { id: "physical-uk", country: "United Kingdom", kind: "direct", categoryLabels: ["Food"], name: "Meals" },
    { id: "global", country: "Global", kind: "network", categoryLabels: ["Food"], name: "Global referral" }
  ];
  const frames = [], effects = { remembers: 0, focus: 0, scroll: null, cleared: 0 };
  const f = vm.createContext({
    input: { value: query }, country: { value: country }, activeCategory: category, generation: 0,
    queryTokens: value => value.trim().split(/\s+/).filter(Boolean), normalize: value => value.toLowerCase(),
    clear: {}, root: { classList: { toggle() {} } }, count: {}, loadCatalog: async () => ({ records }),
    syncCategoryLabels() {}, scopedRecords: payload => payload.records, scoreRecord: () => 1,
    collator: new Intl.Collator(), activeMatches: [], visibleCount: 0, scopedCount: 0,
    resultList: { replaceChildren() {}, querySelectorAll: () => [{ getAttribute: () => "/service/finder-fr", focus: () => effects.focus++ }] },
    renderNext: () => { f.visibleCount = Math.min(f.visibleCount + 1, f.activeMatches.length); },
    restorePending: Boolean(restored), restored, requestAnimationFrame: callback => frames.push(callback),
    restoreDirectoryView: (_, value) => { effects.focus++; effects.scroll = value.scroll; }, results: {}, shell: { classList: { add() {}, contains: () => false } },
    navigator: { onLine: true }, remember: () => effects.remembers++, clearGlobalResults: () => effects.cleared++
  });
  vm.runInContext(`${restoreViewSource}\n${applySource}\nglobalThis.apply = apply`, f);
  return { f, effects, frames };
}

test("country and need filters intersect while including countrywide finders honestly", async () => {
  const { f } = searchFixture({ country: "France", category: "food" });
  await f.apply();
  assert.deepEqual(Array.from(f.activeMatches, record => record.id).sort(), ["finder-fr", "physical-fr"]);
  assert.equal(f.scopedCount, 3);
  assert.equal(f.count.textContent, "2 matching listings");
  assert.equal(f.clear.hidden, false, "country-only searches must remain clearable");
});

test("returning to results restores loaded rows, focus and scroll after rendering", async () => {
  const { f, effects, frames } = searchFixture({ query: "food", restored: { shown: 120, focus: "/service/finder-fr", scroll: 800 } });
  await f.apply();
  assert.equal(f.visibleCount, 5, "restore no more than the current matching catalog");
  assert.equal(effects.focus, 0);
  frames[0]();
  assert.equal(effects.focus, 1);
  assert.equal(effects.scroll, 800);
  assert.equal(f.restorePending, false);
});

test("a visitor interaction or newer query cancels pending restoration", async () => {
  for (const change of [f => { f.restorePending = false; }, f => { f.generation++; }]) {
    const { f, effects, frames } = searchFixture({ query: "food", restored: { shown: 60, focus: "/service/finder-fr", scroll: 800 } });
    await f.apply(); change(f); frames[0]();
    assert.equal(effects.focus, 0); assert.equal(effects.scroll, null);
  }
});

test("directory view restoration focuses a visible result instead of an offscreen search field", () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  let focused = "", scroll;
  const link = (href, top, height = 30) => ({ getAttribute: () => href,
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
    focus: options => { assert.equal(options.preventScroll, true); focused = href; } });
  const before = link("/service/before", -400), clipped = link("/service/clipped", 40, 80), visible = link("/service/current", 130), after = link("/service/after", 1200);
  const nav = link("/directory", 20);
  globalThis.window = { innerHeight: 800, scrollTo: value => { scroll = value.top; } };
  globalThis.document = { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 74 }), querySelectorAll: () => [nav] }) };
  try {
    const list = { querySelectorAll: selector => { assert.equal(selector, "h2 a,.directory-global-result", "prefer a readable listing identity over a nearby action"); return [before, clipped, visible, after]; } };
    restoreDirectoryView(list, { focus: "/service/before", scroll: 900 });
    assert.equal(focused, "/service/current"); assert.equal(scroll, 900);
    restoreDirectoryView(list, { focus: "/service/clipped", scroll: 900 });
    assert.equal(focused, "/service/current", "a clipped name is not a useful visible return target");
    restoreDirectoryView({ querySelectorAll: () => [] }, { focus: "", scroll: 900 });
    assert.equal(focused, "/directory", "sticky navigation is the fallback when no result is in view");
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test("search recovery does not link the global directory back into its own restored empty state", async () => {
  const global = await readFile("dist/directory/index.html", "utf8");
  const scoped = await readFile("dist/directory/france/index.html", "utf8");
  const globalScope = await readFile("dist/directory/global/index.html", "utf8");
  const template = html => html.match(/<template data-directory-empty>([\s\S]*?)<\/template>/)?.[1];
  assert.ok(template(global));
  assert.doesNotMatch(template(global), /href="\/directory"/);
  assert.match(template(scoped), /href="\/directory"/);
  assert.doesNotMatch(template(globalScope), /href="\/directory\/global"/);
  assert.match(template(globalScope), /href="\/directory"/);
  assert.match(template(global), /data-clear-all/);
  assert.doesNotMatch(await readFile("dist/directory.csv", "utf8"), /Help finder or referral/, "UI copy changes must not change export type labels");
});

test("Saved handoff hides its panel before requesting directory return-focus ownership", async () => {
  const saved = await readFile("public/saved-services.js", "utf8");
  assert.match(saved, /history\.state\?\.rwnDirectory[\s\S]*?dispatchEvent\(new Event\("rwn-directory-restore"\)\)/);
  assert.match(source, /addEventListener\("rwn-directory-restore",restore\)/);
});

test("Saved navigation closes the narrow menu before moving focus into either view", async () => {
  const saved = await readFile("public/saved-services.js", "utf8");
  const syncSource = saved.slice(saved.indexOf("  const syncView ="), saved.indexOf('  window.addEventListener("hashchange"'));
  for (const visible of [true, false]) {
    const effects = [];
    const f = vm.createContext({ active: () => visible, generation: 0,
      document: { querySelector(selector) { assert.equal(selector, ".rwn-page-menu"); return { removeAttribute(name) { assert.equal(name, "open"); effects.push("closed"); } }; } },
      panel: { closest: () => ({ classList: { toggle() {} } }), scrollIntoView() {} },
      cancelClear() {}, render() {}, heading: { focus() { effects.push("focus"); } },
      history: { state: { rwnDirectory: {} } }, Event: class {},
      window: { dispatchEvent() { effects.push("handoff"); } }
    });
    vm.runInContext(`${syncSource}\nsyncView(true);`, f);
    assert.deepEqual(effects, ["closed", visible ? "focus" : "handoff"]);
  }
});

test("no filter restores the ordinary crawlable directory", async () => {
  const { f, effects } = searchFixture();
  await f.apply();
  assert.equal(effects.cleared, 1); assert.equal(effects.remembers, 1);
});

test("country options are drawn from the full page scope, never only its first 60 rows", async () => {
  const index = JSON.parse(await readFile("dist/data/search-index.json", "utf8"));
  for (const scope of ["/directory", "/directory/help/health", "/directory/region/europe", "/directory/united-states"]) {
    const html = await readFile(`dist${scope}/index.html`, "utf8");
    const records = scope === "/directory" ? index.records : index.scopes[scope].map(i => index.records[i]);
    const countries = [...new Set(records.map(record => record.country))].sort();
    const control = html.match(/<select data-directory-country[\s\S]*?<\/select>/)?.[0];
    if (countries.length < 2) { assert.equal(control, undefined, scope); continue; }
    const options = [...control.matchAll(/<option value="([^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&")).sort();
    assert.deepEqual(options, countries, scope);
    assert.match(control, /aria-describedby="directory-coverage-note"/);
    assert.match(html, /RWN does not list every service or place/);
  }
});

test("result metadata separates reviewed source dates from availability and reach", () => {
  const oldDocument = globalThis.document, oldNavigator = globalThis.navigator;
  const element = () => ({ children: [], classList: { add() {} }, append(...items) { this.children.push(...items); }, setAttribute() {}, addEventListener() {} });
  globalThis.document = { createElement: element };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  try {
    for (const [kind, expected] of [["direct", "Service location"], ["locator", "Help finder or referral · check coverage"], ["network", "Service network · check coverage"]]) {
      const row = createResultRow({ id: "example", name: "Example", place: "France", categoryLabels: ["Food"], kind, checked: "2026-10-01" }, {});
      const meta = row.children[0].children[1].textContent;
      assert.ok(meta.startsWith(expected)); assert.match(meta, /Source checked 2026-10-01/);
      assert.doesNotMatch(meta, /verified|open now|available now/i);
    }
  } finally {
    globalThis.document = oldDocument;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: oldNavigator });
  }
});


test("cleared searches and failed restored searches still have a visible return-focus owner", async () => {
  for (const query of ["", "food"]) {
    const { f, effects } = searchFixture({ query, restored: { shown: 60, focus: "", scroll: 900 } });
    f.loadCatalog = async () => { throw new Error("Offline"); };
    await f.apply();
    assert.equal(effects.cleared, 1); assert.equal(effects.focus, 1);
    assert.equal(effects.scroll, 900); assert.equal(f.restorePending, false);
  }
});

test("Saved navigation snapshots current scroll before creating its fragment history entry", () => {
  let capture, handler, snapshots = 0;
  const f = vm.createContext({ document: { addEventListener(type, fn, flag) { assert.equal(type, "click"); handler = fn; capture = flag; } }, remember: () => snapshots++ });
  const clickSource = source.split("\n").find(line => line.startsWith('document.addEventListener("click"'));
  vm.runInContext(clickSource, f);
  assert.equal(capture, true);
  handler({ target: { closest: selector => selector === 'a[href$="#saved"]' } });
  assert.equal(snapshots, 1);
  handler({ target: { closest: () => null } });
  assert.equal(snapshots, 1);
});
