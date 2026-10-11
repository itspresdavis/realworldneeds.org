import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("src/app.js", "utf8");
const handlers = source.slice(
  source.indexOf(
    "  const searchInput =",
    source.indexOf("function bindEvents"),
  ),
  source.indexOf("  let catalogFilterFrame ="),
);
const popstate = source.slice(
  source.indexOf('  window.addEventListener("popstate", (event) => {'),
  source.indexOf("  const sectionLinks ="),
);
const controlSync = source.slice(
  source.indexOf('  const search = document.getElementById("resourceSearch");', source.indexOf("function renderControls")),
  source.indexOf('  document.getElementById("locateMe").disabled', source.indexOf("function renderControls")),
);
const resultsRenderer = source.slice(
  source.indexOf("function renderResults() {"),
  source.indexOf("function setSelected("),
);
function fixture() {
  let resolveReady;
  const events = {},
    timers = new Map(),
    history = [],
    filtered = [];
  let timerId = 0,
    back;
  const input = {
    value: "",
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
  const state = { query: "", viewMode: "aid", filtered: [{ id: "first" }, { id: "second" }], visibleResults: 60 };
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
    sanitizeFinderQuery: (value) => value,
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
  vm.runInContext(`function syncSearchControls() { const aidMode = true; ${controlSync} }\n${resultsRenderer}${handlers}${popstate}`, context);
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
