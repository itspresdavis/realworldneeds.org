import test from "node:test";
import assert from "node:assert/strict";

import {
  cameraDistanceForSphere,
  featureGlobeView,
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
