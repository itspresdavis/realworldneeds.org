import test from "node:test";
import assert from "node:assert/strict";
import { GESTURE_IDLE_MS, classifyWheelIntent, wheelZoomFactor } from "../src/utils/globe-zoom.js";

test("plain vertical wheel over the globe scrolls the page", () => {
  assert.equal(classifyWheelIntent({ deltaY: 120 }), "page");
  assert.equal(classifyWheelIntent({ deltaY: -120 }), "page");
});

test("an explicit pinch-zoom gesture always zooms the globe", () => {
  assert.equal(classifyWheelIntent({ deltaY: 40, ctrlKey: true }), "zoom");
  assert.equal(classifyWheelIntent({ deltaY: -40, metaKey: true }), "zoom");
});

test("a clearly horizontal gesture belongs to the map", () => {
  assert.equal(classifyWheelIntent({ deltaX: 60, deltaY: 4 }), "zoom");
  // Diagonal drift stays with the page rather than stealing the scroll.
  assert.equal(classifyWheelIntent({ deltaX: 30, deltaY: 28 }), "page");
});

test("an engaged globe only claims the wheel once the page cannot scroll further", () => {
  assert.equal(classifyWheelIntent({ deltaY: 120, engaged: true }), "page");
  assert.equal(classifyWheelIntent({ deltaY: 120, engaged: true, pageAtBottom: true }), "zoom");
  assert.equal(classifyWheelIntent({ deltaY: -120, engaged: true, pageAtTop: true }), "zoom");
  // Not engaged means the page always wins, even at the boundary.
  assert.equal(classifyWheelIntent({ deltaY: 120, engaged: false, pageAtBottom: true }), "page");
});

test("a gesture keeps its owner until the wheel goes quiet", () => {
  assert.equal(
    classifyWheelIntent({ deltaY: 120, activeOwner: "zoom", timeSinceLastWheel: 40 }),
    "zoom",
    "a zoom gesture must not hand the page a stray frame mid-flick"
  );
  assert.equal(
    classifyWheelIntent({ deltaY: 4, deltaX: 60, activeOwner: "page", timeSinceLastWheel: 40 }),
    "page",
    "a page gesture must not be hijacked mid-flick"
  );
  assert.equal(
    classifyWheelIntent({ deltaY: 120, activeOwner: "zoom", timeSinceLastWheel: GESTURE_IDLE_MS + 1 }),
    "page",
    "once the gesture ends, ownership is decided fresh"
  );
});

test("zoom factor is bounded so one wheel notch cannot teleport the camera", () => {
  assert.ok(wheelZoomFactor(-100) > 1, "scrolling up zooms in");
  assert.ok(wheelZoomFactor(100) < 1, "scrolling down zooms out");
  assert.ok(wheelZoomFactor(-100000) <= wheelZoomFactor(-120) + 1e-9, "extreme deltas clamp");
  assert.ok(wheelZoomFactor(-100000) < 1.6, "a single event cannot multiply zoom wildly");
  assert.equal(wheelZoomFactor(0), 1);
  // Trackpad pinches report smaller deltas, so they use a gentler curve.
  assert.ok(wheelZoomFactor(-40, { precise: true }) < wheelZoomFactor(-40), "precise mode is finer");
});
