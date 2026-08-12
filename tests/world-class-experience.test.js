import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(path, "utf8");
}

test("finder starts calm and teaches the globe without adding persistent clutter", async () => {
  const refinement = await text("src/refinement.js");
  const css = await text("src/refinement.css");

  assert.match(refinement, /input\.placeholder = "Search a service or place"/);
  assert.match(refinement, /Search by service, place, ZIP or postcode, or organization/);
  assert.match(refinement, /Try “food pantry”, “Boston”, a ZIP\/postcode, “showers”, or an organization name/);
  assert.match(refinement, /rwn-initial-calm/);
  assert.match(refinement, /Select a marker for details/);
  assert.match(refinement, /has-used-globe/);
  assert.match(css, /\.globe-detail-status,\s*\.globe-readout\s*\{\s*display: none !important;/s);
  assert.match(css, /\.globe-stage\.has-used-globe \.globe-guide/);
});

test("globe points become calmer rather than larger as users zoom into dense places", async () => {
  const points = await text("src/globe-points.js");

  assert.match(points, /attribute float pointOpacity/);
  assert.match(points, /closeViewCalm = clamp\(0\.92 - max\(0\.0, uZoom - 1\.0\) \* 0\.085, 0\.72, 0\.92\)/);
  assert.match(points, /resource\.kind === "locator"\) return 0\.76/);
  assert.match(points, /resource\.kind === "locator"\) return 0\.72/);
  assert.doesNotMatch(points, /zoomBoost = clamp\(0\.72 \+ max/);
});

test("editorial experience is human, useful, and motion-safe", async () => {
  const experience = await text("src/experience.js");
  const css = await text("src/refinement.css");

  assert.match(experience, /The help should be easier to reach than the crisis/);
  assert.match(experience, /No account required/);
  assert.match(experience, /No paywall/);
  assert.match(experience, /Original sources stay visible/);
  assert.match(experience, /IntersectionObserver/);
  assert.match(experience, /reduceMotion/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.rwn-reveal\.is-visible/);
});
