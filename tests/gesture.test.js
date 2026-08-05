import test from "node:test";
import assert from "node:assert/strict";

import { clampZoom, pinchZoom, pointerDistance } from "../src/utils/gesture.js";

test("pointer distance measures the first two active touches", () => {
  assert.equal(pointerDistance([{ x: 10, y: 20 }, { x: 40, y: 60 }]), 50);
  assert.equal(pointerDistance([{ x: 10, y: 20 }]), 0);
});

test("spreading two fingers zooms the globe in", () => {
  assert.ok(pinchZoom(1, 100, 150, 0.82, 1.42) > 1);
});

test("pinching two fingers together zooms the globe out", () => {
  assert.ok(pinchZoom(1, 100, 70, 0.82, 1.42) < 1);
});

test("pinch zoom is clamped to safe rendering limits", () => {
  assert.equal(pinchZoom(1, 100, 1000, 0.82, 1.42), 1.42);
  assert.equal(pinchZoom(1, 100, 1, 0.82, 1.42), 0.82);
  assert.equal(clampZoom(2, 0.82, 1.42), 1.42);
});
