import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { decodeNextPayloads, extractResultObjects, fetchTrussellSnapshot, prepareTrussellResources, renderTrussellSnapshot, refreshTrussell, makeResource } from "../scripts/refresh-trussell-foodbanks.mjs";

const checkedOn = "2026-10-12";
const row = (i, extra = {}) => ({
  uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  title: `Fixture ${i}`, groupTitle: "Fixture", address01: "1 Fictional Street",
  town: "London", postcode: "SW1A 1AA", hideAddressLink: "Off",
  geoLocation: '{"type":"Point","coordinates":[-0.12,51.5]}',
  websiteReferralUrl: "https://example.org/foodbank", dcsStatusLabel: "Collection only", ...extra
});
const rows = (count = 1392) => Array.from({ length: count }, (_, i) => row(i));
function fixture(records = rows(), reported = records.length, alter = (page) => page) {
  const requests = [];
  const loadPageImpl = async (number) => {
    requests.push(number);
    return alter({ page: number, records: records.slice((number - 1) * 10, number * 10), totalPages: Math.ceil(reported / 10), totalResults: reported }, requests);
  };
  return { loadPageImpl, requests, wait: async () => {} };
}
async function rejectsWithoutWriting(options, pattern) {
  let writes = 0;
  await assert.rejects(refreshTrussell({ ...options, checkedOn, writeOutput: async () => { writes += 1; } }), pattern);
  assert.equal(writes, 0, "failed reconciliation must leave existing snapshot bytes untouched");
}

test("Trussell parser counts every UUID before publication filtering, including geometry-less rows", () => {
  const records = [row(1), row(2, { geoLocation: null, address01: null }), row(3, { hideAddressLink: "On" })];
  const payload = records.map((record) => JSON.stringify({ result: record })).join("\n");
  const html = `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
  assert.deepEqual(extractResultObjects(decodeNextPayloads(html)), records);
});

test("Trussell 1392 source identities reconcile before the 17 non-overlapping publication exclusions", async () => {
  const records = rows();
  for (let i = 0; i < 15; i += 1) records[i].address01 = null;
  records[0].geoLocation = null; records[1].geoLocation = null;
  records[15].hideAddressLink = "On"; records[16].hideAddressLink = "new-private-flag";
  const options = fixture(records);
  const snapshot = await fetchTrussellSnapshot(options);
  const result = prepareTrussellResources(snapshot, checkedOn);
  assert.equal(snapshot.rawByUuid.size, 1392);
  assert.equal(result.resources.length, 1375);
  assert.deepEqual(result.exclusions, { missing_street_address: 15, source_hidden_location: 2 });
  assert.equal(options.requests.length, 141);
  assert.deepEqual(options.requests.slice(-2), [140, 1]);
  const output = renderTrussellSnapshot(snapshot, result.resources, result.exclusions, checkedOn);
  for (const hidden of records.slice(15, 17)) assert.equal(output.includes(hidden.uuid), false);
});

test("Trussell's formerly accepted 1348/1390 shortfall fails before any output", async () => {
  await rejectsWithoutWriting(fixture(rows(1348), 1390), /Incomplete.*page/);
});

for (const conflicting of [false, true]) {
  test(`Trussell rejects ${conflicting ? "conflicting" : "identical"} duplicate raw identities`, async () => {
    const records = rows(); records[100] = { ...records[0], ...(conflicting ? { title: "Changed" } : {}) };
    await rejectsWithoutWriting(fixture(records), /Duplicate Trussell UUID/);
  });
}

for (const changed of [{ totalResults: 1393 }, { totalPages: 141 }, { page: 3 }, { records: [] }]) {
  test(`Trussell rejects changed or truncated page metadata ${JSON.stringify(changed)}`, async () => {
    const options = fixture(rows(), 1392, (page) => page.page === 2 ? { ...page, ...changed } : page);
    await rejectsWithoutWriting(options, /changed|Incomplete/);
    assert.equal(options.requests.length, 2);
  });
}

test("Trussell brackets the first page, failing changes even when count and identities remain equal", async () => {
  const options = fixture(rows(), 1392, (page, requests) => requests.length > 140
    ? { ...page, records: page.records.map((record, i) => i === 0 ? { ...record, telephone: "changed" } : record) } : page);
  await rejectsWithoutWriting(options, /first page changed/);
});

test("Trussell stops at the first transport failure without retrying or writing", async () => {
  const requested = [];
  await rejectsWithoutWriting({ wait: async () => {}, loadPageImpl: async (page) => {
    requested.push(page);
    if (page === 2) throw new Error("HTTP 403");
    return fixture().loadPageImpl(page);
  } }, /HTTP 403/);
  assert.deepEqual(requested, [1, 2]);
});

test("Trussell excludes invalid point geometry and counts each exclusion only once", async () => {
  const records = rows();
  records[0].geoLocation = '{"type":"LineString","coordinates":[-0.12,51.5]}';
  records[1].geoLocation = '{"type":"Point","coordinates":[0,0]}';
  records[2].title = "";
  const snapshot = await fetchTrussellSnapshot(fixture(records));
  const result = prepareTrussellResources(snapshot, checkedOn);
  assert.deepEqual(result.exclusions, { invalid_coordinates: 2, incomplete_location: 1 });
  assert.equal(result.resources.length, 1389);
});

test("Trussell keeps editorial and unknown provenance fields through compact output serialization", async () => {
  const input = rows();
  const previous = { ...makeResource(input[0], 50, "2026-10-01"), summary: "Reviewed summary", secondaryCategories: ["referral", "health"], availabilityNote: "Call the accessible entrance", sourceUpdatedAt: "2026-04-30", editorialNote: "Keep this note", customEvidence: { reviewed: true } };
  const snapshot = await fetchTrussellSnapshot(fixture(input));
  const { resources, exclusions } = prepareTrussellResources(snapshot, checkedOn, [previous]);
  const output = renderTrussellSnapshot(snapshot, resources, exclusions, checkedOn);
  const context = vm.createContext({});
  vm.runInContext(output.replaceAll("export const", "const") + "\nglobalThis.records = trussellFoodbankResources;", context);
  const actual = JSON.parse(JSON.stringify(context.records.find((r) => r.id === previous.id)));
  assert.equal(actual.summary, previous.summary);
  assert.deepEqual(actual.secondaryCategories, previous.secondaryCategories);
  assert.equal(actual.availabilityNote, previous.availabilityNote);
  assert.deepEqual(actual.customEvidence, previous.customEvidence);
  assert.equal(actual.sourceUpdatedAt, "2026-04-30");
  assert.equal(actual.lastChecked, checkedOn);
  assert.match(actual.sourceUrl, /page=1$/);
  assert.deepEqual(actual, resources.find((r) => r.id === previous.id));
});

test("Trussell source-status changes require editorial reconciliation rather than rewriting notes", async () => {
  const input = rows();
  const previous = makeResource({ ...input[0], dcsStatusLabel: "Closed" }, 1, "2026-10-01");
  await rejectsWithoutWriting({ ...fixture(input), previousResources: [previous] }, /requires editorial reconciliation/);
});

test("newly source-hidden existing records stop replacement and never re-publish retained locations", async () => {
  const input = rows();
  const previousResources = input.map((record) => makeResource(record, 1, "2026-10-01"));
  input[0].hideAddressLink = "On";
  await rejectsWithoutWriting({ ...fixture(input), previousResources }, /Publication membership changed/);
  const snapshot = await fetchTrussellSnapshot(fixture(input));
  const { resources, exclusions } = prepareTrussellResources(snapshot, checkedOn, previousResources);
  assert.equal(resources.some((r) => r.id === previousResources[0].id), false);
  assert.equal(exclusions.source_hidden_location, 1);
  assert.equal(renderTrussellSnapshot(snapshot, resources, exclusions, checkedOn).includes(input[0].uuid), false);
});

test("new source identities require restoration/insertion review rather than automatic publication", async () => {
  const input = rows();
  const previousResources = input.slice(0, -1).map((record) => makeResource(record, 1, "2026-10-01"));
  await rejectsWithoutWriting({ ...fixture(input), previousResources }, /Publication membership changed/);
});

for (const [before, after] of [["website", "telephone"], ["telephone", "website"]]) {
  test(`Trussell referral mode ${before} to ${after} requires editorial reconciliation`, async () => {
    const input = rows();
    const previous = makeResource({ ...input[0], referralType: before }, 1, "2026-10-01");
    input[0].referralType = after;
    await rejectsWithoutWriting({ ...fixture(input), previousResources: [previous] }, /Changed referral instructions/);
  });
}

test("Trussell refuses replacement of an explicitly reviewed empty snapshot", async () => {
  await rejectsWithoutWriting({ ...fixture(rows()), previousResources: [] }, /Publication membership changed/);
});
