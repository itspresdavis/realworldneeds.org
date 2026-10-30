import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/saved-services.js", import.meta.url), "utf8");
const helper = source.slice(source.indexOf("function focusSavedServicesHeading("), source.indexOf("export function initSavedServices("));

function focusHeading({ top = 61, height = 40, headerBottom = 74, scrollY = 45, scrollX = 13, viewportHeight = 900, hash = "#saved", canFocus = true } = {}) {
  const calls = [], focuses = [], frames = new Map(), events = new Map();
  let nextFrame = 0;
  const addEventListener = (name, callback) => { const listeners = events.get(name) || new Set(); listeners.add(callback); events.set(name, listeners); };
  const removeEventListener = (name, callback) => events.get(name)?.delete(callback);
  const document = { activeElement: {}, addEventListener, removeEventListener, querySelector: () => headerBottom === null ? null : { getBoundingClientRect: () => ({ bottom: headerBottom }) } };
  const heading = {
    focus(options) { focuses.push(options); if (canFocus) document.activeElement = heading; },
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
  };
  const context = vm.createContext({
    document, location: { hash },
    window: { innerHeight: viewportHeight, scrollX, scrollY, scrollTo: (options) => calls.push({ ...options }),
      addEventListener, removeEventListener,
      requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame(id) { frames.delete(id); } },
  });
  vm.runInContext(helper, context);
  context.focusSavedServicesHeading(heading);
  return { calls, focuses, heading, document, context, frames,
    restoreGeometry(next) { if ("top" in next) top=next.top; if ("headerBottom" in next) headerBottom=next.headerBottom; if ("scrollY" in next) context.window.scrollY=next.scrollY; },
    frame() { const callbacks=[...frames.values()]; frames.clear(); for(const callback of callbacks) callback(); },
    emit(name) { for(const callback of [...(events.get(name) || [])]) callback(); },
    listenerCount: () => [...events.values()].reduce((total,listeners)=>total+listeners.size,0),
  };
}

test("Back from an unfinished Browse scroll reveals the heading below the actual header", () => {
  for (const state of [{ top: 61, scrollY: 45 }, { top: 24, scrollY: 82 }]) {
    const f = focusHeading(state);
    assert.equal(f.document.activeElement, f.heading);
    assert.equal(f.focuses[0].preventScroll, true);
    assert.deepEqual(f.calls, [{ left: 13, top: 26, behavior: "instant" }]);
  }
});

test("an already visible heading stays in place while instant scroll cancels pending smooth movement", () => {
  const f = focusHeading({ top: 106, scrollY: 0 });
  assert.deepEqual(f.calls, [{ left: 13, top: 0, behavior: "instant" }]);
});

test("wrapped or zoomed navigation uses its measured bottom instead of a fixed header size", () => {
  const f = focusHeading({ headerBottom: 96 });
  assert.deepEqual(f.calls, [{ left: 13, top: 4, behavior: "instant" }]);
});

test("a heading below the viewport scrolls only far enough to expose its bottom", () => {
  const f = focusHeading({ top: 880, height: 40, scrollY: 20 });
  assert.deepEqual(f.calls, [{ left: 13, top: 46, behavior: "instant" }]);
});

test("a heading taller than the available viewport aligns its start below the header", () => {
  const f = focusHeading({ top: 200, height: 300, viewportHeight: 250, scrollY: 20 });
  assert.deepEqual(f.calls, [{ left: 13, top: 140, behavior: "instant" }]);
});

test("a missing header retains the viewport clearance and never scrolls above the document", () => {
  const f = focusHeading({ headerBottom: null, top: 0, scrollY: 3 });
  assert.deepEqual(f.calls, [{ left: 13, top: 0, behavior: "instant" }]);
});

test("leaving Saved never steals focus or cancels the destination scroll", () => {
  const f = focusHeading({ hash: "#directory-results" });
  assert.equal(f.focuses.length, 0);
  assert.equal(f.calls.length, 0);
});

test("failed focus and hidden headings do not change scroll position", () => {
  for (const state of [{ canFocus: false }, { height: 0 }]) {
    const f = focusHeading(state);
    assert.equal(f.calls.length, 0);
  }
});


test("late Back restoration at 508px cannot leave the focused heading behind the header", () => {
  const f = focusHeading({ top: 93.1875, headerBottom: 66, scrollY: 0 });
  f.restoreGeometry({ top: 59.1875, scrollY: 34 });
  f.frame();
  assert.deepEqual(f.calls.at(-1), { left: 13, top: 21.1875, behavior: "instant" });
  assert.equal(f.focuses.length, 1, "the correction adjusts scroll without refocusing");
  assert.equal(f.frames.size, 0, "the repair is bounded to one follow-up frame");
  assert.equal(f.listenerCount(), 0);
});

test("post-restoration correction measures the current header again", () => {
  const f = focusHeading({ top: 106, headerBottom: 66, scrollY: 0 });
  f.restoreGeometry({ top: 61, scrollY: 45, headerBottom: 96 });
  f.frame();
  assert.deepEqual(f.calls.at(-1), { left: 13, top: 4, behavior: "instant" });
});

for (const action of ["wheel", "touchstart", "pointerdown", "keydown", "focusin", "hashchange", "pagehide", "blur", "visibilitychange"]) {
  test(`a reader's ${action} cancels the pending Saved alignment`, () => {
    const f = focusHeading();
    f.emit(action); f.restoreGeometry({ top: 10, scrollY: 96 }); f.frame();
    assert.equal(f.calls.length, 1);
    assert.equal(f.focuses.length, 1);
    assert.equal(f.frames.size, 0);
    assert.equal(f.listenerCount(), 0);
  });
}

for (const state of ["focus", "hash"]) test(`follow-up never overrides a changed ${state}`, () => {
  const f = focusHeading();
  if (state === "focus") f.document.activeElement = {};
  else f.context.location.hash = "#directory-results";
  f.restoreGeometry({ top: 10, scrollY: 96 }); f.frame();
  assert.equal(f.calls.length, 1);
  assert.equal(f.listenerCount(), 0);
});
