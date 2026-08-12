import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(path, "utf8");
}

test("finder starts calm without persistent tutorial or forced-scroll clutter", async () => {
  const refinement = await text("src/refinement.js");
  const bootstrap = await text("src/bootstrap.js");
  const css = await text("src/clarity.css");

  assert.match(refinement, /input\.placeholder = "Search a service or place"/);
  assert.match(refinement, /Search by service, place, ZIP or postcode, or organization/);
  assert.match(refinement, /Try a service, city, ZIP or postcode, or organization name/);
  assert.match(refinement, /rwn-initial-calm/);
  assert.doesNotMatch(refinement, /scrollIntoView/);
  assert.doesNotMatch(refinement, /globe-guide|Tap a glow for details|has-used-globe/);
  assert.match(bootstrap, /pause globe rotation/i);
  assert.match(bootstrap, /touch-action:\s*pan-y/);
  assert.match(css, /\.mobile-taskbar,\s*\.globe-guide,[\s\S]*display:\s*none !important;/);
});

test("globe points become calmer rather than larger as users zoom into dense places", async () => {
  const points = await text("src/globe-points.js");

  assert.match(points, /attribute float pointOpacity/);
  assert.match(points, /closeViewCalm = clamp\(0\.92 - max\(0\.0, uZoom - 1\.0\) \* 0\.085, 0\.72, 0\.92\)/);
  assert.match(points, /resource\.kind === "locator"\) return 0\.76/);
  assert.match(points, /resource\.kind === "locator"\) return 0\.72/);
  assert.doesNotMatch(points, /zoomBoost = clamp\(0\.72 \+ max/);
});

test("institutional presentation is restrained and motion-safe", async () => {
  const bootstrap = await text("src/bootstrap.js");
  const css = await text("src/clarity.css");

  assert.doesNotMatch(bootstrap, /experience\.js/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.rwn-reveal/);
  assert.match(css, /scroll-behavior:\s*auto !important/);
});
