import { createHash } from "node:crypto";

export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

export function fingerprint(records) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...records].sort((a, b) => a.id.localeCompare(b.id)).map(canonical),
      ),
    )
    .digest("hex");
}

// Diagnose failed verification without printing records or changing either side.
export function summarizeCatalogDrift(local, database, limit = 10) {
  const index = (records) => new Map(records.map((record) => [record.id, record]));
  const localById = index(local);
  const databaseById = index(database);
  const bucket = () => ({ count: 0, sample: [] });
  const summary = { releaseOnly: bucket(), databaseOnly: bucket(), changed: bucket() };
  const add = (group, id) => {
    group.count++;
    // A database ID outside the public site's ID format is not safe log text.
    if (group.sample.length < limit && /^[a-z0-9][a-z0-9-]{0,159}$/.test(id)) {
      group.sample.push(id);
    }
  };
  for (const id of [...new Set([...localById.keys(), ...databaseById.keys()])].sort()) {
    if (!databaseById.has(id)) add(summary.releaseOnly, id);
    else if (!localById.has(id)) add(summary.databaseOnly, id);
    else if (JSON.stringify(canonical(localById.get(id))) !== JSON.stringify(canonical(databaseById.get(id)))) {
      add(summary.changed, id);
    }
  }
  return summary;
}

// A short REST page can be a server-side row cap, not the end of the catalog.
// Require exact ranges/counts and advance by rows actually returned. Never turn
// an incomplete response into mass withholding during a public export.
async function readCompleteCatalog({
  url,
  key,
  fetchImpl,
  pageSize,
  maxRecords,
}) {
  const rows = [];
  const ids = new Set();
  let total;
  for (let offset = 0; ;) {
    const endpoint = new URL("/rest/v1/rwn_locations", url);
    endpoint.search = new URLSearchParams({
      select: "id,record,updated_at",
      published: "eq.true",
      order: "id",
      offset: String(offset),
      limit: String(pageSize),
    });
    const response = await fetchImpl(endpoint, {
      headers: { apikey: key, Prefer: "count=exact" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`Catalog read failed: ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page))
      throw new Error("Catalog returned a malformed page.");
    const range = response.headers.get("content-range") || "";
    const match = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(range);
    if (!match)
      throw new Error(
        "Catalog completeness could not be verified: missing exact Content-Range.",
      );
    const count = Number(match[3]);
    if (!Number.isSafeInteger(count) || count > maxRecords)
      throw new Error(
        "Catalog size exceeds the reviewed synchronization limit.",
      );
    if (total !== undefined && count !== total)
      throw new Error(
        "Catalog changed during pagination; retry after editing is complete.",
      );
    total = count;
    if (!page.length) {
      if (total !== 0 || offset !== 0 || match[1] !== undefined)
        throw new Error("Catalog returned an incomplete empty page.");
      return rows;
    }
    if (
      Number(match[1]) !== offset ||
      Number(match[2]) !== offset + page.length - 1 ||
      offset + page.length > total
    ) {
      throw new Error(
        "Catalog returned a truncated or inconsistent page range.",
      );
    }
    for (const row of page) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        !row.record ||
        Array.isArray(row.record) ||
        typeof row.record !== "object" ||
        row.record.id !== row.id ||
        typeof row.updated_at !== "string" ||
        !Number.isFinite(Date.parse(row.updated_at))
      ) {
        throw new Error("Catalog returned a malformed record or revision.");
      }
      if (ids.has(row.id))
        throw new Error(
          "Catalog returned duplicate IDs; the snapshot may have changed.",
        );
      ids.add(row.id);
      rows.push(row);
    }
    offset += page.length;
    if (offset === total) return rows;
  }
}

export async function fetchPublishedCatalog({
  url,
  key,
  fetchImpl = fetch,
  pageSize = 500,
  maxRecords = 100000,
}) {
  const options = { url, key, fetchImpl, pageSize, maxRecords };
  const first = await readCompleteCatalog(options);
  const second = await readCompleteCatalog(options);
  if (fingerprint(first) !== fingerprint(second)) {
    throw new Error(
      "Catalog changed between complete reads; retry after editing is complete.",
    );
  }
  return second.map((row) => row.record);
}

// Source refreshes can be ahead of the editorial DB. Importing those older DB
// rows as overrides would undo the refresh and can resurrect withheld listings.
export function assertFreshExport(records, curatedResources) {
  const local = new Map(curatedResources.map((record) => [record.id, record]));
  const datasetDates = new Map();
  for (const record of curatedResources) {
    if (
      record.datasetId &&
      record.lastChecked > (datasetDates.get(record.datasetId) || "")
    ) {
      datasetDates.set(record.datasetId, record.lastChecked);
    }
  }
  const stale = records.filter((record) => {
    const source = local.get(record.id);
    const reviewed =
      source?.lastChecked ||
      (record.datasetId && datasetDates.get(record.datasetId));
    return reviewed && (!record.lastChecked || record.lastChecked < reviewed);
  });
  if (stale.length) {
    throw new Error(
      `Refusing to export ${stale.length} database records older than the reviewed source catalog. Reconcile source changes into the database first; exporting now would rewind the public release.`,
    );
  }
}
