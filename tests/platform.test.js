import test from "node:test";
import assert from "node:assert/strict";

import {
  allocationFields,
  launchGates,
  ledgerColumns,
  platformStatus,
  publicLedger,
  supportStages
} from "../src/data/platform.js";

test("money movement stays disabled until real controls exist", () => {
  assert.equal(platformStatus.donationProcessingEnabled, false);
  assert.equal(platformStatus.managedFundsPublished, 0);
  assert.deepEqual(publicLedger, []);
});

test("the public operating chain is complete", () => {
  assert.deepEqual(
    supportStages.map((stage) => stage.id),
    ["intake", "verify", "allocate", "deliver", "prove"]
  );
  assert.equal(allocationFields.length, 4);
  assert.equal(launchGates.length, 4);
});

test("ledger contract includes reviewable money and evidence fields", () => {
  assert.deepEqual(ledgerColumns, [
    "Need",
    "Responsible organization",
    "Verified",
    "Committed",
    "Disbursed",
    "Delivery evidence",
    "Last reviewed"
  ]);
});

