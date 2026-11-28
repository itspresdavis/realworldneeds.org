import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("src/app.js", "utf8");
// These behavioral fixtures execute authored handlers. Fail at a missing source
// boundary rather than silently slicing through unrelated globe initialization.
function between(start, end, scope = "") {
  const scopeIndex = source.indexOf(scope);
  assert.ok(scopeIndex >= 0, `Missing fixture scope: ${scope}`);
  const first = source.indexOf(start, scopeIndex);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing fixture boundary: ${start} … ${end}`);
  return source.slice(first, last);
}
const sanitizer = between("function sanitizeFinderQuery(", "function finderTypesFromHistory(");
const handlers = between("  const searchInput =", "  let catalogFilterFrame =", "function bindEvents");
const popstate = between('  window.addEventListener("popstate", (event) => {', '  if ("IntersectionObserver" in window) {');
const controlSync = between('  const search = document.getElementById("resourceSearch");', '  document.getElementById("locateMe").disabled', "function renderControls");
const resultsRenderer = between("function emptyResultsCopy(", "function setSelected(");
function fixture() {
  let resolveReady;
  const events = {},
    timers = new Map(),
    history = [],
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
  const state = { query: "", viewMode: "aid", savedOnly: false, savedIds: new Set(), filtered: [{ id: "first" }, { id: "second" }], visibleResults: 60 };
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
    state,
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
      getElementById: (id) => nodes[id],
    },
    window: {
      setTimeout: (callback, delay) => {
        timers.set(++timerId, { callback, delay });
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      addEventListener: (_, handler) => {
        back = handler;
      },
    },
    updateFilters: () => {
      filtered.push(state.query);
      state.filtered = state.query ? [{ id: state.query }] : [{ id: "first" }, { id: "second" }];
      context.syncSearchControls();
      status.textContent = `Current search: ${state.query}`;
      context.renderResults();
    },
    writeFinderHistory: () => history.push(state.query),
    restoreFinderHistory: (event) => {
      const snapshot = event?.rwnFinder;
      if (snapshot) {
        state.query = snapshot.query;
        input.value = snapshot.query;
        context.updateFilters();
      }
    },
  });
  vm.runInContext(`${sanitizer} function syncSearchControls() { const aidMode = true; ${controlSync} }\n${resultsRenderer}${handlers}${popstate}`, context);
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
    history,
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
    back: (query) => back({ state: query === null ? null : { rwnFinder: { query } } }),
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
