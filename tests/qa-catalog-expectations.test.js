import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resources } from "../src/data/resources.js";
import { resourceSearchScore } from "../src/utils/search.js";
import { directoryWicFixture, newYorkCatalogFixtures } from "../scripts/qa-catalog-expectations.mjs";

test("Saved Browse expectations follow the reviewed country scope after withholding", () => {
  const us = resources.filter(record => record.country === "United States");
  const fixture = directoryWicFixture(60);
  assert.equal(fixture.summary, `60 of 395 matches · ${us.length} listings`);
  assert.equal(fixture.count, "395 matching listings");
  assert.ok(!us.some(record => ["breakthrough-daytime-support", "father-joes-day-center"].includes(record.id)));
  const withoutOneUnrelated = resources.filter(record => record.id !== "bowery-mission");
  assert.equal(directoryWicFixture(60, "Food", withoutOneUnrelated).summary,
    `60 of 395 matches · ${us.length - 1} listings`);
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
  assert.equal(directoryWicFixture(60, "Food", [one, unrelated]).summary, "1 of 1 matches · 2 listings");
  assert.equal(directoryWicFixture(60, "Food", [one]).count, "1 matching listing");
  assert.equal(directoryWicFixture(60, "All help", []).count, "No matching listings");
});

test("local page expectations preserve known anchors and exact source IDs after a reviewed withdrawal", () => {
  const original = newYorkCatalogFixtures();
  assert.ok(original.city.includes("bowery-mission"));
  assert.ok(original.referral.includes("new-york-public-library-access"));
  assert.ok(original.wic.length > 0);
  assert.ok(original.wic.every(id => original.city.includes(id) && original.referral.includes(id)));
  assert.deepEqual(original.foodReferral, [...original.wic,
    "nyc-youth-ali-forney-midtown", "nyc-youth-door-manhattan", "nyc-youth-streetwork-harlem"].sort());
  const removed = original.wic[0];
  const next = newYorkCatalogFixtures(resources.filter(record => record.id !== removed));
  for (const key of ["city", "referral", "foodReferral", "wic"]) assert.deepEqual(next[key], original[key].filter(id => id !== removed));
});


// Exercise the actual renderer against the independent catalog-derived fixture.
// The legacy browser gate compares this copy exactly; testing each in isolation
// previously let a wording change make correct private history appear broken.
test("browser catalog fixture agrees with actual rendered batch summaries", async () => {
  const source = await readFile(new URL("../public/directory.js", import.meta.url), "utf8");
  const start = source.indexOf("const renderNext=");
  const end = source.indexOf("listen(more,", start);
  assert.ok(start >= 0 && end > start, "execute the current renderer, not a duplicated template");
  for (const catalog of [resources, resources.filter(record => record.id !== "bowery-mission")]) {
    const scoped = catalog.filter(record => record.country === "United States");
    const activeMatches = scoped.filter(record => resourceSearchScore(record, "WIC") >= 0);
    for (const shown of [60, 120, activeMatches.length]) {
      const fixture = directoryWicFixture(shown, "All help", catalog);
      const appended = [];
      const context = vm.createContext({ activeMatches, visibleCount: 0, scopedCount: scoped.length,
        format: value => value.toLocaleString("en-US"), BATCH: 60, resultRow: record => record,
        resultList: { append: (...rows) => appended.push(...rows) }, more: {}, resultSummary: {} });
      vm.runInContext(`${source.slice(start, end)};renderNext(${shown});`, context);
      assert.equal(appended.length, fixture.rows);
      assert.equal(context.resultSummary.textContent, fixture.summary);
      assert.equal(context.more.hidden, shown === activeMatches.length);
    }
  }
});
