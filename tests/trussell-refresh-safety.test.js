import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { makeResource } from "../scripts/refresh-trussell-foodbanks.mjs";
import { trussellFoodbankMetadata, trussellFoodbankResources } from "../src/data/generated/trussell-foodbanks.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { resources } from "../src/data/resources.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

const sourceHiddenIds = [
  "trussell-04bdd3ae-f240-469b-8210-1a31dcb89bce",
  "trussell-5c12be3b-8869-4fa7-9fd6-f14fb303a7fa"
];

async function importer() { return makeResource; }

const publicRecord = {
  uuid: "00000000-0000-4000-8000-000000000001",
  title: "Test foodbank", groupTitle: "Test network", town: "London",
  address01: "1 Fictional Street", address02: null, postcode: "SW1A 1AA",
  geoLocation: '{"type":"Point","coordinates":[-0.12,51.50]}',
  websiteReferralUrl: "https://example.org/foodbank", dcsStatusLabel: "Collection only"
};

test("Trussell address visibility recognizes source strings and fails closed on unknown flags", async () => {
  const make = await importer();
  for (const hideAddressLink of [true, "On", " on ", "true", "TRUE", "yes", 1, "1", "unexpected", {}]) {
    assert.equal(make({ ...publicRecord, hideAddressLink }, 1, "2026-10-10"), null, `must withhold ${String(hideAddressLink)}`);
  }
  for (const hideAddressLink of [undefined, null, false, "Off", " off ", "false", "no", 0, "0", ""]) {
    assert.ok(make({ ...publicRecord, hideAddressLink }, 1, "2026-10-10"), `should accept ${String(hideAddressLink)}`);
  }
});

test("town and postcode alone cannot become an exact public service location", async () => {
  const make = await importer();
  for (const address01 of [null, undefined, "", "   "]) {
    assert.equal(make({ ...publicRecord, address01, address02: null }, 1, "2026-10-10"), null);
  }
  assert.ok(make({ ...publicRecord, address01: null, address02: "Test community hall" }, 1, "2026-10-10"));
});

test("the local snapshot stays complete while the public registry publishes only the official locator", () => {
  assert.deepEqual(trussellFoodbankMetadata, {
    reportedSourceRecords: 1390, parsedSourceRecords: 1388, publishedRecords: 1373,
    totalPages: 139, checkedOn: "2026-10-10", excludedRecords: 15
  });
  assert.equal(trussellFoodbankResources.length, 1373);
  const source = sourceRegistry.find(source => source.id === "trussell-food-bank-centres");
  assert.equal(source.mode, "official-public-locator");
  assert.equal(source.recordCount, 1);
  assert.equal(source.sourceUrl, "https://www.trussell.org.uk/emergency-food/get-a-food-voucher/choose-a-foodbank");
  assert.equal(source.sourceReportedRecordsAtAudit, undefined);
  assert.equal(resources.filter(resource => resource.datasetId === "trussell-food-bank-centres").length, 1);
  assert.equal(trussellFoodbankResources.filter(r => r.collectionStatus === "Closed").length, 41);
  assert.equal(trussellFoodbankResources.filter(r => r.collectionStatus === "Temporarily closed").length, 8);
});

test("withheld Trussell centre rows stay out of the public directory", async () => {
  const publicText = await Promise.all(["dist/data/resources.json", "dist/data/search-index.json", "dist/directory.csv"].map(path => readFile(path, "utf8")));
  for (const uuid of ["95195fcb-a875-4503-826c-c22af33ec1f6", "d338df19-a195-4568-93a3-ab81c14c83dc", "3cbd1412-0af4-4865-8470-21e20025a345"]) {
    const row = trussellFoodbankResources.find(r => r.sourceRecordId === uuid);
    assert.equal(row.collectionStatus, "Collection only");
    assert.equal(row.collectionStatusCheckedOn, "2026-10-10");
    assert.equal(sourceClosureNotice(row), null);
    assert.equal(resources.some(resource => resource.id === row.id), false);
    for (const text of publicText) assert.equal(text.includes(uuid), false);
    await assert.rejects(access(`dist/service/${row.id}/index.html`));
  }
});

test("source-hidden UUIDs are absent from the local snapshot and are not deployed", async () => {
  const files = ["src/data/generated/trussell-foodbanks.js", "dist/data/resources.json", "dist/data/search-index.json", "dist/directory.csv"];
  await assert.rejects(access("dist/src/data/generated/trussell-foodbanks.js"));
  for (const id of sourceHiddenIds) {
    assert.equal(trussellFoodbankResources.some(r => r.id === id), false);
    for (const path of files) assert.equal((await readFile(path, "utf8")).includes(id.replace("trussell-", "")), false, path);
    await assert.rejects(access(`dist/service/${id}/index.html`));
  }
});
