import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { privateResourceUrl, clearResourceFromUrl } from "../src/utils/privacy.js";

const source = await readFile("src/app.js", "utf8");
const sanitizer = source.slice(
  source.indexOf("function sanitizeFinderQuery("),
  source.indexOf("function finderTypesFromHistory("),
);
const handlers = source.slice(
  source.indexOf(
    "  const searchInput =",
    source.indexOf("function bindEvents"),
  ),
  source.indexOf("  let catalogFilterFrame ="),
);
const popstate = source.slice(
  source.indexOf("  const sectionSnapshot =") >= 0 ? source.indexOf("  const sectionSnapshot =") : source.indexOf('  window.addEventListener("popstate", (event) => {'),
  source.indexOf("  const sections ="),
);
const historySource = source.slice(source.indexOf("function finderHistorySnapshot("), source.indexOf("function renderStatic("));
const historyNormalizers = source.slice(source.indexOf("function finderTypesFromHistory("), source.indexOf("if (requestedResource &&"));
const controlSync = source.slice(
  source.indexOf('  const search = document.getElementById("resourceSearch");', source.indexOf("function renderControls")),
  source.indexOf('  document.getElementById("locateMe").disabled', source.indexOf("function renderControls")),
);
const resultsRenderer = source.slice(
  source.indexOf("function emptyResultsCopy("),
  source.indexOf("function setSelected("),
);
function fixture() {
  let resolveReady;
  const events = {},
    timers = new Map(),
    history = [],
    privateHistory = [],
    windowEvents = {},
    filtered = [];
  let timerId = 0,
    back;
  let inputValue = "";
  const input = {
    get value() { return inputValue; },
    set value(value) { inputValue = value; this.selectionStart = this.selectionEnd = value.length; },
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    addEventListener: (event, handler) => {
      events[event] = handler;
    },
    focus() {},
  };
  const clear = {
    hidden: true,
    addEventListener: (_, handler) => {
      events.clear = handler;
    },
  };
  const state = { query: "", accessMode: "all", activeTypes: new Set(["food", "water"]), selectedId: null, inspectorOpen: false, viewMode: "aid", savedOnly: false, savedIds: new Set(), filtered: [{ id: "first" }, { id: "second" }], visibleResults: 60 };
  const count = { textContent: "Showing 2 of 2 listings" };
  const status = { textContent: "Current search: " };
  const badge = { textContent: "2 matches" };
  const nodes = {
    resourceSearch: input,
    clearSearch: clear,
    resultCount: count,
    searchStatus: status,
    matchingResultCount: badge,
    resourceGrid: { innerHTML: "" },
    showMoreResults: { hidden: true },
    resultTitle: { textContent: "" },
  };
  const context = vm.createContext({
    state, URL, privateResourceUrl, clearResourceFromUrl, resources: [{ id: "first" }, { id: "second" }],
    resourceTypes: ["food", "water"], createInitialTypeSet: () => new Set(["food", "water"]),
    FINDER_HISTORY_KEY: "rwnFinder",
    FINDER_QUERY_LIMIT: 180,
    cancelPendingSearch: () => {},
    hasPendingSearch: () => false,
    refreshSearchPreparation: () => {},
    resourceCard: (resource) => resource.id,
    searchPreparation: {
      prepared: false,
      ready: new Promise((resolve) => {
        resolveReady = resolve;
      }),
      prioritize() {},
    },
    document: {
      activeElement: input,
      getElementById: (id) => nodes[id] || (["service-map", "results", "finder", "top", "about", "standards"].includes(id) ? { id } : null),
    },
    window: {
      location: { href: "https://www.realworldneeds.org/" },
      history: {
        state: { unrelated: "keep" },
        pushState(next, _title, href) {
          history.push(next.rwnFinder.query);
          this.state = next; context.window.location.href = href;
          privateHistory.push({ mode: "push", state: structuredClone(next), href });
        },
        replaceState(next, _title, href) {
          this.state = next; context.window.location.href = href;
          privateHistory.push({ mode: "replace", state: structuredClone(next), href });
        },
      },
      setTimeout: (callback, delay) => {
        timers.set(++timerId, { callback, delay });
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      addEventListener: (type, handler) => {
        windowEvents[type] = handler;
        if (type === "popstate") back = handler;
      },
    },
    updateFilters: () => {
      filtered.push(state.query);
      state.filtered = state.query ? [{ id: state.query }] : [{ id: "first" }, { id: "second" }];
      context.syncSearchControls();
      status.textContent = `Current search: ${state.query}`;
      context.renderResults();
    },
  });
  vm.runInContext(`${historySource}\n${historyNormalizers}\n${sanitizer} function syncSearchControls() { const aidMode = true; ${controlSync} }\n${resultsRenderer}${handlers}${popstate}`, context);
  context.writeFinderHistory.lastSignature = JSON.stringify(context.finderHistorySnapshot());
  context.window.history.state.rwnFinder = context.finderHistorySnapshot();
  const type = (value) => {
    input.value = value;
    events.input({ target: input });
  };
  const flush = (delay = 48) => {
    const pending = [...timers.entries()].filter(([, timer]) => timer.delay === delay);
    for (const [id, { callback }] of pending) {
      timers.delete(id);
      callback();
    }
  };
  return {
    events,
    input,
    count,
    status,
    badge,
    clear,
    state,
    filtered,
    history, privateHistory,
    href: () => context.window.location.href,
    currentHistory: () => structuredClone(context.window.history.state),
    changeFilters(fields) {
      Object.assign(state, fields);
      context.updateFilters();
      context.writeFinderHistory("push");
    },
    activateSection(fragment, options = {}) {
      const link = { href: new URL(fragment, context.window.location.href).href, target: options.target || "",
        hasAttribute: name => name === "download" && Boolean(options.download) };
      const event = { button: 0, ...options, target: { closest: () => link } };
      windowEvents.click?.(event);
      if (options.navigate === false) return event;
      context.window.location.href = link.href;
      context.window.history.state = null;
      back({ state: null });
      windowEvents.hashchange?.({});
      return event;
    },
    traverse(entry) {
      context.window.location.href = entry.href;
      context.window.history.state = structuredClone(entry.state);
      back({ state: context.window.history.state });
    },
    ready: () => {
      context.searchPreparation.prepared = true;
      resolveReady();
    },
    type,
    insert(value, isComposing = false) {
      const start = input.selectionStart, end = input.selectionEnd;
      input.value = input.value.slice(0, start) + value + input.value.slice(end);
      input.setSelectionRange(start + value.length, start + value.length);
      events.input({ target: input, isComposing });
    },
    flush,
    blur: () => {
      context.document.activeElement = { id: "category-filter" };
      return events.blur();
    },
    render: () => context.updateFilters(),
    back: (query) => {
      context.window.history.state = query === null ? null : { rwnFinder: { query } };
      back({ state: context.window.history.state });
    },
    cancel: () => context.cancelPendingSearch(),
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("first typing and Enter wait for sliced preparation without synchronous catalog work", async () => {
  const f = fixture();
  f.type("London");
  assert.equal(f.clear.hidden, false, "Clear is visible before preparation completes");
  f.flush();
  f.events.keydown({ key: "Enter" });
  assert.deepEqual(f.filtered, []);
  f.ready();
  await settle();
  assert.equal(f.state.query, "London");
  assert.deepEqual(f.filtered, ["London"]);
  assert.ok(f.history.includes("London"));
});

test("newer typing supersedes a search waiting for preparation", async () => {
  const f = fixture();
  f.type("London");
  f.flush();
  f.type("WIC");
  f.flush();
  f.ready();
  await settle();
  assert.deepEqual(f.filtered, ["WIC"]);
  assert.equal(f.input.value, "WIC");
});

for (const action of ["Escape", "clear", "Back"]) {
  test(`${action} cancels waiting typing and Enter without resurrecting stale search`, async () => {
    const f = fixture();
    f.type("London");
    f.flush();
    f.events.keydown({ key: "Enter" });
    if (action === "Back") f.back("Bowery");
    else if (action === "clear") f.events.clear();
    else f.events.keydown({ key: "Escape" });
    f.ready();
    await settle();
    const expected = action === "Back" ? "Bowery" : "";
    assert.equal(f.state.query, expected);
    assert.equal(f.input.value, expected);
    assert.equal(f.clear.hidden, !expected);
    assert.equal(f.count.textContent, expected ? "Showing 1 of 1 listings" : "Showing 2 of 2 listings");
    assert.equal(f.status.textContent, `Current search: ${expected}`);
    assert.equal(f.badge.textContent, expected ? "1 match" : "2 matches");
    assert.ok(!f.filtered.includes("London"));
    assert.ok(!f.history.includes("London"));
    await f.events.blur();
    assert.equal(
      f.state.query,
      expected,
      "blur must not restore pre-Back pending text",
    );
  });
}

test("empty-state full reset cancels waiting work and later blur", async () => {
  const f = fixture();
  f.type("unmatched");
  f.flush();
  f.cancel();
  f.state.query = "";
  f.input.value = "";
  f.ready();
  await settle();
  await f.events.blur();
  assert.equal(f.state.query, "");
  assert.ok(!f.filtered.includes("unmatched"));
});

test("Back to a native section entry restores the visible committed text", async () => {
  const f = fixture();
  f.ready();
  f.type("London");
  f.flush();
  await settle();
  f.type("WIC");
  f.flush();
  f.back(null);
  await settle();
  assert.equal(f.state.query, "London");
  assert.equal(f.input.value, "London");
  assert.equal(f.clear.hidden, false);
  await f.events.blur();
  assert.equal(f.state.query, "London");
});

test("deleting pending input restores the current result summary", async () => {
  const f = fixture();
  f.type("London");
  f.flush();
  f.type("");
  assert.deepEqual(f.filtered, [""]);
  f.ready();
  await settle();
  assert.equal(f.state.query, "");
  assert.ok(!f.filtered.includes("London"));
});

test("native Back clears preparation feedback as well as pending input", async () => {
  const f = fixture();
  f.type("London");
  f.flush();
  assert.equal(f.count.textContent, "Preparing search…");
  assert.equal(f.status.textContent, "Preparing search…");
  assert.equal(f.badge.textContent, "Preparing…");
  f.back(null);
  f.ready();
  await settle();
  assert.equal(f.count.textContent, "Showing 2 of 2 listings");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.badge.textContent, "2 matches");
  assert.equal(f.input.value, "");
  assert.equal(f.clear.hidden, true);
});

test("native Back before debounce hides Clear without waiting for preparation feedback", async () => {
  const f = fixture();
  f.type("London");
  assert.equal(f.clear.hidden, false);
  f.back(null);
  assert.equal(f.input.value, "");
  assert.equal(f.clear.hidden, true);
  f.ready();
  await settle();
  await f.blur();
  assert.equal(f.state.query, "");
  assert.equal(f.clear.hidden, true);
  assert.ok(!f.history.includes("London"));
});

test("category rerender preserves blurred pending input and Clear until readiness", async () => {
  const f = fixture();
  f.type("London");
  f.flush();
  const blur = f.blur();
  f.render();
  assert.equal(f.state.query, "", "the pending query has not been applied yet");
  assert.equal(f.input.value, "London", "real control synchronization preserves pending text after blur");
  assert.equal(f.clear.hidden, false, "Clear remains usable after a category rerender");
  assert.equal(f.count.textContent, "Preparing search…");
  assert.equal(f.status.textContent, "Preparing search…");
  assert.equal(f.badge.textContent, "Preparing…", "the actual result-render hook restores nearby feedback");
  f.ready();
  await blur;
  await settle();
  assert.equal(f.state.query, "London");
  assert.equal(f.input.value, "London");
  assert.equal(f.clear.hidden, false);
  assert.equal(f.filtered.at(-1), "London");
  assert.equal(f.history.at(-1), "London");
  assert.equal(f.count.textContent, "Showing 1 of 1 listings");
  assert.equal(f.status.textContent, "Current search: London");
  assert.equal(f.badge.textContent, "1 match");
  f.events.clear();
  await f.blur();
  assert.equal(f.state.query, "");
  assert.equal(f.input.value, "");
  assert.equal(f.clear.hidden, true);
  assert.equal(f.history.at(-1), "");
  assert.equal(f.count.textContent, "Showing 2 of 2 listings");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.badge.textContent, "2 matches");
});

test("Clear cancels a blurred pending query after a category rerender", async () => {
  const f = fixture();
  f.type("London");
  f.flush();
  const blur = f.blur();
  f.render();
  f.events.clear();
  assert.equal(f.input.value, "");
  assert.equal(f.clear.hidden, true);
  assert.equal(f.count.textContent, "Showing 2 of 2 listings");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.badge.textContent, "2 matches");
  f.ready();
  await blur;
  await settle();
  await f.blur();
  assert.equal(f.state.query, "");
  assert.equal(f.input.value, "");
  assert.equal(f.clear.hidden, true);
  assert.ok(!f.filtered.includes("London"));
  assert.ok(!f.history.includes("London"));
});

test("delayed preparation feedback updates all three labels and clears on cancellation", async () => {
  const f = fixture();
  f.type("London");
  f.flush();
  f.render();
  f.flush(3000);
  const delayed = "Search is still preparing. You can keep typing or browse the directory.";
  assert.equal(f.count.textContent, delayed);
  assert.equal(f.status.textContent, delayed);
  assert.equal(f.badge.textContent, "Still preparing…");
  f.events.clear();
  assert.equal(f.count.textContent, "Showing 2 of 2 listings");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.badge.textContent, "2 matches");
  f.ready();
  await settle();
  f.flush(3000);
  assert.equal(f.count.textContent, "Showing 2 of 2 listings");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.badge.textContent, "2 matches");
  assert.ok(!f.history.includes("London"));
});


for (const query of ["New York", "London Road", "Crisis Skylight London", "E1 6LT", "Bogotá food"]) {
  test(`ordinary incremental typing preserves the words in ${query}`, async () => {
    const f = fixture();
    f.ready();
    for (const character of query) {
      f.insert(character);
      f.flush();
      await settle();
    }
    await f.events.keydown({ key: "Enter" });
    await settle();
    assert.equal(f.input.value, query);
    assert.equal(f.state.query, query);
    assert.equal(f.history.at(-1), query);
  });
}

test("editing spaces in the middle preserves the caret and selected replacement", async () => {
  const f = fixture(); f.ready();
  f.type("NewYork");
  f.input.setSelectionRange(3, 3);
  f.insert(" ");
  assert.equal(f.input.value, "New York");
  assert.equal(f.input.selectionStart, 4);
  f.input.setSelectionRange(4, 8);
  f.insert("Jersey");
  assert.equal(f.input.value, "New Jersey");
  assert.equal(f.input.selectionStart, 10);
  f.input.setSelectionRange(3, 4);
  f.insert("  ");
  assert.equal(f.input.value, "New  Jersey");
  assert.equal(f.input.selectionStart, 5, "normalization must not jump the caret to the end");
  f.flush(); await settle();
  assert.equal(f.state.query, "New Jersey", "matching still normalizes whitespace");
});

test("leading and trailing spaces remain editable while committed history is normalized", async () => {
  const f = fixture(); f.ready();
  for (const character of "  New   York  ") f.insert(character);
  await f.events.keydown({ key: "Enter" }); await settle();
  assert.equal(f.input.value, "  New   York  ");
  assert.equal(f.state.query, "New York");
  assert.equal(f.history.at(-1), "New York");
  f.type("   "); f.flush(); await settle();
  assert.equal(f.clear.hidden, false);
  f.events.keydown({ key: "Escape" });
  assert.equal(f.input.value, "");
  assert.equal(f.clear.hidden, true);
});

test("long pasted values stay bounded without losing an earlier selection", async () => {
  const f = fixture(); f.ready();
  f.input.value = "a".repeat(250);
  f.input.setSelectionRange(10, 15);
  f.events.input({ target: f.input });
  assert.equal(f.input.value.length, 180);
  assert.equal(f.input.selectionStart, 10);
  assert.equal(f.input.selectionEnd, 15);
  f.flush(); await settle();
  assert.equal(f.state.query.length, 180);
});

for (const key of ["Enter", "Escape"]) {
  test(`${key} during composition does not submit or clear the draft`, async () => {
    const f = fixture(); f.ready();
    f.type("New"); f.flush(); await settle();
    f.events.compositionstart?.();
    f.insert(" York", true);
    f.flush(); await settle();
    f.events.keydown({ key, isComposing: true, keyCode: 229 });
    await settle();
    assert.equal(f.input.value, "New York");
    assert.equal(f.state.query, "New", "composition must not change settled results");
    assert.deepEqual(f.history, [], "composition keys must not create search history");
    f.events.compositionend?.();
    f.flush(); await settle();
    assert.equal(f.state.query, "New York");
  });
}

test("composition start cancels a pending pre-composition query", async () => {
  const f = fixture();
  f.type("Lond"); f.flush();
  f.events.compositionstart?.();
  f.insert("on", true);
  f.ready(); await settle(); f.flush(); await settle();
  assert.equal(f.state.query, "");
  assert.deepEqual(f.filtered, [""], "cancelled preparation feedback returns to settled results");
  f.events.compositionend?.(); f.flush(); await settle();
  assert.equal(f.state.query, "London");
});


test("the accessibility Escape listener also leaves IME composition alone", async () => {
  const accessibility = await readFile("src/accessibility.js", "utf8");
  const start = accessibility.includes("  let composingSearch = false;") ? accessibility.indexOf("  let composingSearch = false;") : accessibility.indexOf('  input.addEventListener("keydown"');
  const listener = accessibility.slice(start, accessibility.indexOf('  document.addEventListener("keydown"'));
  const events = {};
  let cleared = 0;
  const input = { value: "New York", addEventListener: (type, handler) => { events[type] = handler; }, dispatchEvent: () => { cleared++; } };
  const context = vm.createContext({ input, announce() {}, Event });
  vm.runInContext(listener, context);
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    events.keydown({ key: "Escape", ...flags, preventDefault: () => assert.fail("IME Escape was cancelled") });
    assert.equal(input.value, "New York");
    assert.equal(cleared, 0);
  }
  events.compositionstart?.();
  events.keydown({ key: "Escape", isComposing: false, keyCode: 27, preventDefault: () => assert.fail("Lifecycle-active IME Escape was cancelled") });
  assert.equal(input.value, "New York");
  events.compositionend?.();
  events.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(input.value, "");
  assert.equal(cleared, 1);
});

for (const action of ["Clear", "Back"]) {
  test(`${action} interrupts composition without reviving a stale draft`, async () => {
    const f = fixture(); f.ready();
    f.type("London"); f.flush(); await settle();
    f.events.compositionstart?.(); f.insert(" Road", true);
    assert.equal(f.clear.hidden, false);
    if (action === "Clear") f.events.clear(); else f.back("New York");
    f.events.compositionend?.(); f.flush(); await settle();
    await f.blur();
    const expected = action === "Clear" ? "" : "New York";
    assert.equal(f.input.value, expected);
    assert.equal(f.state.query, expected);
    assert.ok(!f.history.includes("London Road"));
  });
}

test("query normalization still removes control characters without rewriting the draft", async () => {
  const f = fixture(); f.ready();
  f.type("New\u0001York\tfood\u007f");
  await f.events.keydown({ key: "Enter" }); await settle();
  assert.equal(f.state.query, "New York food");
  assert.equal(f.history.at(-1), "New York food");
});


test("cancelling a preparing search through IME clears its preparation feedback", async () => {
  const f = fixture();
  f.type("Lond"); f.flush();
  assert.equal(f.count.textContent, "Preparing search…");
  f.events.compositionstart?.();
  f.input.value = "";
  f.events.compositionend?.();
  f.ready(); f.flush(); await settle();
  assert.equal(f.state.query, "");
  assert.equal(f.count.textContent, "Showing 2 of 2 listings");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.badge.textContent, "2 matches");
});

for (const fragment of ["#service-map", "#results", "#finder", "#top", "#about", "#standards"]) {
  test(`native ${fragment} navigation preserves a preparing query and one-step Back/Forward history privately`, async () => {
    const f = fixture();
    f.type("Boston"); f.flush();
    const blur = f.blur();
    assert.equal(f.count.textContent, "Preparing search…");
    f.activateSection(fragment);
    assert.equal(f.input.value, "Boston");
    assert.equal(f.state.query, "", "matching must still wait for sliced preparation");
    assert.equal(f.count.textContent, "Preparing search…");
    assert.equal(f.clear.hidden, false);
    assert.equal(f.privateHistory.length, 2);
    const [origin, destination] = f.privateHistory;
    assert.equal(origin.mode, "push"); assert.equal(origin.href, "https://www.realworldneeds.org/");
    assert.equal(origin.state.unrelated, "keep");
    assert.equal(destination.mode, "replace"); assert.equal(destination.href, "https://www.realworldneeds.org/" + fragment);
    assert.equal(origin.state.rwnFinder.query, "Boston"); assert.equal(destination.state.rwnFinder.query, "Boston");
    f.ready(); await blur; await settle();
    assert.equal(f.state.query, "Boston"); assert.equal(f.input.value, "Boston");
    assert.equal(f.count.textContent, "Showing 1 of 1 listings");
    assert.equal(f.privateHistory.length, 2, "readiness must not add a duplicate fragment entry");
    assert.ok(f.privateHistory.every(entry => !/Boston|query=|search=/.test(entry.href)));
    f.traverse(origin); assert.equal(f.state.query, "Boston"); assert.equal(f.href(), origin.href);
    f.traverse(destination); assert.equal(f.state.query, "Boston"); assert.equal(f.href(), destination.href);
  });
}

test("a native anchor before debounce retains the draft until preparation finishes", async () => {
  const f = fixture(); f.type("Boston"); f.activateSection("#service-map");
  assert.equal(f.input.value, "Boston"); assert.equal(f.state.query, "");
  f.flush(); f.ready(); await settle(); f.flush(640);
  assert.equal(f.state.query, "Boston");
  assert.equal(f.privateHistory.length, 2);
});

test("Back and Forward between draft section entries wait for preparation without synchronous matching", async () => {
  const f = fixture(); f.type("Boston"); f.flush(); f.activateSection("#service-map");
  const [origin, destination] = f.privateHistory;
  f.traverse(origin);
  assert.equal(f.input.value, "Boston");
  assert.ok(!f.filtered.includes("Boston"));
  f.traverse(destination);
  assert.equal(f.input.value, "Boston");
  assert.ok(!f.filtered.includes("Boston"));
  f.ready(); await settle();
  assert.equal(f.state.query, "Boston");
  assert.equal(f.href(), destination.href);
  assert.deepEqual(f.privateHistory.map(entry => entry.mode), ["push", "replace", "replace"], "readiness refreshes the current entry without adding another Back step");
  assert.equal(f.currentHistory().rwnFinder.query, "Boston");
});

for (const action of ["newer typing", "Clear", "explicit Back", "null-state Back"]) test(`${action} cancels a deferred draft-history restore without stale results`, async () => {
  const f = fixture(); f.type("Boston"); f.flush(); f.activateSection("#service-map"); f.traverse(f.privateHistory[0]);
  if (action === "newer typing") { f.type("WIC"); f.flush(); }
  else if (action === "Clear") f.events.clear();
  else f.back(action === "explicit Back" ? "London" : null);
  f.ready(); await settle();
  const expected = action === "newer typing" ? "WIC" : action === "explicit Back" ? "London" : "";
  assert.equal(f.input.value, expected); assert.equal(f.state.query, expected);
  assert.ok(!f.filtered.includes("Boston"));
});

for (const options of [{ defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
  { button: 1 }, { target: "_blank" }, { download: true }]) test(`nonordinary anchor activation does not write private history: ${JSON.stringify(options)}`, () => {
  const f = fixture(); f.type("Boston");
  f.activateSection("#service-map", { ...options, navigate: false });
  assert.equal(f.privateHistory.length, 0); assert.equal(f.input.value, "Boston");
});

for (const href of ["#", "/", "/directory#results", "https://example.org/#results", "?query=other#results", "#missing"]) test(`nonsection destination ${href} does not write private history`, () => {
  const f = fixture(); f.type("Boston"); f.activateSection(href, { navigate: false });
  assert.equal(f.privateHistory.length, 0);
});

test("same-fragment activation does not leave a new navigation intent or duplicate history", async () => {
  const f = fixture(); f.type("Boston"); f.flush(); f.activateSection("#service-map");
  f.activateSection("#service-map", { navigate: false });
  assert.equal(f.privateHistory.length, 2);
  f.back(null); f.ready(); await settle();
  assert.equal(f.input.value, ""); assert.equal(f.state.query, "");
});

test("an explicit self-target still follows ordinary native section history", () => {
  const f = fixture(); f.type("Boston"); f.activateSection("#service-map", { target: "_self" });
  assert.equal(f.input.value, "Boston"); assert.equal(f.privateHistory.length, 2);
});

test("newer filter and selection changes survive a deferred history query without an extra query entry", async () => {
  const f = fixture(); f.type("Boston"); f.flush(); f.activateSection("#service-map");
  f.traverse(f.privateHistory[0]);
  f.changeFilters({ accessMode: "direct", activeTypes: new Set(["water"]), savedOnly: true, selectedId: "first", inspectorOpen: true });
  const beforeReady = f.privateHistory.length;
  f.ready(); await settle();
  assert.equal(f.state.query, "Boston");
  assert.equal(f.state.accessMode, "direct");
  assert.deepEqual([...f.state.activeTypes], ["water"]);
  assert.equal(f.state.savedOnly, true);
  assert.equal(f.state.selectedId, "first"); assert.equal(f.state.inspectorOpen, true);
  assert.equal(f.privateHistory.length, beforeReady + 1);
  assert.equal(f.privateHistory.at(-1).mode, "replace", "readiness must update the current entry rather than add a new Back step");
  assert.equal(f.currentHistory().rwnFinder.query, "Boston");
  assert.deepEqual(f.currentHistory().rwnFinder.activeTypes, ["water"]);
});

test("Back to a draft then another section before readiness does not duplicate the existing source entry", async () => {
  const f = fixture(); f.type("Boston"); f.flush(); f.activateSection("#service-map");
  f.traverse(f.privateHistory[0]);
  f.activateSection("#results");
  assert.equal(f.privateHistory.length, 3, "the existing Boston source entry needs no duplicate push");
  assert.deepEqual(f.privateHistory.map(entry => entry.mode), ["push", "replace", "replace"]);
  f.ready(); await settle();
  assert.equal(f.state.query, "Boston");
  assert.equal(f.href(), "https://www.realworldneeds.org/#results");
});
