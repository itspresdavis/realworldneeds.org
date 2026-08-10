import test from "node:test";
import assert from "node:assert/strict";

import { createInitialTypeSet, distanceKm, matchesResource } from "../src/utils/geo.js";
import { resources } from "../src/data/resources.js";

const allTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];

test("search does not return unrelated listings", () => {
  const matches = resources.filter((resource) =>
    matchesResource(resource, "a-city-that-does-not-exist", createInitialTypeSet())
  );
  assert.equal(matches.length, 0);
});

test("category filters include secondary service layers", () => {
  const clothing = new Set(["clothing"]);
  assert.equal(matchesResource(resources[0], "", clothing), true);
  assert.equal(matchesResource(resources.find((resource) => resource.category === "clothing"), "", clothing), true);
});

test("clearing every aid layer returns no listings", () => {
  assert.equal(matchesResource(resources[0], "", new Set()), false);
});

test("distance calculation is stable", () => {
  assert.equal(Math.round(distanceKm(40.7128, -74.006, 34.0522, -118.2437)), 3936);
});

test("natural near-me phrasing does not over-constrain service search", () => {
  const food = resources.find((resource) => allTypes(resource).includes("food"));
  const shelter = resources.find((resource) => allTypes(resource).includes("shelter"));
  assert.ok(food && shelter);
  assert.equal(matchesResource(food, "free food near me", createInitialTypeSet()), true);
  assert.equal(matchesResource(shelter, "please find shelter nearby", createInitialTypeSet()), true);
});

test("common multilingual need words map to reviewed service categories", () => {
  const food = resources.find((resource) => allTypes(resource).includes("food"));
  const hygiene = resources.find((resource) => allTypes(resource).includes("hygiene"));
  const health = resources.find((resource) => allTypes(resource).includes("health"));
  const clothing = resources.find((resource) => allTypes(resource).includes("clothing"));
  assert.ok(food && hygiene && health && clothing);
  assert.equal(matchesResource(food, "comida", createInitialTypeSet()), true);
  assert.equal(matchesResource(hygiene, "duchas", createInitialTypeSet()), true);
  assert.equal(matchesResource(health, "santé", createInitialTypeSet()), true);
  assert.equal(matchesResource(clothing, "vêtements", createInitialTypeSet()), true);
});
