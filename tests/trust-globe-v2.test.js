import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production globe starts calm, zooms deeply, and preserves ordinary page scrolling", async () => {
  const app = await readFile("dist/src/app.js", "utf8");

  assert.match(app, /return window\.innerWidth <= 600 \? 8\.0 : 12\.0/);
  assert.match(app, /const DEFAULT_RESOURCE = null/);
  assert.match(app, /const initialResource = resources\.some\([^\n]+\) \? requestedResource : null/);
  assert.match(app, /autoRotate: false/);
  assert.match(app, /inspectorOpen: Boolean\(initialResource \|\| initialFinderHistory\?\.selectedId\)/);
  assert.match(app, /PerspectiveCamera\(42, 1, 0\.02, 100\)/);
  assert.match(app, /globeViewProfile\(state\.zoom \* state\.ambientZoom/);
  assert.match(app, /minimumCameraDistance/);
  assert.match(app, /new THREE\.SphereGeometry\(1, window\.innerWidth <= 600 \? 160 : 288, window\.innerWidth <= 600 \? 112 : 180\)/);
  assert.match(app, /pointPickThresholdWorld/);
  assert.match(app, /classifyGlobeDragIntent/);

  // Wheel ownership is resolved per gesture by classifyWheelIntent. The
  // invariant that matters is that the listener returns without calling
  // preventDefault unless that decision was "zoom".
  const wheel = app.match(/globeStage\.addEventListener\("wheel", \(event\) => \{([\s\S]*?)\}, \{ passive: false \}\);/)?.[1] || "";
  assert.match(wheel, /classifyWheelIntent\(/);
  assert.match(wheel, /if \(intent !== "zoom"\) return;/);
  assert.match(wheel, /event\.preventDefault\(\)/);
  assert.ok(
    wheel.indexOf('if (intent !== "zoom") return;') < wheel.indexOf("event.preventDefault()"),
    "ordinary wheel scrolling must escape before preventDefault"
  );
  assert.match(wheel, /zoomTowardPointer\(/);
});

test("globe points communicate listing type without category-colored visual noise", async () => {
  const points = await readFile("src/globe-points.js", "utf8");
  assert.match(points, /attribute float pointKind/);
  assert.match(points, /attribute float pointDensity/);
  assert.match(points, /RWN_POINT_COLORS/);
  assert.match(points, /resourcePointKind/);
  assert.match(points, /isDirect/);
  assert.match(points, /isLocator/);
  assert.match(points, /isNetwork/);
  assert.match(points, /locationEntries/);
  assert.match(points, /THREE\.NormalBlending/);
  assert.doesNotMatch(points, /categories\[resource\.category\]\.color/);
});

test("homepage uses one final presentation system and plain organizational language", async () => {
  const html = await readFile("dist/index.html", "utf8");
  const presentation = await readFile("scripts/professional-seo.mjs", "utf8");
  const copy = await readFile("src/professional.js", "utf8");
  const refinement = await readFile("src/refinement.js", "utf8");

  assert.match(html, /\/src\/clarity\.css\?v=/);
  assert.doesNotMatch(html, /\/src\/professional\.css\?v=/);
  assert.doesNotMatch(presentation, /href=\"\/src\/professional\.css/);
  assert.match(copy, /Find essential services\./);
  assert.match(copy, /Food, water, shelter and other support\. Search by place or explore the map\./);
  assert.match(copy, /About Real World Needs/);
  assert.doesNotMatch(refinement, /No account|No paywall|Original sources/);
});

test("generated public pages use the same official mark and compact shared presentation", async () => {
  const directory = await readFile("dist/directory/index.html", "utf8");
  const pages = await readFile("public/professional-pages.css", "utf8");

  assert.match(directory, /\/brand\/rwn-logo-192\.png/);
  assert.match(directory, /\/professional-pages\.[a-f0-9]{12}\.css\?v=/);
  assert.match(directory, /<h1>Service directory<\/h1>/);
  assert.doesNotMatch(directory, /Text directory/);
  assert.match(pages, /--page-blue:\s*#24583e/);
  assert.match(pages, /font-size:\s*clamp\(2rem,\s*3\.4vw,\s*2\.75rem\)/);
});
