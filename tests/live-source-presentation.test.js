import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const between = (start, end) => {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
  return app.slice(first, last);
};
const renderSource = between("function renderLiveSourceState()", "function renderControls()");
const clearSource = between("function clearUserLocation()", "function clearFinderFilters(");
const loadSource = between("async function loadLiveResourcesNearUser()", "function latLngVector(");
const reachTemplate = app.match(/<p id="catalogReach">([\s\S]*?)<\/p>/)?.[1];
assert.ok(reachTemplate, "The real finder shell contains the reach summary");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function fixture(overrides = {}) {
  const resources = Array.from({ length: 1992 }, (_, id) => ({ id }));
  const directCount = () => 1800; // Synthetic fixture total, not a current catalog claim.
  let html = vm.runInNewContext(`\`${reachTemplate}\``, { resources, directCount });
  const writes = { status: 0, reach: 0, parent: 0 };
  const status = {
    value: "",
    get textContent() { return this.value; },
    set textContent(value) { this.value = value; writes.status += 1; },
  };
  const reach = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; writes.parent += 1; },
  };
  const liveReach = {
    get textContent() { return html.match(/<span id="liveSourceReach">([^<]*)<\/span>/)?.[1] || ""; },
    set textContent(value) {
      html = html.replace(/(<span id="liveSourceReach">)[^<]*(<\/span>)/, (_, start, end) => `${start}${value}${end}`);
      writes.reach += 1;
    },
  };
  const state = {
    liveSourceStatus: "idle", liveResources: [], liveNearbyAvailable: 0, liveNationalCount: null,
    liveSourceError: "", userLocation: null, userCountry: null, ...overrides,
  };
  const requests = [];
  const context = vm.createContext({
    state, resources, directCount, AbortController, liveSourceController: null, locationRequestGeneration: 0,
    document: { getElementById: id => ({
      liveSourceStatus: status, catalogReach: reach,
      liveSourceReach: html.includes('id="liveSourceReach"') ? liveReach : null,
    })[id] || null },
    resourceDistanceKm: (_, resource) => resource.distance ?? 1,
    fetchNearbyUsdaSites: (_, options) => { const pending = deferred(); requests.push({ ...pending, kind: "nearby", signal: options.signal }); return pending.promise; },
    fetchUsdaActiveCount: options => { const pending = deferred(); requests.push({ ...pending, kind: "count", signal: options.signal }); return pending.promise; },
  });
  vm.runInContext(`${renderSource}\n${clearSource}\n${loadSource}\nfunction updateFilters() { renderLiveSourceState(); }`, context);
  return { state, status, reach, writes, context, requests, render: () => context.renderLiveSourceState() };
}
const located = { userLocation: { lat: 40, lng: -75 }, userCountry: "United States" };
const loaded = { ...located, liveSourceStatus: "loaded" };

function assertNoCurrentClaim(f) {
  assert.doesNotMatch(f.reach.innerHTML, /17,?442|\d[\d,]* USDA meal sites? (?:listed as )?active/i);
}

test("the initial shell omits the undated historical USDA figure", () => {
  const f = fixture();
  assertNoCurrentClaim(f);
  assert.match(f.reach.innerHTML, /U\.S\. location search/);
});

test("valid national zero replaces historical reach and remains separate from nearby zero", () => {
  const f = fixture({ ...loaded, liveNationalCount: 0 });
  f.render();
  assert.match(f.reach.innerHTML, /0 USDA meal sites listed as active nationally today/);
  assert.match(f.status.textContent, /No current USDA meal sites were returned for this search area/);
  assert.match(f.status.textContent, /USDA lists 0 meal sites as active nationally today/);
  assert.match(f.status.textContent, /Other services/);
  assert.doesNotMatch(f.status.textContent, /unavailable/i);
});

for (const count of [1, 12345]) {
  test(`a known national count of ${count} is distinct from the nearby records loaded`, () => {
    const f = fixture({ ...loaded, liveResources: [{ id: "nearby" }], liveNearbyAvailable: 1, liveNationalCount: count });
    f.render();
    assert.match(f.status.textContent, /^Loaded 1 current USDA meal site nearby/);
    assert.ok(f.reach.innerHTML.includes(`${count.toLocaleString()} USDA meal ${count === 1 ? "site" : "sites"} listed as active nationally today`));
    assert.match(f.reach.innerHTML, /1,?992<\/strong> listings checked against original sources/);
    assert.match(f.reach.innerHTML, /1,?800 service locations/);
  });
}

test("the nearby cap is identified as loaded records rather than filtered/map results", () => {
  const f = fixture({ ...loaded, liveResources: Array(300).fill({}), liveNearbyAvailable: 450, liveNationalCount: 1000 });
  f.render();
  assert.match(f.status.textContent, /^Loaded the closest 300 of 450 current USDA meal sites nearby/);
  assert.match(f.status.textContent, /USDA lists 1,000 meal sites as active nationally today/);
});

for (const count of [null, undefined, -1, 1.5, NaN, Infinity, "100"]) {
  test(`unknown or invalid national state ${String(count)} cannot become a current count`, () => {
    const f = fixture({ ...loaded, liveResources: [{ id: "nearby" }], liveNearbyAvailable: 1, liveNationalCount: count });
    f.render();
    assertNoCurrentClaim(f);
    assert.match(f.reach.innerHTML, /Current national USDA meal-site count unavailable/);
    assert.match(f.status.textContent, /Loaded 1 current USDA meal site nearby/);
    assert.match(f.status.textContent, /National count unavailable/);
  });
}

test("clearing location removes the previous current count without replacing the directory link", () => {
  const f = fixture({ ...loaded, liveNationalCount: 100 });
  f.render();
  f.context.clearUserLocation();
  assert.equal(f.state.liveNationalCount, null);
  assertNoCurrentClaim(f);
  assert.match(f.reach.innerHTML, /U\.S\. location search/);
  assert.match(f.reach.innerHTML, /<a href="\/directory">Use the text directory<\/a>/);
  assert.equal(f.writes.parent, 0, "count changes must preserve the existing link and its focus");
});

test("loading, idle, and outside-US views do not revive an obsolete count", () => {
  const f = fixture({ ...loaded, liveNationalCount: 100 });
  f.render();
  for (const next of [
    { liveSourceStatus: "loading" },
    { liveSourceStatus: "idle", userCountry: "United Kingdom" },
    { liveSourceStatus: "idle", userLocation: null, userCountry: null },
  ]) {
    Object.assign(f.state, next);
    f.render();
    assertNoCurrentClaim(f);
  }
});

test("national success does not turn a nearby failure into nearby zero", () => {
  const f = fixture({ ...located, liveSourceStatus: "unavailable", liveNationalCount: 0 });
  f.render();
  assert.match(f.status.textContent, /unavailable/);
  assert.doesNotMatch(f.status.textContent, /No current|Loaded 0|Showing 0/);
  assert.match(f.reach.innerHTML, /0 USDA meal sites listed as active nationally today/);
});

test("a new request clears the previous national count before loading and on count failure", async () => {
  const f = fixture({ ...loaded, liveNationalCount: 100 });
  f.render();
  const pending = f.context.loadLiveResourcesNearUser();
  assert.equal(f.state.liveNationalCount, null);
  assertNoCurrentClaim(f);
  assert.match(f.reach.innerHTML, /Checking current USDA meal-site counts/);
  f.requests[0].resolve([]); f.requests[1].reject(new Error("Synthetic failure"));
  await pending;
  assert.equal(f.state.liveSourceStatus, "loaded");
  assert.equal(f.state.liveNationalCount, null);
  assertNoCurrentClaim(f);
  assert.match(f.status.textContent, /No current USDA meal sites were returned/);
  assert.match(f.status.textContent, /National count unavailable/);
});

test("both request failures remove stale counts and preserve the unavailable state", async () => {
  const f = fixture({ ...loaded, liveNationalCount: 100 });
  const pending = f.context.loadLiveResourcesNearUser();
  f.requests.forEach(request => request.reject(new Error("Synthetic failure")));
  await pending;
  assert.equal(f.state.liveSourceStatus, "unavailable");
  assertNoCurrentClaim(f);
  assert.match(f.reach.innerHTML, /count unavailable/);
  assert.match(f.status.textContent, /could not be loaded/);
});

test("late results after Clear cannot revive a current claim", async () => {
  const f = fixture({ ...located });
  const pending = f.context.loadLiveResourcesNearUser();
  f.context.clearUserLocation();
  f.requests[0].resolve([{ id: "stale", name: "Stale" }]); f.requests[1].resolve(100);
  await pending;
  assertNoCurrentClaim(f);
  assert.equal(f.state.liveSourceStatus, "idle");
});

test("the source status has polite live-region markup and avoids repeated writes", () => {
  assert.match(app, /<p[^>]*id="liveSourceStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  const f = fixture({ ...loaded, liveNationalCount: 0 });
  f.render();
  const writes = { ...f.writes };
  f.render(); f.render();
  assert.deepEqual(f.writes, writes, "unrelated filter updates must not repeatedly announce identical source status");
});
