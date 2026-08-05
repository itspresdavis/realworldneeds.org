import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import {
  cameraDistanceForSphere,
  featureGlobeView,
  formatResourcePlace,
  normalizeLongitude,
  THREE_SPHERE_TEXTURE_OFFSET
} from "../src/utils/geo.js";

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
