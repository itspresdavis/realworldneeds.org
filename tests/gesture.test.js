import test from "node:test";
import assert from "node:assert/strict";

import {
  clampZoom,
  classifyGlobeDragIntent,
  globeViewProfile,
  pinchZoom,
  pointPickThresholdWorld,
  pointerDistance
} from "../src/utils/gesture.js";

test("pointer distance measures the first two active touches", () => {
  assert.equal(pointerDistance([{ x: 10, y: 20 }, { x: 40, y: 60 }]), 50);
  assert.equal(pointerDistance([{ x: 10, y: 20 }]), 0);
});

test("touch intent separates small movement, rotation, and page scrolling", () => {
  assert.equal(classifyGlobeDragIntent(3, 2), "pending");
  assert.equal(classifyGlobeDragIntent(24, 6), "rotate");
  assert.equal(classifyGlobeDragIntent(7, 28), "scroll");
  assert.equal(classifyGlobeDragIntent(11, 10), "pending");
});

test("spreading two fingers zooms the globe in", () => {
  assert.ok(pinchZoom(1, 100, 150, 0.82, 8) > 1);
});

test("pinching two fingers together zooms the globe out", () => {
  assert.ok(pinchZoom(1, 100, 70, 0.82, 8) < 1);
});

test("very small pinch changes are ignored", () => {
  assert.equal(pinchZoom(3, 200, 202, 0.82, 8), 3);
  assert.equal(pinchZoom(3, 200, 198, 0.82, 8), 3);
});

test("pinch zoom is clamped to safe rendering limits", () => {
  assert.equal(pinchZoom(1, 100, 10000, 0.82, 8), 8);
  assert.equal(pinchZoom(1, 100, 1, 0.82, 8), 0.82);
  assert.equal(clampZoom(20, 0.82, 12), 12);
});

test("deep globe view increases detail while keeping a safe camera distance", () => {
  const desktop4 = globeViewProfile(4);
  const desktop12 = globeViewProfile(12);
  const mobile8 = globeViewProfile(8, { mobile: true });
  assert.ok(desktop12.opticalZoom > desktop4.opticalZoom);
  assert.ok(desktop12.fov < desktop4.fov);
  assert.ok(desktop12.fov >= 34.5);
  assert.equal(desktop12.minimumCameraDistance, 1.4);
  assert.equal(mobile8.minimumCameraDistance, 1.5);
  assert.ok(mobile8.fov >= 36.5);
});

test("point picking keeps touch targets larger while becoming more precise at deep zoom", () => {
  const touchWide = pointPickThresholdWorld({ pointerType: "touch", zoom: 1, cameraDistance: 3.2, fov: 42, viewportHeight: 700 });
  const mouseWide = pointPickThresholdWorld({ pointerType: "mouse", zoom: 1, cameraDistance: 3.2, fov: 42, viewportHeight: 700 });
  const touchDeep = pointPickThresholdWorld({ pointerType: "touch", zoom: 10, cameraDistance: 1.4, fov: 35, viewportHeight: 700 });
  assert.ok(touchWide > mouseWide);
  assert.ok(touchDeep < touchWide);
  assert.ok(touchDeep >= 0.0055);
});
