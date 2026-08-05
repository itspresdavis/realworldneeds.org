import test from "node:test";
import assert from "node:assert/strict";

import { resources } from "../src/data/resources.js";
import { freeAccessModels } from "../src/data/free-access.js";

test("every published resource has an explicit, supported free-access model", () => {
  assert.ok(resources.length > 500);
  for (const resource of resources) {
    assert.ok(freeAccessModels[resource.costModel], resource.id);
    assert.match(resource.costNote, /\bfree\b|\bno[- ]cost\b|\bwithout (?:a )?fee\b|\bwithout paying\b|including nothing/i, resource.id);
    if (resource.kind === "direct") assert.notEqual(resource.costModel, "free-navigation", resource.id);
  }
});

test("aid categories are unique and WIC records do not claim medical care", () => {
  for (const resource of resources) {
    const secondary = resource.secondaryCategories || [];
    assert.equal(new Set(secondary).size, secondary.length, resource.id);
    assert.ok(!secondary.includes(resource.category), resource.id);
  }
  const wic = resources.filter((resource) => /wic-(locations|sites)$/.test(resource.datasetId || ""));
  assert.equal(wic.length, 394);
  assert.ok(wic.every((resource) => resource.category === "food"));
  assert.ok(wic.every((resource) => !resource.secondaryCategories.includes("health")));
  assert.ok(wic.every((resource) => resource.secondaryCategories.includes("referral")));
});

test("records with unverified or paid access are withheld from publication", () => {
  const ids = new Set(resources.map((resource) => resource.id));
  for (const id of [
    "hrsa-health-center-finder",
    "boston-health-homeless",
    "uturn-wynberg",
    "goonj",
    "banco-bogota"
  ]) assert.ok(!ids.has(id), id);
});
