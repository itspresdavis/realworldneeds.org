import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import {
  cameraDistanceForSphere,
  featureGlobeView,
  formatResourcePlace,
  isExactServiceSite,
  normalizeLongitude,
  rankResourcesForLocation,
  resourceDistanceKm,
  resourceSearchScore,
  THREE_SPHERE_TEXTURE_OFFSET
} from "../src/utils/geo.js";
import { resources } from "../src/data/resources.js";

test("country framing remains stable across the antimeridian", () => {
  const feature = {
    geometry: {
      type: "Polygon",
      coordinates: [[[179, -10], [-179, -10], [-179, 10], [179, 10], [179, -10]]]
    }
  };
  const view = featureGlobeView(feature);
  assert.ok(Math.abs(Math.abs(view.lng) - 180) < 1);
  assert.ok(Math.abs(view.lat) < 1);
  assert.ok(view.angularRadius < 15);
});

test("country framing falls back safely when geometry is missing", () => {
  assert.deepEqual(featureGlobeView(null, { lat: 12, lng: -8 }), {
    lat: 12,
    lng: -8,
    zoom: 1.06,
    angularRadius: 0
  });
});

test("narrow viewports move the camera back to contain the sphere", () => {
  const desktop = cameraDistanceForSphere(42, 1.4);
  const mobile = cameraDistanceForSphere(42, 0.8);
  assert.ok(mobile > desktop);
});

test("longitude normalization is deterministic", () => {
  assert.equal(normalizeLongitude(190), -170);
  assert.equal(normalizeLongitude(-190), 170);
});

test("Three.js sphere UVs are aligned to standard equirectangular longitude", () => {
  assert.equal(THREE_SPHERE_TEXTURE_OFFSET, 0.25);
});

test("place labels do not repeat country-wide locator names", () => {
  assert.equal(formatResourcePlace({ city: "United States", country: "United States" }), "United States");
  assert.equal(formatResourcePlace({ city: "London", country: "United Kingdom" }), "London, United Kingdom");
});

test("coverage locators never display a fabricated nearby distance", () => {
  const user = { lat: 42.36, lng: -71.06 };
  const locator = { kind: "locator", locationPrecision: "coverage", lat: 42.36, lng: -71.06 };
  const exact = { kind: "direct", locationPrecision: "exact", lat: 42.37, lng: -71.06 };
  assert.equal(resourceDistanceKm(user, locator), null);
  assert.ok(resourceDistanceKm(user, exact) > 0);
  assert.equal(isExactServiceSite(locator), false);
  assert.equal(isExactServiceSite(exact), true);
});

test("location ranking separates nearby sites, same-country locators, and distant sites", () => {
  const resourcesToRank = [
    { id: "far", name: "Far site", kind: "direct", locationPrecision: "exact", country: "United States", lat: 34.05, lng: -118.24 },
    { id: "global", name: "Global locator", kind: "locator", locationPrecision: "coverage", country: "Global", lat: 0, lng: 0 },
    { id: "national", name: "National locator", kind: "locator", locationPrecision: "coverage", country: "United States", lat: 38.9, lng: -77.03 },
    { id: "near", name: "Nearby site", kind: "direct", locationPrecision: "exact", country: "United States", lat: 42.36, lng: -71.06 }
  ];
  assert.deepEqual(
    rankResourcesForLocation(resourcesToRank, { lat: 42.35, lng: -71.06 }, "United States").map((resource) => resource.id),
    ["near", "national", "far", "global"]
  );
});

test("search tolerates diacritics and common help-language synonyms", () => {
  const hygiene = {
    name: "Centro Bogotá", city: "Bogotá", country: "Colombia", region: "South America", address: "", sourceName: "Provider",
    category: "hygiene", secondaryCategories: [], summary: "Personal care", services: ["Laundry"], accessType: "Walk-in", costNote: "Free"
  };
  assert.ok(resourceSearchScore(hygiene, "Bogota") >= 0);
  assert.ok(resourceSearchScore(hygiene, "showers") >= 0);
  assert.equal(resourceSearchScore(hygiene, "veterinary"), -1);
});

test("expanded catalog preserves location precision and minimum coverage", () => {
  const reviewedExpansion = resources.filter((resource) => resource.lastChecked === "2026-08-05" && !resource.datasetId);
  assert.equal(resources.length, 601);
  assert.ok(resources.filter(isExactServiceSite).length >= 451);
  assert.ok(new Set(resources.map((resource) => resource.country)).size >= 109);
  assert.equal(reviewedExpansion.length, 114);
  assert.ok(reviewedExpansion.every((resource) => resource.locationPrecision === (resource.kind === "direct" ? "exact" : "coverage")));
  assert.ok(reviewedExpansion.every((resource) => resource.sourceUrl.startsWith("https://")));
  assert.equal(resources.filter((resource) => resource.datasetId === "massachusetts-wic-locations").length, 101);
  assert.equal(resources.filter((resource) => resource.datasetId === "new-york-wic-sites").length, 293);
  assert.ok(resources.filter((resource) => resource.datasetId === "massachusetts-wic-locations").every((resource) => resource.hours));
});

test("progressive close-view geometry materially increases boundary detail", async () => {
  const standard = JSON.parse(await readFile("public/data/countries.geojson", "utf8"));
  const detailed = JSON.parse(await readFile("public/data/countries-detail.geojson", "utf8"));
  const countPoints = (value) => Array.isArray(value)
    ? value.length && typeof value[0] === "number" ? 1 : value.reduce((sum, item) => sum + countPoints(item), 0)
    : 0;
  const standardPoints = standard.features.reduce((sum, feature) => sum + countPoints(feature.geometry.coordinates), 0);
  const detailedPoints = detailed.features.reduce((sum, feature) => sum + countPoints(feature.geometry.coordinates), 0);
  assert.ok(detailedPoints > standardPoints * 2.5);
  assert.ok(detailed.features.length >= standard.features.length);
});

test("close desktop views have a progressive high-resolution NASA surface", async () => {
  const image = await stat("public/media/earth-blue-marble-detail.jpg");
  const application = await readFile("src/app.js", "utf8");
  assert.ok(image.size > 4_000_000);
  assert.match(application, /earth-blue-marble-detail\.jpg/);
  assert.match(application, /maxTextureSize/);
  assert.match(application, /navigator\.connection\?\.saveData/);
});
