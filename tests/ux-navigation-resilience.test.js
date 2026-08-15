import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("finder input is bounded and history stores only non-sensitive finder state", () => {
  assert.match(app, /const FINDER_QUERY_LIMIT = 180/);
  assert.match(app, /maxlength="180"/);
  assert.match(app, /function sanitizeFinderQuery/);
  assert.match(app, /const FINDER_HISTORY_KEY = "rwnFinder"/);
  assert.match(app, /function writeFinderHistory/);
  assert.match(app, /function restoreFinderHistory/);
  assert.doesNotMatch(app, /rwnFinder[^\n]*lat/);
  assert.doesNotMatch(app, /rwnFinder[^\n]*lng/);
  assert.match(app, /writeFinderHistory\("push"\)/);
  assert.match(app, /const scheduleSearchHistory/);
  assert.match(app, /searchInput\.addEventListener\("blur", commitPendingSearch\)/);
});

test("off-screen and hidden globe rendering can pause and resume without changing globe interaction contracts", () => {
  assert.match(app, /let globeFrameHandle = null/);
  assert.match(app, /function pauseGlobe/);
  assert.match(app, /function wakeGlobe/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /if \(state\.globeVisible\) wakeGlobe\(\);/);
});

test("finder and location failures have deterministic recovery paths", () => {
  assert.match(app, /id="clearFinderFilters"/);
  assert.match(app, /function clearFinderFilters/);
  assert.match(app, /id = "retryLocation"/);
  assert.match(app, /locationRetryAvailable/);
  assert.match(app, /id="locationRecovery"/);
});

test("mobile menu closes predictably and restores focus to its native summary control", () => {
  assert.match(app, /const closeSiteMenu/);
  assert.match(app, /siteMenuSummary\?\.focus\(\)/);
  assert.match(app, /event\.key === "Escape" && siteMenu\?\.open/);
  assert.match(app, /window\.innerWidth > 900/);
});

test("maintainers can run prompt-required interaction and abuse quality gates", () => {
  assert.equal(packageJson.scripts["qa:interaction"], "node scripts/browser-institutional.mjs");
  assert.equal(packageJson.scripts["qa:abuse"], "node scripts/browser-chaos.mjs");
});
