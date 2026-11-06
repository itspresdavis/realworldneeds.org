import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { normalizeLongitude } from "../src/utils/geo.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
function between(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
  return app.slice(first, last);
}
const containmentSource = between("function extractRings(", "function selectCountryFromPointer(");
const state = {};
const context = vm.createContext({ normalizeLongitude, state });
vm.runInContext(containmentSource, context);
const contains = context.geometryContainsCoordinate;
const polygon = (...rings) => ({ type: "Polygon", coordinates: rings });
const rectangle = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const datasets = await Promise.all(["countries.geojson", "countries-detail.geojson"].map(async (name) => ({
  name,
  features: JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url), "utf8")).features,
})));
const matches = (features, lat, lng) => features.filter((feature) => contains(feature.geometry, lat, lng)).map((feature) => feature.properties.NAME);

test("a country rectangle does not also contain its opposite meridian", () => {
  for (const ring of [rectangle(100, 30, 110, 50), rectangle(100, 30, 110, 50).reverse()]) {
    assert.equal(contains(polygon(ring), 40, 105), true);
    assert.equal(contains(polygon(ring), 40, -75), false);
    assert.equal(contains(polygon(ring), 0, 105), false);
    assert.equal(contains(polygon(ring), 40, 115), false);
  }
});

test("holes, reversed winding and disjoint islands retain their geographic interiors", () => {
  const outer = rectangle(100, 30, 110, 50), hole = rectangle(103, 35, 107, 45);
  for (const reverse of [false, true]) {
    const geometry = polygon(reverse ? [...outer].reverse() : outer, reverse ? [...hole].reverse() : hole);
    assert.equal(contains(geometry, 32, 105), true);
    assert.equal(contains(geometry, 40, 105), false);
    assert.equal(contains(geometry, 40, -75), false);
    const multipart = { type: "MultiPolygon", coordinates: [geometry.coordinates, [rectangle(-20, -10, -10, 0)]] };
    assert.equal(contains(multipart, -5, -15), true);
    assert.equal(contains(multipart, 32, 105), true);
    assert.equal(contains(multipart, 40, 105), false);
    assert.equal(contains(multipart, 10, 50), false);
  }
  assert.equal(contains(null, 0, 0), false);
  assert.equal(contains(polygon(), 0, 0), false);
});

test("containment keeps the existing half-open boundary rule without adding an epsilon", () => {
  for (const ring of [rectangle(100, 30, 110, 50), rectangle(100, 30, 110, 50).reverse()]) {
    const geometry = polygon(ring);
    for (const [lat, lng, expected] of [[40, 100, true], [30, 105, true], [40, 110, false], [50, 105, false], [30, 100, true], [50, 110, false], [40, 100 - 1e-8, false], [40, 100 + 1e-8, true], [40, 110 - 1e-8, true], [40, 110 + 1e-8, false]]) {
      assert.equal(contains(geometry, lat, lng), expected, `${lat}, ${lng}`);
    }
    const withHole = polygon(ring, rectangle(103, 35, 107, 45));
    assert.equal(contains(withHole, 40, 103), false);
    assert.equal(contains(withHole, 35, 105), false);
    assert.equal(contains(withHole, 40, 107), true);
    assert.equal(contains(withHole, 45, 105), true);
  }
});

test("antimeridian-cut multipolygons contain both sides of the seam without spanning the world", () => {
  const geometry = { type: "MultiPolygon", coordinates: [[rectangle(170, -10, 180, 10)], [rectangle(-180, -10, -170, 10)]] };
  for (const lng of [175, -175, 180, -180, 540, -540, 175 + 720, -175 - 720]) assert.equal(contains(geometry, 0, lng), true);
  for (const lng of [0, 160, -160, 360, -360]) assert.equal(contains(geometry, 0, lng), false);
  assert.equal(contains(geometry, 20, 180), false);
});

const places = [
  ["US regression", 40, -75, "United States of America"],
  ["Denver", 39.7, -105, "United States of America"],
  ["Chicago", 41.8, -87.6, "United States of America"],
  ["Seattle", 47.6, -122.3, "United States of America"],
  ["Los Angeles", 34, -118.2, "United States of America"],
  ["Fairbanks", 64.84, -147.72, "United States of America"],
  ["Beijing", 39.9, 116.4, "China"],
  ["Tokyo", 35.68, 139.69, "Japan"],
  ["Delhi", 28.6, 77.2, "India"],
  ["London", 51.5, -0.12, "United Kingdom"],
  ["Vienna", 48.2, 16.37, "Austria"],
  ["Reykjavik", 64.1, -21.9, "Iceland"],
  ["Nairobi", -1.28, 36.82, "Kenya"],
  ["Maseru inside South Africa's hole", -29.31, 27.48, "Lesotho"],
  ["Sydney", -33.87, 151.21, "Australia"],
  ["Wellington", -41.3, 174.8, "New Zealand"],
  ["Lima", -12.05, -77.04, "Peru"],
  ["Brasilia", -15.8, -47.9, "Brazil"],
  ["Buenos Aires", -34.6, -58.4, "Argentina"],
  ["Fiji west of seam", -16.841, -179.981, "Fiji"],
  ["Fiji east of seam", -16.43, 179.37, "Fiji"],
  ["Russia west of seam", 66, -179.99, "Russia"],
  ["Russia east of seam", 66, 179.99, "Russia"],
  ["Antarctic interior", -85, 0, "Antarctica"],
  ["South Pole closure", -90, 0, "Antarctica"],
  ["North Pole", 90, 0, null],
  ["Arctic Ocean", 89, 0, null],
  ["Pacific Ocean", 0, -150, null],
  ["Atlantic Ocean", 20, -40, null],
];

for (const { name, features } of datasets) {
  test(`${name}: unambiguous worldwide land and ocean interiors have no remote matches`, () => {
    for (const [label, lat, lng, country] of places) {
      const expected = country ? [country] : [];
      assert.deepEqual(matches(features, lat, lng), expected, label);
      assert.deepEqual(matches([...features].reverse(), lat, lng), expected, `${label}, reversed feature order`);
    }
  });

  test(`${name}: equivalent longitude queries agree at the seam, poles and inland`, () => {
    for (const [lat, lng, country] of [[40, -75, "United States of America"], [-85, 180, "Antarctica"], [-90, 180, "Antarctica"], [66, 180, "Russia"], [90, 180, null], [0, 180, null]]) {
      for (const turns of [-2, -1, 0, 1, 2]) assert.deepEqual(matches(features, lat, lng + 360 * turns), country ? [country] : [], `${lat}, ${lng + 360 * turns}`);
    }
  });

  test(`${name}: bundled geometry preserves Cartesian antimeridian cuts and pole closures`, () => {
    for (const feature of features) {
      assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) for (const ring of polygon) {
        assert.deepEqual(ring[0], ring.at(-1), `${feature.properties.NAME}: closed ring`);
        for (let i = 0; i < ring.length; i++) {
          const [lng, lat] = ring[i], previous = ring[(i + ring.length - 1) % ring.length];
          assert.ok(Number.isFinite(lng) && lng >= -180 && lng <= 180);
          assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90);
          if (Math.abs(lng - previous[0]) > 180) assert.ok(Math.abs(lng - previous[0]) === 360 && Math.abs(lat) === 90 && lat === previous[1], `${feature.properties.NAME}: uncut edge`);
        }
      }
    }
  });
}

test("repeated synthetic US location uses the real country lookup before and after detailed geometry loads", async () => {
  const callbacks = [], requests = [], classes = new Set();
  const button = {
    classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (...names) => names.forEach((name) => classes.delete(name)) },
    addEventListener: (_, callback) => { button.click = callback; },
  };
  const state = { userLocation: null, filtered: [], liveResources: [], countryFeatures: datasets[0].features, detailCountryFeatures: [], detailGeometryReady: false };
  const context = vm.createContext({
    state, normalizeLongitude, locationRequestGeneration: 0, liveSourceController: null, AbortController,
    globeRenderer: {}, pendingDetailGeometry: null, pendingDetailImage: null,
    document: { getElementById: (id) => id === "locateMe" ? button : null },
    navigator: { geolocation: { getCurrentPosition: (success) => callbacks.push(success) } },
    icon: { locate: "" },
    isLikelyUnitedStatesPoint: () => { throw new Error("Real geometry must identify the country without a regional fallback"); },
    loadLandGeometry: async () => { assert.ok(state.countryFeatures.length, "fixture geometry is already available"); }, updateFilters() {}, focusGlobeNearUser() {}, renderLocationState() {}, renderLiveSourceState() {}, notify() {},
    rebuildCountryBorders() {}, updateGlobeLandMask() {},
    nearbyExactCount: () => 0,
    fetchNearbyUsdaSites: async (location) => { requests.push(["nearby", location.lat, location.lng]); return []; },
    fetchUsdaActiveCount: async () => { requests.push(["count"]); return 0; },
  });
  vm.runInContext([
    containmentSource,
    between("const countryNameAliases =", "function allTypes("),
    between("function resourceCountryForFeature(", "function countryFeatureByName("),
    between("function applyPendingGlobeDetail()", "function animateGlobe("),
    between("function clearUserLocation()", "function clearFinderFilters("),
    between("async function loadLiveResourcesNearUser()", "function latLngVector("),
    between('  document.getElementById("locateMe").addEventListener("click"', '  const canvas = document.getElementById("globeCanvas");'),
  ].join("\n"), context);
  for (const detailReady of [false, true, true]) {
    context.clearUserLocation();
    if (detailReady && !state.detailGeometryReady) {
      context.pendingDetailGeometry = datasets[1].features;
      context.applyPendingGlobeDetail();
      assert.equal(state.detailCountryFeatures, datasets[1].features);
      assert.ok(state.detailLandRings.length > 0);
      assert.equal(context.pendingDetailGeometry, null);
    }
    assert.equal(state.detailGeometryReady, detailReady);
    button.click();
    await callbacks.at(-1)({ coords: { latitude: 40, longitude: -75, accuracy: 1000 } });
    assert.equal(state.userCountry, "United States");
    assert.equal(state.liveSourceStatus, "loaded");
    assert.equal(state.liveNationalCount, 0);
    assert.equal(classes.has("is-loading"), false);
  }
  assert.deepEqual(requests, Array.from({ length: 3 }, () => [["nearby", 40, -75], ["count"]]).flat());
  context.clearUserLocation();
  button.click();
  await callbacks.at(-1)({ coords: { latitude: 51.5, longitude: -0.12, accuracy: 1000 } });
  assert.equal(state.userCountry, "United Kingdom");
  assert.equal(requests.length, 6, "a known non-U.S. point must not call either USDA adapter");
});
