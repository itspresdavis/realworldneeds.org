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
const clearSource = between("function clearUserLocation()", "function clearFinderFilters(");
const liveSource = between("async function loadLiveResourcesNearUser()", "function latLngVector(");
const requestSource = between('  document.getElementById("locateMe").addEventListener("click"', '  const canvas = document.getElementById("globeCanvas");');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const position = (latitude = 51.5, longitude = -0.1) => ({ coords: { latitude, longitude, accuracy: 1000 } });

function fixture({ country = "United Kingdom" } = {}) {
  const callbacks = [], effects = [], requests = [];
  const classes = new Set();
  const button = {
    innerHTML: "Use my location",
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    addEventListener: (_, callback) => { button.click = callback; },
  };
  const state = { userLocation: null, filtered: [{ id: "test-site", name: "Test site" }], liveResources: [] };
  const context = vm.createContext({
    state, liveSourceController: null, locationRequestGeneration: 0, AbortController,
    document: { getElementById: (id) => id === "locateMe" ? button : null },
    navigator: { geolocation: { getCurrentPosition: (success, failure) => callbacks.push({ success, failure }) } },
    icon: { locate: "" },
    countryAtCoordinate: () => ({ properties: { NAME: country } }),
    resourceCountryForFeature: (name) => name,
    isLikelyUnitedStatesPoint: () => false,
    updateFilters: () => effects.push("filters"),
    focusGlobeNearUser: () => effects.push("focus-globe"),
    renderLocationState: () => effects.push("location-state"),
    renderLiveSourceState: () => effects.push("live-state"),
    resourceDistanceKm: (location) => location ? 1 : null,
    isExactServiceSite: () => true,
    setSelected: (id) => effects.push(`selected:${id}`),
    nearbyExactCount: () => 1,
    notify: (message) => effects.push(message),
    fetchNearbyUsdaSites: (_, options) => { const pending = deferred(); requests.push({ ...pending, kind: "nearby", signal: options.signal }); return pending.promise; },
    fetchUsdaActiveCount: (options) => { const pending = deferred(); requests.push({ ...pending, kind: "count", signal: options.signal }); return pending.promise; },
  });
  vm.runInContext(`${clearSource}\n${liveSource}\n${requestSource}\nglobalThis.clear = clearUserLocation; globalThis.loadLive = loadLiveResourcesNearUser;`, context);
  return { context, state, button, callbacks, effects, requests, classes };
}

for (const outcome of ["success", "failure"]) {
  test(`clearing location ignores a late geolocation ${outcome}`, async () => {
    const f = fixture();
    f.button.click();
    assert.equal(f.callbacks.length, 1);
    f.context.clear();
    const effects = [...f.effects];
    if (outcome === "success") await f.callbacks[0].success(position());
    else f.callbacks[0].failure({ code: 1 });
    assert.equal(f.state.userLocation, null);
    assert.equal(f.state.locationRecovery, "");
    assert.equal(f.state.locationRetryAvailable, false);
    assert.equal(f.classes.has("is-loading"), false);
    assert.deepEqual(f.effects, effects, "a stale callback must not announce, select, or recenter");
  });
}

test("rapid location clicks share the current request; clearing permits a fresh request", async () => {
  const f = fixture();
  f.button.click(); f.button.click();
  assert.equal(f.callbacks.length, 1);
  f.context.clear(); f.button.click();
  assert.equal(f.callbacks.length, 2);
  await f.callbacks[0].success(position(1, 2));
  f.callbacks[0].failure({ code: 1 });
  assert.equal(f.state.userLocation, null);
  assert.equal(f.classes.has("is-loading"), true, "an old callback cannot stop the newer loading indicator");
  await f.callbacks[1].success(position());
  assert.equal(f.state.userLocation.lat, 51.5);
  assert.equal(f.state.locationRecovery, "");
  assert.equal(f.classes.has("is-loading"), false);
  assert.equal(f.effects.filter((effect) => effect.startsWith("selected:")).length, 1);
});

test("a current geolocation failure still offers retry and the retry can succeed", async () => {
  const f = fixture();
  f.button.click(); f.callbacks[0].failure({ code: 2 });
  assert.equal(f.state.locationRetryAvailable, true);
  assert.match(f.state.locationRecovery, /Try again/);
  f.button.click();
  await f.callbacks[1].success(position());
  assert.equal(f.state.userLocation.lat, 51.5);
  assert.equal(f.state.locationRecovery, "");
});

for (const outcome of ["resolve", "reject"]) {
  test(`clearing during live-service loading ignores late ${outcome} results and geolocation continuation`, async () => {
    const f = fixture({ country: "United States" });
    f.button.click();
    const success = f.callbacks[0].success(position(40.7, -74));
    assert.equal(f.requests.length, 2);
    f.context.clear();
    const effects = [...f.effects];
    assert.ok(f.requests.every((request) => request.signal.aborted));
    for (const request of f.requests) {
      if (outcome === "reject") request.reject(new Error("Aborted"));
      else request.resolve(request.kind === "nearby" ? [{ id: "stale", name: "Stale site" }] : 100);
    }
    await success;
    assert.equal(f.state.userLocation, null);
    assert.equal(f.state.liveResources.length, 0);
    assert.equal(f.state.liveNationalCount, null);
    assert.equal(f.state.liveSourceStatus, "idle");
    assert.deepEqual(f.effects, effects);
  });
}

test("an older live-service request cannot overwrite the replacement request", async () => {
  const f = fixture({ country: "United States" });
  f.state.userLocation = { lat: 40.7, lng: -74 };
  f.state.userCountry = "United States";
  const first = f.context.loadLive();
  const second = f.context.loadLive();
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[2].resolve([{ id: "new", name: "New site" }]); f.requests[3].resolve(200);
  await second;
  const effects = [...f.effects];
  f.requests[0].resolve([{ id: "old", name: "Old site" }]); f.requests[1].resolve(100);
  await first;
  assert.equal(f.state.liveResources[0].id, "new");
  assert.equal(f.state.liveNationalCount, 200);
  assert.deepEqual(f.effects, effects);
});
