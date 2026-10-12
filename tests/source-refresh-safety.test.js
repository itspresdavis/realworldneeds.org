import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { preserveReviewedFields, replaceSourceSnapshot, assertReviewedMembership } from "../scripts/source-refresh-safety.mjs";

const previous = { id: "id", sourceRecordId: "source", summary: "Reviewed", secondaryCategories: ["health", "referral"], sourceUpdatedAt: "2026-04-30", lastChecked: "2026-05-01", phone: "123", customEvidence: { checked: true } };

test("only explicit source fields change; editorial and unknown provenance fields survive", () => {
  const candidate = { id: "id", sourceRecordId: "source", summary: "Template", secondaryCategories: ["referral"], sourceUpdatedAt: "2026-04-30", lastChecked: "2026-10-12" };
  const result = preserveReviewedFields(candidate, previous, ["phone", "sourceUpdatedAt", "lastChecked"]);
  assert.equal(result.summary, previous.summary);
  assert.deepEqual(result.secondaryCategories, previous.secondaryCategories);
  assert.deepEqual(result.customEvidence, previous.customEvidence);
  assert.equal(Object.hasOwn(result, "phone"), false);
  assert.equal(result.sourceUpdatedAt, "2026-04-30");
  assert.equal(result.lastChecked, "2026-10-12");
});

test("identity mismatches and regressing publisher dates require reconciliation", () => {
  assert.throws(() => preserveReviewedFields({ ...previous, sourceRecordId: "other" }, previous, []), /identity changed/);
  assert.throws(() => preserveReviewedFields({ ...previous, sourceUpdatedAt: "2026-04-29" }, previous, ["sourceUpdatedAt"]), /Publisher date regressed/);
  assert.throws(() => preserveReviewedFields({ ...previous, sourceUpdatedAt: undefined }, previous, ["sourceUpdatedAt"]), /refusing to erase provenance/);
});

test("snapshot replacement preserves byte-for-byte before state on a stale write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rwn-refresh-"));
  const path = pathToFileURL(join(directory, "snapshot.js"));
  try {
    await writeFile(path, "original\n");
    const before = await readFile(path);
    await writeFile(path, "concurrent editorial change\n");
    await assert.rejects(replaceSourceSnapshot(path, before, "replacement\n"), /changed during collection/);
    assert.equal(await readFile(path, "utf8"), "concurrent editorial change\n");
    assert.deepEqual(await readdir(directory), ["snapshot.js"]);
    await replaceSourceSnapshot(path, await readFile(path), "reviewed replacement\n");
    assert.equal(await readFile(path, "utf8"), "reviewed replacement\n");
    assert.deepEqual(await readdir(directory), ["snapshot.js"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a competing refresh lock is respected and never removed by the refused writer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rwn-refresh-"));
  const path = pathToFileURL(join(directory, "snapshot.js"));
  const lock = pathToFileURL(join(directory, ".snapshot.js.refresh.lock"));
  try {
    await writeFile(path, "original\n");
    await writeFile(lock, "other refresh\n");
    await assert.rejects(replaceSourceSnapshot(path, await readFile(path), "replacement\n"), { code: "EEXIST" });
    assert.equal(await readFile(path, "utf8"), "original\n");
    assert.equal(await readFile(lock, "utf8"), "other refresh\n");
    assert.deepEqual((await readdir(directory)).sort(), [".snapshot.js.refresh.lock", "snapshot.js"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("changed service type is rejected even when a generic availability note happens to match", () => {
  const old = { ...previous, accessType: "Temporary WIC service site; call before visiting", availabilityNote: "Call first" };
  const candidate = { ...old, accessType: "Permanent WIC service site; call to apply or schedule", lastChecked: "2026-10-12" };
  assert.throws(() => preserveReviewedFields(candidate, old, ["lastChecked"]), /Changed accessType/);
});

test("an explicitly reviewed empty snapshot cannot bootstrap publication", () => {
  assert.throws(() => assertReviewedMembership([previous], []), /Publication membership changed/);
  assert.doesNotThrow(() => assertReviewedMembership([previous], undefined));
  assert.doesNotThrow(() => assertReviewedMembership([], []));
});
