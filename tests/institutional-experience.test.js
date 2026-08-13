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
  const globeProduction = await text("scripts/globe-production.mjs");
  const css = await text("src/clarity.css");

  assert.match(refinement, /input\.placeholder = "Search a service or place"/);
  assert.match(refinement, /Search by service, place, ZIP or postcode, or organization/);
  assert.match(refinement, /Service, city, ZIP or postcode, or organization name/);
  assert.doesNotMatch(refinement, /scrollIntoView/);
  assert.doesNotMatch(refinement, /globe-guide|Tap a glow for details|has-used-globe|No account|No paywall/);
  assert.doesNotMatch(bootstrap, /click\(\).*toggleMotion|pause globe rotation/i);
  assert.match(globeProduction, /autoRotate: false/);
  assert.match(globeProduction, /inspectorOpen: Boolean\(initialResource\)/);
  assert.match(presentation, /touch-action:pan-y/);
  assert.match(css, /\.mobile-taskbar,\s*\.globe-guide,[\s\S]*display:\s*none !important;/);
});

test("globe points communicate service type and stay legible through deep zoom", async () => {
  const points = await text("src/globe-points.js");

  assert.match(points, /attribute float pointOpacity/);
  assert.match(points, /attribute float pointKind/);
  assert.match(points, /deepViewCalm = 1\.0 - smoothstep\(5\.0, 8\.0, uZoom\) \* 0\.10/);
  assert.match(points, /resource\.kind === "locator"\) return 0\.86/);
  assert.match(points, /resource\.kind === "locator"\) return 0\.82/);
  assert.match(points, /resourcePointKind/);
  assert.match(points, /isDirect/);
  assert.match(points, /isLocator/);
  assert.match(points, /isNetwork/);
});

test("institutional presentation is restrained and motion-safe", async () => {
  const bootstrap = await text("src/bootstrap.js");
  const css = await text("src/clarity.css");

  assert.doesNotMatch(bootstrap, /experience\.js/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.rwn-reveal/);
  assert.match(css, /scroll-behavior:\s*auto !important/);
});
