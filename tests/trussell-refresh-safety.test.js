import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import vm from "node:vm";
import { trussellFoodbankMetadata, trussellFoodbankResources } from "../src/data/generated/trussell-foodbanks.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

const sourceHiddenIds = [
  "trussell-04bdd3ae-f240-469b-8210-1a31dcb89bce",
  "trussell-5c12be3b-8869-4fa7-9fd6-f14fb303a7fa"
];

async function importer() {
  const text = await readFile("scripts/refresh-trussell-foodbanks.mjs", "utf8");
  const prefix = text.slice(text.indexOf("const FINDER_BASE"), text.indexOf("const checkedOn ="));
  const context = vm.createContext({ URL });
  vm.runInContext(prefix.replace("import.meta.url", '"file:///fixture/scripts/refresh-trussell-foodbanks.mjs"') + "\nglobalThis.make = makeResource;", context);
  return context.make;
}

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

test("the reviewed full snapshot and source ledger agree on completeness and date", () => {
  assert.deepEqual(trussellFoodbankMetadata, {
    reportedSourceRecords: 1390, parsedSourceRecords: 1388, publishedRecords: 1373,
    totalPages: 139, checkedOn: "2026-10-10", excludedRecords: 15
  });
  const source = sourceRegistry.find(source => source.id === "trussell-food-bank-centres");
  assert.equal(source.recordCount, trussellFoodbankResources.length);
  assert.equal(source.sourceReportedRecordsAtAudit, trussellFoodbankMetadata.reportedSourceRecords);
  assert.equal(source.sourceParsedRecordsAtAudit, trussellFoodbankMetadata.parsedSourceRecords);
  assert.equal(source.excludedForPublicationAtAudit, trussellFoodbankMetadata.excludedRecords);
  assert.equal(source.auditedAt, trussellFoodbankMetadata.checkedOn);
  assert.equal(trussellFoodbankResources.filter(r => r.collectionStatus === "Closed").length, 41);
  assert.equal(trussellFoodbankResources.filter(r => r.collectionStatus === "Temporarily closed").length, 8);
});

test("reviewed source corrections do not retain superseded closure warnings or claim open now", async () => {
  for (const uuid of ["95195fcb-a875-4503-826c-c22af33ec1f6", "d338df19-a195-4568-93a3-ab81c14c83dc", "3cbd1412-0af4-4865-8470-21e20025a345"]) {
    const row = trussellFoodbankResources.find(r => r.sourceRecordId === uuid);
    assert.equal(row.collectionStatus, "Collection only");
    assert.equal(row.collectionStatusCheckedOn, "2026-10-10");
    assert.equal(sourceClosureNotice(row), null);
    assert.match(row.availabilityNote, /Check the provider page or call before travel/);
    const html = await readFile(`dist/service/${row.id}/index.html`, "utf8");
    assert.doesNotMatch(html, /Source reported: (?:Temporarily closed|Closed)|open now|verified open/i);
  }
});

test("source-hidden UUIDs are absent from records, exports, runtime data and generated service pages", async () => {
  const files = ["src/data/generated/trussell-foodbanks.js", "dist/src/data/generated/trussell-foodbanks.js", "dist/data/resources.json", "dist/data/search-index.json", "dist/directory.csv"];
  for (const id of sourceHiddenIds) {
    assert.equal(trussellFoodbankResources.some(r => r.id === id), false);
    for (const path of files) assert.equal((await readFile(path, "utf8")).includes(id.replace("trussell-", "")), false, path);
    await assert.rejects(access(`dist/service/${id}/index.html`));
  }
});
