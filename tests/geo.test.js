import test from "node:test";
import assert from "node:assert/strict";

import { createInitialTypeSet, distanceKm, matchesResource } from "../src/utils/geo.js";
import { resources } from "../src/data/resources.js";

test("search does not return unrelated listings", () => {
  const matches = resources.filter((resource) =>
    matchesResource(resource, "a-city-that-does-not-exist", createInitialTypeSet())
  );
  assert.equal(matches.length, 0);
});

test("category filters match the pin's primary color layer", () => {
  const clothing = new Set(["clothing"]);
  assert.equal(matchesResource(resources[0], "", clothing), false);
  assert.equal(matchesResource(resources.find((resource) => resource.category === "clothing"), "", clothing), true);
});

test("distance calculation is stable", () => {
  assert.equal(Math.round(distanceKm(40.7128, -74.006, 34.0522, -118.2437)), 3936);
});
