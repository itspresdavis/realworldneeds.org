import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resources } from "../src/data/resources.js";
import {
  COUNTRY_NAME_ALIASES,
  cameraDistanceForSphere,
  featureGlobeView,
  resourceSearchScore
} from "../src/utils/geo.js";

test("every catalog country resolves to a Natural Earth feature", async () => {
  const geometry = JSON.parse(await readFile(new URL("../public/data/countries.geojson", import.meta.url), "utf8"));
  const featureNames = new Set(geometry.features.map((feature) => feature.properties?.NAME));
  const countries = new Set(resources.map((resource) => resource.country).filter((country) => country !== "Global"));
  const unresolved = [...countries].filter((country) => !featureNames.has(COUNTRY_NAME_ALIASES[country] || country));
  assert.deepEqual(unresolved, []);
});

test("country framing gives smaller countries a meaningfully closer view", () => {
  const small = featureGlobeView({ geometry: { type: "Polygon", coordinates: [[[4, 50], [6, 50], [6, 52], [4, 52], [4, 50]]] } });
  const large = featureGlobeView({ geometry: { type: "Polygon", coordinates: [[[-125, 25], [-66, 25], [-66, 49], [-125, 49], [-125, 25]]] } });
  assert.ok(small.zoom > large.zoom * 2);
  assert.ok(small.zoom <= 4.8);
  assert.ok(large.zoom >= 0.9);
});

test("country framing remains stable across the antimeridian", () => {
  const view = featureGlobeView({ geometry: { type: "Polygon", coordinates: [[[178, -20], [-178, -20], [-178, -16], [178, -16], [178, -20]]] } });
  assert.ok(Math.abs(Math.abs(view.lng) - 180) < 1);
  assert.ok(view.zoom > 2);
});

test("an exact city match outranks an organization name match", () => {
  const city = { name: "Community Pantry", city: "Boston", country: "United States", region: "North America", address: "", sourceName: "Source", summary: "Food", services: ["Food"], accessType: "Walk in", costNote: "Free", category: "food", secondaryCategories: [] };
  const organization = { ...city, name: "Boston Foodbank", city: "Lincolnshire", country: "United Kingdom" };
  assert.ok(resourceSearchScore(city, "Boston") > resourceSearchScore(organization, "Boston"));
});

test("camera fit moves farther away on narrow viewports", () => {
  const wide = cameraDistanceForSphere(42, 1.8);
  const narrow = cameraDistanceForSphere(42, 0.55);
  assert.ok(narrow > wide);
});
