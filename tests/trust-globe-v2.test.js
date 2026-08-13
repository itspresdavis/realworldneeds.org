import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production globe starts calm, zooms deeply, and preserves ordinary page scrolling", async () => {
  const app = await readFile("dist/src/app.js", "utf8");

  assert.match(app, /return window\.innerWidth <= 600 \? 6\.5 : 9\.0/);
  assert.match(app, /const DEFAULT_RESOURCE = null/);
  assert.match(app, /const initialResource = resources\.some\([^\n]+\) \? requestedResource : null/);
  assert.match(app, /autoRotate: false/);
  assert.match(app, /inspectorOpen: Boolean\(initialResource\)/);
  assert.match(app, /PerspectiveCamera\(42, 1, 0\.02, 100\)/);
  assert.match(app, /const opticalZoom = Math\.pow\(Math\.max\(1, state\.zoom \* state\.ambientZoom\), 0\.42\)/);
  assert.match(app, /Math\.max\(window\.innerWidth <= 600 \? 1\.62 : 1\.5, globeBaseCameraDistance \/ opticalZoom\)/);
  assert.match(app, /new THREE\.SphereGeometry\(1, window\.innerWidth <= 600 \? 144 : 256, window\.innerWidth <= 600 \? 96 : 160\)/);

  const wheel = app.match(/canvas\.addEventListener\("wheel", \(event\) => \{([\s\S]*?)\}, \{ passive: false \}\);/)?.[1] || "";
  assert.match(wheel, /if \(!\(event\.ctrlKey \|\| event\.metaKey\)\) return/);
  assert.match(wheel, /event\.preventDefault\(\)/);
  assert.ok(wheel.indexOf("return;") < wheel.indexOf("event.preventDefault()"), "ordinary wheel scrolling must escape before preventDefault");
});

test("globe points communicate listing type instead of rendering every record as the same dot", async () => {
  const points = await readFile("src/globe-points.js", "utf8");
  assert.match(points, /attribute float pointKind/);
  assert.match(points, /resourcePointKind/);
  assert.match(points, /isDirect/);
  assert.match(points, /isLocator/);
  assert.match(points, /isNetwork/);
});

test("homepage uses one final presentation system and plain organizational language", async () => {
  const html = await readFile("dist/index.html", "utf8");
  const presentation = await readFile("scripts/professional-seo.mjs", "utf8");
  const copy = await readFile("src/professional.js", "utf8");
  const refinement = await readFile("src/refinement.js", "utf8");

  assert.match(html, /\/src\/clarity\.css\?v=/);
  assert.doesNotMatch(html, /\/src\/professional\.css\?v=/);
  assert.doesNotMatch(presentation, /href=\"\/src\/professional\.css/);
  assert.match(copy, /Find essential services near you\./);
  assert.match(copy, /Listings include provider contact details, the original source, and the date RWN checked it\./);
  assert.match(copy, /What Real World Needs does\./);
  assert.doesNotMatch(refinement, /No account|No paywall|Original sources/);
});

test("generated public pages use the same official mark and compact shared presentation", async () => {
  const directory = await readFile("dist/directory/index.html", "utf8");
  const pages = await readFile("public/professional-pages.css", "utf8");

  assert.match(directory, /\/brand\/rwn-logo-192\.png/);
  assert.match(directory, /\/professional-pages\.css\?v=/);
  assert.match(directory, /Find a service in the directory\./);
  assert.doesNotMatch(directory, /Text directory/);
  assert.match(pages, /--page-blue: #07538d/);
  assert.match(pages, /font-size:\s*clamp\(2\.35rem,4\.3vw,3\.8rem\)/);
});
