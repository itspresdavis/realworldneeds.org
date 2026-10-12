import test from "node:test";
import assert from "node:assert/strict";
import { resources } from "../src/data/resources.js";
import { resourceSearchScore } from "../src/utils/search.js";
import { directoryWicFixture, newYorkCatalogFixtures } from "../scripts/qa-catalog-expectations.mjs";

test("Saved Browse expectations follow the reviewed country scope after withholding", () => {
  const us = resources.filter(record => record.country === "United States");
  const fixture = directoryWicFixture(60);
  assert.equal(fixture.summary, `Showing 60 of 395 matches across ${us.length} listings`);
  assert.equal(fixture.count, "395 matching listings");
  assert.ok(!us.some(record => ["breakthrough-daytime-support", "father-joes-day-center"].includes(record.id)));
  const withoutOneUnrelated = resources.filter(record => record.id !== "bowery-mission");
  assert.equal(directoryWicFixture(60, "Food", withoutOneUnrelated).summary,
    `Showing 60 of 395 matches across ${us.length - 1} listings`);
});

test("WIC fixture membership remains exactly the reviewed WIC datasets plus the national programme", () => {
  const sourceIds = resources.filter(record => ["massachusetts-wic-locations", "new-york-wic-sites"].includes(record.datasetId)
    || record.id === "special-supplemental-nutrition-program-for-women-infants-and-children").map(record => record.id).sort();
  const searchIds = resources.filter(record => record.country === "United States" && resourceSearchScore(record, "WIC") >= 0).map(record => record.id).sort();
  assert.deepEqual(searchIds, sourceIds);
  assert.equal(sourceIds.length, 395);
});

test("fixture count and pluralization adapt to a changed source membership without reading the UI", () => {
  const one = resources.find(record => record.datasetId === "new-york-wic-sites");
  const unrelated = resources.find(record => record.id === "bowery-mission");
  assert.equal(directoryWicFixture(60, "Food", [one, unrelated]).summary, "Showing 1 of 1 matches across 2 listings");
  assert.equal(directoryWicFixture(60, "Food", [one]).count, "1 matching listing");
  assert.equal(directoryWicFixture(60, "All help", []).count, "No matching listings");
});

test("local page expectations preserve known anchors and exact source IDs after a reviewed withdrawal", () => {
  const original = newYorkCatalogFixtures();
  assert.ok(original.city.includes("bowery-mission"));
  assert.ok(original.referral.includes("new-york-public-library-access"));
  assert.ok(original.wic.length > 0);
  assert.ok(original.wic.every(id => original.city.includes(id) && original.referral.includes(id)));
  const removed = original.wic[0];
  const next = newYorkCatalogFixtures(resources.filter(record => record.id !== removed));
  for (const key of ["city", "referral", "wic"]) assert.deepEqual(next[key], original[key].filter(id => id !== removed));
});
