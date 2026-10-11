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
function fixture() {
  let ready;
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
    addEventListener: (_, handler) => {
      events.clear = handler;
    },
  };
  const state = { query: "" };
  const count = { textContent: "Current results: " };
  const status = { textContent: "Current search: " };
  const context = vm.createContext({
    state,
    FINDER_HISTORY_KEY: "rwnFinder",
    cancelPendingSearch: () => {},
    searchPreparation: {
      ready: new Promise((resolve) => {
        ready = resolve;
      }),
      prioritize() {},
    },
    document: {
      getElementById: (id) =>
        id === "resourceSearch"
          ? input
          : id === "resultCount"
            ? count
            : id === "searchStatus"
              ? status
              : clear,
    },
    window: {
      setTimeout: (callback) => {
        timers.set(++timerId, callback);
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
      count.textContent = `Current results: ${state.query}`;
      status.textContent = `Current search: ${state.query}`;
    },
    writeFinderHistory: () => history.push(state.query),
    restoreFinderHistory: (event) => {
      if (event) {
        state.query = event.query;
        input.value = event.query;
      }
    },
  });
  vm.runInContext(handlers + popstate, context);
  const type = (value) => {
    input.value = value;
    events.input({ target: input });
  };
  const flush = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const callback of pending) callback();
  };
  return {
    events,
    input,
    count,
    status,
    state,
    filtered,
    history,
    ready,
    type,
    flush,
    back: (query) => back({ state: query === null ? null : { query } }),
    cancel: () => context.cancelPendingSearch(),
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("first typing and Enter wait for sliced preparation without synchronous catalog work", async () => {
  const f = fixture();
  f.type("London");
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
  f.back(null);
  f.ready();
  await settle();
  assert.equal(f.count.textContent, "Current results: ");
  assert.equal(f.status.textContent, "Current search: ");
  assert.equal(f.input.value, "");
});
