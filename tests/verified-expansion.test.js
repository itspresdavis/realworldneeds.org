import test from "node:test";
import assert from "node:assert/strict";
import { REJECTED_CANDIDATES, verifiedExpansionResources } from "../src/data/verified-expansion.js";
import { resources } from "../src/data/resources.js";

test("every verified expansion record carries the quoted no-cost evidence", () => {
  assert.ok(verifiedExpansionResources.length >= 30, "expansion should be substantial");
  for (const record of verifiedExpansionResources) {
    assert.ok(record.verifiedQuote, `${record.id} is missing the quoted proof of free access`);
    assert.ok(record.verifiedQuote.length > 12, `${record.id} quote is too short to be evidence`);
    assert.match(record.sourceUrl, /^https:\/\//, `${record.id} must cite an HTTPS source`);
    assert.ok(record.services.length >= 2, `${record.id} must describe what a person receives`);
    assert.match(record.costNote, /\bfree\b|\bno[- ]cost\b/i, `${record.id} must state no-cost access`);
    assert.doesNotMatch(record.costNote, /\blow[- ]cost\b|\bsliding fee\b/i, `${record.id} must not describe paid access`);
    assert.equal(typeof record.openAccess, "boolean", `${record.id} must record whether access is open to all`);
  }
});

test("rejected research candidates stay documented instead of silently dropped", () => {
  assert.ok(REJECTED_CANDIDATES.length > 0, "the audit trail of omissions must survive");
  for (const entry of REJECTED_CANDIDATES) {
    assert.ok(entry.candidate, "each rejection needs the candidate name");
    assert.ok(entry.reason && entry.reason.length > 15, `${entry.candidate} needs a substantive reason`);
  }
  const rejectedNames = new Set(REJECTED_CANDIDATES.map((entry) => entry.candidate));
  for (const record of verifiedExpansionResources) {
    assert.ok(!rejectedNames.has(record.name), `${record.name} was rejected and must not be published`);
  }
});

test("the catalog serves the core needs, not only food", () => {
  const counts = {};
  for (const resource of resources) counts[resource.category] = (counts[resource.category] || 0) + 1;
  // Bulk food-bank and country-directory rows are withheld. The other core needs
  // must still be genuinely represented rather than token entries.
  for (const category of ["water", "shelter", "clothing", "hygiene"]) {
    assert.ok(counts[category] >= 6, `${category} has only ${counts[category] || 0} records`);
  }
  assert.ok(counts.referral >= 26, "resource finders must stay represented");
});
