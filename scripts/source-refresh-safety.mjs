import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";

// Source refreshes are not an editorial replacement or a database import. Only
// explicitly source-owned facts may change; all other reviewed fields survive.
export function preserveReviewedFields(candidate, previous, sourceFields) {
  if (!previous) return candidate;
  if (previous.id !== candidate.id || previous.sourceRecordId !== candidate.sourceRecordId) {
    throw new Error("Source identity changed; manual reconciliation is required.");
  }
  if (sourceFields.includes("sourceUpdatedAt") && previous.sourceUpdatedAt && !candidate.sourceUpdatedAt) {
    throw new Error(`Publisher date missing for ${candidate.id}; refusing to erase provenance.`);
  }
  if (previous.sourceUpdatedAt && candidate.sourceUpdatedAt && candidate.sourceUpdatedAt < previous.sourceUpdatedAt) {
    throw new Error(`Publisher date regressed for ${candidate.id}; refusing to replace provenance.`);
  }
  // A changed service mode/status can invalidate curated instructions. Preserve
  // those instructions and require review instead of silently replacing them.
  if (previous.accessType !== candidate.accessType) {
    throw new Error(`Changed accessType for ${candidate.id} requires editorial reconciliation before refresh.`);
  }
  if (previous.collectionStatus !== candidate.collectionStatus && previous.availabilityNote !== candidate.availabilityNote) {
    throw new Error(`Changed collectionStatus for ${candidate.id} requires editorial reconciliation before refresh.`);
  }
  const result = { ...candidate, ...previous };
  for (const field of sourceFields) {
    if (Object.hasOwn(candidate, field)) result[field] = candidate[field];
    else delete result[field];
  }
  return result;
}

// A missing source result does not authorize withholding, and a newly visible
// source ID may already be an editorially withheld database record. Membership
// changes must be reconciled explicitly before replacing a published module.
export function assertReviewedMembership(resources, previousResources) {
  if (previousResources === undefined) return;
  const current = new Set(resources.map((record) => record.id));
  const previous = new Set(previousResources.map((record) => record.id));
  if (current.size !== resources.length || previous.size !== previousResources.length) {
    throw new Error("Duplicate IDs in the source or reviewed snapshot.");
  }
  if (current.size !== previous.size || [...current].some((id) => !previous.has(id))) {
    throw new Error("Publication membership changed; reconcile additions, restorations and withholding before refresh.");
  }
}

// Write only after collection, exclusion accounting and editorial checks have
// all succeeded. A failed write cannot leave a half-written generated module.
export async function replaceSourceSnapshot(outputPath, previousBytes, output) {
  if (!Buffer.isBuffer(previousBytes)) throw new Error("A reviewed before-snapshot is required.");
  const temporary = new URL(`./.${outputPath.pathname.split("/").at(-1)}.${randomUUID()}.tmp`, outputPath);
  const lock = new URL(`./.${outputPath.pathname.split("/").at(-1)}.refresh.lock`, outputPath);
  // Serialize cooperating refresh writers; never remove another writer's lock.
  await writeFile(lock, "refresh in progress\n", { flag: "wx" });
  try {
    await writeFile(temporary, output, { encoding: "utf8", flag: "wx" });
    if (!(await readFile(outputPath)).equals(previousBytes)) {
      throw new Error("Source snapshot changed during collection; refusing stale replacement.");
    }
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { force: true });
  }
}
