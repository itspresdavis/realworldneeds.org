import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const accessibility = await readFile(new URL("../src/accessibility.js", import.meta.url), "utf8");
const professional = await readFile(new URL("../src/professional.js", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../src/bootstrap.js", import.meta.url), "utf8");
const serviceActionsCss = await readFile(new URL("../public/service-actions.css", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const builtIndex = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const builtBootstrap = await readFile(new URL("../dist/src/bootstrap.js", import.meta.url), "utf8");

test("institutional pass keeps a durable text-results route before the globe", () => {
  assert.match(app, /id="jumpResults" href="#results"/);
  assert.match(app, /class="results-section" id="results"/);
  assert.match(app, /id="matchingResultCount"/);
  assert.doesNotMatch(accessibility, /const quickNeeds =/);
});

test("institutional pass uses coarse location and persistent recovery guidance", () => {
  assert.match(app, /locationRecovery:/);
  assert.match(app, /id="locationRecovery"/);
  assert.match(app, /enableHighAccuracy: false/);
  assert.match(app, /Search by city, ZIP or postcode instead/);
  assert.match(professional, /Your browser uses location to sort nearby listings/);
  assert.doesNotMatch(professional, /Your exact location stays in your browser/);
});

test("institutional pass recovers the established globe from context loss", () => {
  assert.match(app, /webglcontextlost/);
  assert.match(app, /webglcontextrestored/);
  assert.match(app, /function recoverGlobeContext/);
  assert.match(app, /id="retryGlobe"/);
  assert.match(app, /Interactive map restored/);
});

test("service print retains related fallback resources without raw URL clutter", () => {
  assert.doesNotMatch(serviceActionsCss, /\.related-services \{\s*display: none !important/);
  assert.match(serviceActionsCss, /#service \.related-services \{\s*display: block !important/);
  assert.doesNotMatch(serviceActionsCss, /attr\(href\)/);
});

test("standard quality commands bound competing full-build fixtures to one test file", () => {
  assert.equal(packageJson.scripts.test, "npm run build && node --test --test-concurrency=1");
  assert.ok(packageJson.scripts.check.endsWith(" && node --test --test-concurrency=1"));
});

test("offline cache and service-worker failures stay fail-open and report availability truthfully", () => {
  assert.match(bootstrap, /CustomEvent\("rwn:offline-unavailable"\)/);
  assert.match(bootstrap, /clearOfflineData\(\)\.catch\(reportOfflineUnavailable\)/);
  assert.match(bootstrap, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)\.catch\(reportOfflineUnavailable\)/);
  assert.match(app, /rwn:offline-unavailable/);
  assert.match(app, /Offline saving is unavailable\. The directory still works online\./);
});

test("fresh HTML versions un-hashed runtime assets so custom domains cannot reuse stale CSS or modules", () => {
  assert.match(builtIndex, /href="\/src\/styles\.css\?v=[a-f0-9]{12}"/);
  assert.match(builtIndex, /href="\/src\/app\.js\?v=[a-f0-9]{12}"/);
  assert.match(builtIndex, /src="\/src\/bootstrap\.js\?v=[a-f0-9]{12}"/);
  assert.match(builtBootstrap, /import\("\.\/app\.js\?v=[a-f0-9]{12}"\)/);
});
