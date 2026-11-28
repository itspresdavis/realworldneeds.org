import assert from "node:assert/strict";
import test from "node:test";
import { restoreDirectoryView, writeDirectoryState } from "../public/directory-state.js";

function fixture() {
  const effects = [], links = [], controls = [];
  const node = (name, top, height = 44, href = "") => ({
    name,
    getAttribute: () => href,
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
    focus(options) { effects.push(["focus", name, options]); },
    scrollIntoView(options) { effects.push(["into-view", name, options]); }
  });
  const input = node("query", 140);
  const brand = node("brand", 10, 44, "/");
  const prior = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { innerHeight: 844, scrollTo(options) { effects.push(["scroll", options]); } };
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, ".rwn-site-header");
      return { getBoundingClientRect: () => ({ bottom: 74 }), querySelectorAll: () => [brand] };
    },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-directory-clear],.directory-global-empty button",
        "Browse must not select horizontally clipped category chips");
      return controls;
    }
  };
  return {
    effects, links, controls, input, node,
    list: { querySelectorAll: () => links },
    restore() { globalThis.window = prior.window; globalThis.document = prior.document; }
  };
}

test("Browse keeps a visible result and captured scroll ahead of its new control fallback", () => {
  const f = fixture();
  try {
    f.links.push(f.node("other", 120, 44, "/service/other"), f.node("saved-title", 250, 44, "/service/saved"));
    restoreDirectoryView(f.list, { scroll: 955, focus: "/service/saved" }, f.input);
    assert.deepEqual(f.effects, [["scroll", { top: 955, behavior: "instant" }], ["focus", "saved-title", { preventScroll: true }]]);
  } finally { f.restore(); }
});

test("Browse preserves scroll when the query is already a visible useful return target", () => {
  const f = fixture();
  try {
    restoreDirectoryView(f.list, { scroll: 355, focus: "" }, f.input);
    assert.deepEqual(f.effects, [["scroll", { top: 355, behavior: "instant" }], ["focus", "query", { preventScroll: true }]]);
  } finally { f.restore(); }
});

for (const name of ["clear", "empty-recovery"]) {
  test(`Browse prefers visible ${name} over an offscreen query without moving the restored scroll`, () => {
    const f = fixture();
    try {
      const input = f.node("query", -200);
      f.controls.push(f.node("hidden-clear", 150, 0), f.node(name, 300));
      restoreDirectoryView(f.list, { scroll: 1200, focus: "" }, input);
      assert.deepEqual(f.effects, [["scroll", { top: 1200, behavior: "instant" }], ["focus", name, { preventScroll: true }]]);
    } finally { f.restore(); }
  });
}

test("Browse scrolls the query into view only when no useful result or control is visible", () => {
  const f = fixture();
  try {
    const input = f.node("query", -200);
    f.links.push(f.node("clipped-title", 70, 44, "/service/clipped"));
    f.controls.push(f.node("hidden-clear", 0, 0), f.node("offscreen-recovery", 900));
    restoreDirectoryView(f.list, { scroll: 2200, focus: "/service/clipped" }, input);
    assert.deepEqual(f.effects, [["scroll", { top: 2200, behavior: "instant" }],
      ["into-view", "query", { block: "center", behavior: "instant" }], ["focus", "query", { preventScroll: true }]]);
  } finally { f.restore(); }
});

test("ordinary history restoration retains its existing header fallback without Browse input", () => {
  const f = fixture();
  try {
    restoreDirectoryView(f.list, { scroll: 800, focus: "" });
    assert.deepEqual(f.effects, [["scroll", { top: 800, behavior: "instant" }], ["focus", "brand", { preventScroll: true }]]);
  } finally { f.restore(); }
});

test("a denied history write still returns the fresh bounded private snapshot", () => {
  const stale = { rwnDirectory: { path: "/directory", query: "Old query" }, retained: true };
  const history = { state: stale, replaceState() { throw new Error("restricted"); } };
  const result = writeDirectoryState(history, "/directory", { query: "New query", category: "food", country: "France", shown: 0, scroll: 455, focus: "/service/useful" });
  assert.deepEqual(result, { query: "New query", category: "food", country: "France", shown: 60, scroll: 455, focus: "/service/useful" });
  assert.equal(history.state, stale);
  assert.equal(history.state.rwnDirectory.query, "Old query");
});
