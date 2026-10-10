import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const restore = app.slice(app.indexOf("function restoreFinderHistory("), app.indexOf("\nfunction renderStatic("));
const initial = { query: "New York", accessMode: "direct", activeTypes: ["food"], savedOnly: true, selectedId: "bowery-mission", inspectorOpen: true };

function fixture(fragment) {
  const state = { ...initial, activeTypes: new Set(initial.activeTypes) };
  const writes = [];
  const input = { value: initial.query };
  let renders = 0;
  const context = vm.createContext({
    state, resources: [{ id: "bowery-mission" }], FINDER_HISTORY_KEY: "rwnFinder",
    window: { location: { href: `https://www.realworldneeds.org/${fragment}` }, history: { replaceState: (...args) => writes.push(args) } },
    finderHistorySnapshot: () => ({ ...state, activeTypes: [...state.activeTypes] }),
    sanitizeFinderQuery: (value) => String(value || "").trim(),
    finderAccessFromHistory: (value) => ["direct", "discovery"].includes(value) ? value : "all",
    finderTypesFromHistory: (value) => new Set(value || ["food", "water"]),
    document: { getElementById: () => input },
    updateFilters: () => { renders += 1; }, writeFinderHistory: {}
  });
  vm.runInContext(restore, context);
  return { state, writes, input, restore: context.restoreFinderHistory, renders: () => renders };
}

for (const fragment of ["#results", "#finder", "#top", "#about"]) {
  test(`section navigation to ${fragment} preserves the query, filters and selection`, () => {
    const f = fixture(fragment);
    f.restore(null);
    assert.equal(f.state.query, "New York");
    assert.deepEqual([...f.state.activeTypes], ["food"]);
    assert.equal(f.state.accessMode, "direct");
    assert.equal(f.state.savedOnly, true);
    assert.equal(f.state.selectedId, "bowery-mission");
    assert.equal(f.state.inspectorOpen, true);
    assert.equal(f.input.value, "New York");
    assert.equal(f.renders(), 0);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0][2], `https://www.realworldneeds.org/${fragment}`);
    assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0][0].rwnFinder)), initial);
  });
}

test("untagged section entries retain unrelated history metadata without putting search in the URL", () => {
  const f = fixture("#results");
  f.restore({ navigation: "keep" });
  assert.equal(f.writes[0][0].navigation, "keep");
  assert.ok(!f.writes[0][2].includes("New"));
});

test("Back and Forward still restore explicit finder snapshots, including an intentionally cleared search", () => {
  const f = fixture("#results");
  f.restore({ rwnFinder: { query: "Bowery", activeTypes: ["food"], accessMode: "discovery", selectedId: "bowery-mission", inspectorOpen: true } });
  assert.equal(f.state.query, "Bowery");
  assert.equal(f.input.value, "Bowery");
  assert.equal(f.state.accessMode, "discovery");
  assert.equal(f.renders(), 1);
  f.restore({ rwnFinder: { query: "", activeTypes: [], accessMode: "all", savedOnly: false, selectedId: null, inspectorOpen: false } });
  assert.equal(f.state.query, "");
  assert.deepEqual([...f.state.activeTypes], []);
  assert.equal(f.state.selectedId, null);
  assert.equal(f.state.inspectorOpen, false);
  assert.equal(f.renders(), 2);
  assert.equal(f.writes.length, 0);
});
