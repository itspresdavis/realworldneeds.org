import test from "node:test";
import assert from "node:assert/strict";
import {
  NEW_YORK_WIC_MAX_ROWS,
  NEW_YORK_WIC_PAGE_SIZE,
  classifyNewYorkWicRow,
  fetchNewYorkWicSnapshot,
  makeNewYorkWicResource,
  refreshNewYorkWic,
} from "../scripts/refresh-new-york-wic.mjs";

const updatedAt = 1777563486; // 2026-04-30T15:38:06Z, independent of retrieval.
const dates = { checkedOn: "2026-10-12", sourceUpdatedAt: "2026-04-30" };
const row = (id, extra = {}) => ({
  site_number: String(id).padStart(5, "0"),
  site_type: "Permanent",
  agency_name: "Fixture WIC",
  city: "Albany",
  state: "NY",
  zip: "12207",
  street_address: "1 Main Street",
  location_1: { latitude: "42.65", longitude: "-73.75" },
  ...extra,
});
const rows = (n) => Array.from({ length: n }, (_, index) => row(index + 1));
const json = (value) => new Response(JSON.stringify(value));

function feed(data, override = () => undefined) {
  const calls = [];
  let metadataCalls = 0;
  let countCalls = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    const kind = url.pathname.includes("/api/views/") ? "metadata" : url.searchParams.has("$select") ? "count" : "page";
    const offset = Number(url.searchParams.get("$offset"));
    const occurrence = kind === "metadata" ? ++metadataCalls : kind === "count" ? ++countCalls : undefined;
    const request = { kind, offset, occurrence, url, options, index: calls.length };
    calls.push(request);
    const replacement = await override(request);
    if (replacement !== undefined) return replacement;
    if (kind === "metadata") return json({ rowsUpdatedAt: updatedAt });
    if (kind === "count") return json([{ count: String(data.length) }]);
    return json(data.slice(offset, offset + NEW_YORK_WIC_PAGE_SIZE));
  };
  return { fetchImpl, calls };
}

async function refresh(data, override) {
  const source = feed(data, override);
  const writes = [];
  const result = await refreshNewYorkWic({
    fetchImpl: source.fetchImpl,
    checkedOn: dates.checkedOn,
    minimumRecords: 1,
    writeOutput: async (output) => { writes.push(output); },
  });
  return { ...result, writes, calls: source.calls };
}

async function rejectsWithoutWriting(data, override, expected = /New York WIC/) {
  const source = feed(data, override);
  const existingOutput = "existing reviewed catalog bytes\n";
  let output = existingOutput;
  let writes = 0;
  await assert.rejects(refreshNewYorkWic({
    fetchImpl: source.fetchImpl,
    checkedOn: dates.checkedOn,
    minimumRecords: 1,
    writeOutput: async (next) => { writes += 1; output = next; },
  }), expected);
  assert.equal(writes, 0);
  assert.equal(output, existingOutput);
  return source.calls;
}

test("501 rows are fully consumed with fixed-size ordered pages and an explicit empty overflow", async () => {
  const result = await refresh(rows(501));
  assert.equal(result.records.length, 501);
  assert.equal(result.audit.expectedRows, 501);
  assert.equal(result.audit.uniqueRawIds, 501);
  assert.equal(result.audit.pagesFetched, 2);
  assert.equal(result.audit.overflowRows, 0);
  assert.equal(result.writes.length, 1);
  assert.deepEqual(result.calls.map((call) => call.kind), ["metadata", "count", "page", "page", "page", "count", "metadata"]);
  const pages = result.calls.filter((call) => call.kind === "page");
  assert.deepEqual(pages.map((call) => call.offset), [0, 500, 501]);
  for (const { url, options } of pages) {
    assert.equal(url.searchParams.get("$limit"), "500");
    assert.equal(url.searchParams.get("$order"), "site_number");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("exactly 500 and multi-page feeds still require the empty overflow and ending version checks", async () => {
  for (const length of [500, 1000, 1001]) {
    const source = feed(rows(length));
    const snapshot = await fetchNewYorkWicSnapshot(source);
    assert.equal(snapshot.rows.length, length);
    assert.equal(source.calls.filter((call) => call.kind === "page").at(-1).offset, length);
    assert.deepEqual(source.calls.slice(-2).map((call) => call.kind), ["count", "metadata"]);
  }
});

test("short or oversized pages fail closed before later requests", async () => {
  for (const pageSize of [0, 499, 501]) {
    const calls = await rejectsWithoutWriting(rows(501), ({ kind, offset }) => kind === "page" && offset === 0 ? json(rows(pageSize)) : undefined, /incomplete page/);
    assert.equal(calls.length, 3);
  }
  const calls = await rejectsWithoutWriting(rows(501), ({ kind, offset }) => kind === "page" && offset === 500 ? json([]) : undefined, /incomplete page/);
  assert.equal(calls.length, 4);
});

test("overflow or changing count never replaces an existing catalog", async () => {
  await rejectsWithoutWriting(rows(500), ({ kind, offset }) => kind === "page" && offset === 500 ? json([row(501)]) : undefined, /overflow page was not empty/);
  await rejectsWithoutWriting(rows(501), ({ kind, occurrence }) => kind === "count" && occurrence === 2 ? json([{ count: "502" }]) : undefined, /changed during collection/);
});

test("metadata changes within the same source calendar day still invalidate the snapshot", async () => {
  await rejectsWithoutWriting(rows(2), ({ kind, occurrence }) => kind === "metadata" && occurrence === 2 ? json({ rowsUpdatedAt: updatedAt + 1 }) : undefined, /changed during collection/);
});

test("missing, malformed and unbounded counts fail before paging", async () => {
  for (const count of [undefined, null, "", " ", "1.5", "-1", "1e3", true, {}, [], String(NEW_YORK_WIC_MAX_ROWS + 1), Number.MAX_SAFE_INTEGER]) {
    const calls = await rejectsWithoutWriting(rows(1), ({ kind }) => kind === "count" ? json([{ count }]) : undefined, /count must be an exact/);
    assert.equal(calls.length, 2);
  }
  for (const countBody of [[], {}, [{ count: "1" }, { count: "1" }]]) {
    await rejectsWithoutWriting(rows(1), ({ kind }) => kind === "count" ? json(countBody) : undefined, /count must be an exact/);
  }
});

test("missing or malformed metadata fails without fetching source rows", async () => {
  for (const rowsUpdatedAt of [undefined, null, 0, -1, "1777563486", 1.5, Number.MAX_SAFE_INTEGER]) {
    const calls = await rejectsWithoutWriting(rows(1), ({ kind }) => kind === "metadata" ? json({ rowsUpdatedAt }) : undefined, /valid rowsUpdatedAt/);
    assert.equal(calls.length, 1);
  }
});

test("HTTP, network and malformed JSON failures stop immediately at every request stage", async () => {
  // One row: metadata, count, page, overflow, ending count, ending metadata.
  for (let failAt = 0; failAt < 6; failAt += 1) {
    for (const failure of [() => new Response("Unavailable", { status: 503 }), () => { throw new Error("fixture network failure"); }, () => new Response("{malformed-json")]) {
      const calls = await rejectsWithoutWriting(rows(1), ({ index }) => index === failAt ? failure() : undefined, /503|fixture network failure|JSON|property name/);
      assert.equal(calls.length, failAt + 1, "no retry or later request after failure");
    }
  }
  await rejectsWithoutWriting(rows(1), ({ kind }) => kind === "page" ? json({ rows: [] }) : undefined, /not an array/);
});

test("an empty source is explicitly reconciled but cannot replace the public snapshot", async () => {
  const source = feed([]);
  const snapshot = await fetchNewYorkWicSnapshot(source);
  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.audit.uniqueRawIds, 0);
  assert.deepEqual(source.calls.map((call) => call.kind), ["metadata", "count", "page", "count", "metadata"]);
  await rejectsWithoutWriting([], undefined, /refusing to publish/);
});

test("duplicates are detected among raw identities before coordinate or site-type filtering", async () => {
  for (const excluded of [{ location_1: {} }, { site_type: "Administrative" }, { street_address: "" }]) {
    await rejectsWithoutWriting([row(1), row(1, excluded)], undefined, /duplicate source site_number/);
  }
  const data = rows(501);
  data[500] = row(1, { location_1: {} });
  await rejectsWithoutWriting(data, undefined, /duplicate source site_number/);
});

test("missing source IDs or resource-ID collisions refuse publication", async () => {
  for (const site_number of [null, undefined, "", " ", 1]) {
    await rejectsWithoutWriting([row(1, { site_number })], undefined, /valid source site_number/);
  }
  await rejectsWithoutWriting([row(1, { site_number: "A B" }), row(2, { site_number: "A-B" })], undefined, /unique IDs; refusing/);
});

test("out-of-order source IDs are rejected within pages and across page boundaries", async () => {
  await rejectsWithoutWriting([row(2), row(1)], undefined, /site_number order changed/);
  const data = rows(501);
  [data[499], data[500]] = [data[500], data[499]];
  await rejectsWithoutWriting(data, undefined, /site_number order changed/);
});

test("only Permanent and Temporary become direct services, retaining distinct access language", () => {
  const permanent = makeNewYorkWicResource(row(1), dates);
  const temporary = makeNewYorkWicResource(row(2, { site_type: "Temporary" }), dates);
  assert.equal(permanent.kind, "direct");
  assert.equal(temporary.kind, "direct");
  assert.match(permanent.accessType, /^Permanent WIC/);
  assert.match(temporary.accessType, /^Temporary WIC/);
  assert.match(temporary.availabilityNote, /Call before travel/);
  assert.doesNotMatch(temporary.availabilityNote, /closed/i);
  assert.equal(temporary.collectionStatus, undefined);
  assert.deepEqual(permanent.secondaryCategories, ["health", "referral"]);
  assert.equal(permanent.summary, "A New York WIC service site offering nutrition support and healthy foods to eligible pregnant, breastfeeding, or postpartum people, infants, and children under five.");
});

test("administrative and vendor-management rows are counted but explicitly excluded", async () => {
  const result = await refresh([row(1), row(2, { site_type: "Administrative" }), row(3, { site_type: "Vendor Management Agency" })]);
  assert.equal(result.records.length, 1);
  assert.equal(result.audit.expectedRows, 3);
  assert.equal(result.audit.uniqueRawIds, 3);
  assert.deepEqual(result.audit.exclusionCounts, { "administrative-site": 1, "vendor-management-agency": 1 });
  assert.deepEqual(result.audit.exclusions, [{ sourceRecordId: "00002", reason: "administrative-site" }, { sourceRecordId: "00003", reason: "vendor-management-agency" }]);
  assert.equal(makeNewYorkWicResource(row(4, { site_type: "Administrative" }), dates), null);
});

test("null, absent, misspelled and new site types fail closed even without coordinates", async () => {
  for (const site_type of [null, undefined, "", "Permanent ", "permanent", "Permenent", "Mobile", "Unknown"]) {
    assert.throws(() => classifyNewYorkWicRow(row(1, { site_type })), /unrecognized site_type/);
    await rejectsWithoutWriting([row(1), row(2, { site_type, location_1: {} })], undefined, /unrecognized site_type/);
  }
});

test("null and blank coordinates remain missing; invalid types are never numeric-coerced", () => {
  for (const field of ["latitude", "longitude"]) {
    for (const value of [null, undefined, "", "  "]) {
      const candidate = row(1);
      candidate.location_1[field] = value;
      assert.deepEqual(classifyNewYorkWicRow(candidate), { eligible: false, reason: "missing-coordinates" });
      assert.equal(makeNewYorkWicResource(candidate, dates), null);
    }
    for (const value of [false, true, [], {}, "NaN", "Infinity", "0x2a", NaN, Infinity]) {
      const candidate = row(1);
      candidate.location_1[field] = value;
      assert.deepEqual(classifyNewYorkWicRow(candidate), { eligible: false, reason: "invalid-coordinates" });
    }
  }
  assert.equal(classifyNewYorkWicRow(row(1, { location_1: null })).reason, "missing-coordinates");
});

test("world-invalid, zero, swapped and non-New-York points are excluded", () => {
  for (const [latitude, longitude] of [[0, 0], [91, -73], [42, -181], [-73.75, 42.65], [39, -74], [46, -74], [42, -81], [42, -70], [40.5, -74]]) {
    const result = classifyNewYorkWicRow(row(1, { location_1: { latitude, longitude } }));
    if (latitude === 40.5) assert.equal(result.eligible, true);
    else assert.deepEqual(result, { eligible: false, reason: "outside-new-york-bounds" });
  }
});

test("street addresses are required and each excluded row receives one reason", async () => {
  for (const street_address of [null, undefined, "", "  ", 0, false, "<>\"'"]) {
    assert.deepEqual(classifyNewYorkWicRow(row(1, { street_address })), { eligible: false, reason: "missing-street-address" });
  }
  const result = await refresh([row(1), row(2, { street_address: "", location_1: {} }), row(3, { location_1: {} }), row(4, { location_1: { latitude: 0, longitude: 0 } })]);
  assert.equal(result.audit.expectedRows, 4);
  assert.equal(result.audit.publishedRecords, 1);
  assert.equal(result.audit.excludedRecords, 3);
  assert.deepEqual(result.audit.exclusionCounts, { "missing-street-address": 1, "missing-coordinates": 1, "outside-new-york-bounds": 1 });
  assert.equal(Object.values(result.audit.exclusionCounts).reduce((sum, count) => sum + count, 0), 3);
});

test("publisher update date comes only from rowsUpdatedAt and stays independent of checkedOn", async () => {
  const result = await refresh(rows(1));
  assert.equal(result.records[0].sourceUpdatedAt, "2026-04-30");
  assert.equal(result.records[0].lastChecked, "2026-10-12");
  assert.equal(result.audit.rowsUpdatedAt, updatedAt);
  assert.equal(result.audit.sourceUpdatedAt, "2026-04-30");
  assert.equal(result.audit.checkedOn, "2026-10-12");
  assert.match(result.writes[0], /"sourceUpdatedAt": "2026-04-30"/);
  for (const value of [undefined, "", "2026-02-30", "2026-04-30T15:38:06Z"]) {
    assert.throws(() => makeNewYorkWicResource(row(1), { ...dates, sourceUpdatedAt: value }), /valid YYYY-MM-DD/);
    assert.throws(() => makeNewYorkWicResource(row(1), { ...dates, checkedOn: value }), /valid YYYY-MM-DD/);
  }
});

test("the CLI's default publication floor remains enforced after complete collection", async () => {
  const source = feed(rows(249));
  let writes = 0;
  await assert.rejects(refreshNewYorkWic({ fetchImpl: source.fetchImpl, checkedOn: dates.checkedOn, writeOutput: async () => { writes += 1; } }), /249 records.*refusing to publish/);
  assert.equal(writes, 0);
  assert.equal(source.calls.at(-1).kind, "metadata");
});

test("valid output is deterministic and import has no fetching or writing side effects", async () => {
  const first = await refresh([row(1, { agency_name: "Zeta" }), row(2, { agency_name: "Alpha" })]);
  const second = await refresh([row(1, { agency_name: "Zeta" }), row(2, { agency_name: "Alpha" })]);
  assert.equal(first.writes[0], second.writes[0]);
  assert.equal(first.records[0].sourceRecordId, "00002");
  assert.match(first.writes[0], /^\/\/ Generated by scripts\/refresh-new-york-wic\.mjs/);
});

test("refresh preserves reviewed categories, narrative, publication decisions and unknown provenance", async () => {
  const original = makeNewYorkWicResource(row(1), dates);
  const previous = {
    ...original,
    name: "Old official name",
    city: "Old official city",
    lat: 42,
    lng: -74,
    address: "Old source address",
    phone: "Old source phone",
    providerUrl: "https://old.example.org/",
    sourceUrl: "https://old.example.org/source",
    category: "health",
    secondaryCategories: ["food", "referral"],
    summary: "Reviewed summary",
    services: ["Reviewed services"],
    eligibility: "Reviewed eligibility",
    availabilityNote: "Reviewed availability instructions",
    costNote: "Reviewed cost evidence",
    sourceDetail: "Reviewed provenance",
    sourceUpdatedAt: "2026-04-29",
    lastChecked: "2026-08-05",
    publicationDecision: "reviewed-visible",
    unknownProvenance: { reviewedBy: "Fixture editor" },
  };
  const before = structuredClone(previous);
  const source = feed([row(1)]);
  const result = await refreshNewYorkWic({ ...source, checkedOn: dates.checkedOn, minimumRecords: 1, previousResources: [previous] });
  const actual = result.records[0];
  for (const field of ["category", "secondaryCategories", "summary", "services", "eligibility", "availabilityNote", "costNote", "sourceDetail", "publicationDecision", "unknownProvenance"]) {
    assert.deepEqual(actual[field], previous[field], `${field} must retain reviewed values`);
  }
  for (const field of ["name", "city", "lat", "lng", "address", "phone", "providerUrl", "sourceUrl", "sourceUpdatedAt", "lastChecked"]) {
    assert.deepEqual(actual[field], original[field], `${field} must reflect the verified source snapshot`);
  }
  assert.deepEqual(previous, before, "existing records are never mutated");
  assert.match(result.output, /Reviewed summary/);
});

test("changed service type or regressed publisher date blocks replacement before curated instructions can drift", async () => {
  for (const previous of [
    { ...makeNewYorkWicResource(row(1, { site_type: "Temporary" }), dates), availabilityNote: "Reviewed temporary visit instructions" },
    { ...makeNewYorkWicResource(row(1), dates), sourceUpdatedAt: "2026-05-01" },
  ]) {
    let writes = 0;
    await assert.rejects(refreshNewYorkWic({
      ...feed([row(1)]),
      checkedOn: dates.checkedOn,
      minimumRecords: 1,
      previousResources: [previous],
      writeOutput: async () => { writes += 1; },
    }), /editorial reconciliation|Publisher date regressed/);
    assert.equal(writes, 0);
  }
});

test("previous snapshot duplicate identities cannot silently discard editorial work", async () => {
  const previous = makeNewYorkWicResource(row(1), dates);
  const source = feed([row(1)]);
  await assert.rejects(refreshNewYorkWic({ ...source, checkedOn: dates.checkedOn, previousResources: [previous, { ...previous, summary: "Different reviewed summary" }] }), /previous snapshot contains duplicate/);
  assert.equal(source.calls.length, 0);
});

test("a newly visible source ID requires publication membership review without writing", async () => {
  const previousResources = [makeNewYorkWicResource(row(1), dates)];
  let writes = 0;
  await assert.rejects(refreshNewYorkWic({
    ...feed([row(1), row(2)]),
    checkedOn: dates.checkedOn,
    minimumRecords: 1,
    previousResources,
    writeOutput: async () => { writes += 1; },
  }), /Publication membership changed/);
  assert.equal(writes, 0);
});

test("an existing Permanent site becoming Administrative requires membership review without writing", async () => {
  const previousResources = [makeNewYorkWicResource(row(1), dates), makeNewYorkWicResource(row(2), dates)];
  let writes = 0;
  await assert.rejects(refreshNewYorkWic({
    ...feed([row(1), row(2, { site_type: "Administrative" })]),
    checkedOn: dates.checkedOn,
    minimumRecords: 1,
    previousResources,
    writeOutput: async () => { writes += 1; },
  }), /Publication membership changed/);
  assert.equal(writes, 0);
});

test("an explicitly reviewed empty NY snapshot cannot be repopulated implicitly", async () => {
  let writes = 0;
  await assert.rejects(refreshNewYorkWic({
    fetchImpl: feed(rows(1)).fetchImpl, checkedOn: dates.checkedOn, minimumRecords: 1,
    previousResources: [], writeOutput: async () => { writes += 1; }
  }), /Publication membership changed/);
  assert.equal(writes, 0);
});
