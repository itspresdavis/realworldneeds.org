import test from "node:test";
import assert from "node:assert/strict";
import { trussellFoodbankMetadata, trussellFoodbankResources } from "../src/data/generated/trussell-foodbanks.js";

test("Trussell snapshot stays materially complete", () => {
  assert.ok(trussellFoodbankMetadata.reportedSourceRecords >= 1300);
  assert.ok(trussellFoodbankMetadata.parsedSourceRecords >= Math.floor(trussellFoodbankMetadata.reportedSourceRecords * 0.97));
  assert.ok(trussellFoodbankMetadata.publishedRecords >= 1250);
  assert.equal(trussellFoodbankMetadata.publishedRecords, trussellFoodbankResources.length);
});

test("every local Trussell snapshot centre is an exact, source-backed free-with-referral location", () => {
  const ids = new Set();
  for (const resource of trussellFoodbankResources) {
    assert.match(resource.id, /^trussell-[0-9a-f-]{36}$/i);
    assert.equal(ids.has(resource.id), false, `duplicate ${resource.id}`);
    ids.add(resource.id);
    assert.equal(resource.kind, "direct");
    assert.equal(resource.locationPrecision, "exact");
    assert.equal(resource.costModel, "free-eligible");
    assert.equal(resource.datasetId, "trussell-food-bank-centres");
    assert.ok(resource.sourceRecordId);
    assert.ok(resource.address?.includes("United Kingdom"));
    assert.ok(Number.isFinite(resource.lat));
    assert.ok(Number.isFinite(resource.lng));
    assert.ok(resource.lat >= 49 && resource.lat <= 61.5);
    assert.ok(resource.lng >= -9.5 && resource.lng <= 2.7);
    assert.match(resource.sourceUrl, /^https:\/\/www\.trussell\.org\.uk\//);
    assert.match(resource.costNote, /free/i);
    assert.match(resource.eligibility, /voucher|referral/i);
  }
});

test("local Trussell snapshot never contains source-hidden address flags", () => {
  assert.equal(trussellFoodbankResources.some((resource) => Object.hasOwn(resource, "hideAddressLink")), false);
});
