import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(path, "utf8");
}

test("finder starts calm without persistent tutorial or forced-scroll clutter", async () => {
  const refinement = await text("src/refinement.js");
  const bootstrap = await text("src/bootstrap.js");
  const presentation = await text("scripts/professional-seo.mjs");
  const app = await text("src/app.js");
  const css = await text("src/clarity.css");

  assert.match(refinement, /input\.placeholder = "Search by service or place"/);
  assert.match(refinement, /Search the directory by need, service, place, ZIP or postcode, or organization/);
  assert.match(refinement, /Need, service, city, ZIP or postcode, or organization name/);
  assert.doesNotMatch(refinement, /scrollIntoView/);
  assert.doesNotMatch(refinement, /globe-guide|Tap a glow for details|has-used-globe|No account|No paywall/);
  assert.doesNotMatch(bootstrap, /click\(\).*toggleMotion|pause globe rotation/i);
  assert.match(app, /autoRotate: false/);
  assert.match(app, /inspectorOpen: Boolean\(initialResource \|\| initialFinderHistory\?\.selectedId\)/);
  assert.match(presentation, /touch-action:pan-y/);
  assert.match(css, /\.mobile-taskbar,\s*\.globe-guide,[\s\S]*display:\s*none !important\s*;?\s*\}/);
});

test("globe points communicate service type and preserve coordinates as one semantic system", async () => {
  const points = await text("src/globe-points.js");

  assert.match(points, /attribute float pointOpacity/);
  assert.match(points, /attribute float pointKind/);
  assert.match(points, /attribute float pointDensity/);
  assert.match(points, /RWN_POINT_COLORS/);
  assert.doesNotMatch(points, /densityGridDegrees/);
  assert.match(points, /locationEntries/);
  assert.match(points, /resourcePointKind/);
  assert.match(points, /isDirect/);
  assert.match(points, /isLocator/);
  assert.match(points, /isNetwork/);
  assert.match(points, /THREE\.NormalBlending/);
  assert.doesNotMatch(points, /AdditiveBlending/);
});

test("institutional presentation is restrained and motion-safe", async () => {
  const bootstrap = await text("src/bootstrap.js");
  const css = await text("src/clarity.css");

  assert.doesNotMatch(bootstrap, /experience\.js/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /\.rwn-reveal/);
  assert.match(css, /scroll-behavior:\s*auto !important/);
});
