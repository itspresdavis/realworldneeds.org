import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MASSACHUSETTS_WIC_MAX_ROWS,
  MASSACHUSETTS_WIC_REQUEST_TIMEOUT_MS,
  fetchMassachusettsWicSnapshot,
  makeMassachusettsWicResource,
  parseMassachusettsWicPage,
  refreshMassachusettsWic,
} from "../scripts/refresh-massachusetts-wic.mjs";
import { replaceSourceSnapshot } from "../scripts/source-refresh-safety.mjs";

const checkedOn = "2026-10-13";
const marker = (id, extra = {}) => ({
  position: { alt: `Fixture ${id} WIC`, lat: 42.3601, lng: -71.0589 },
  infoWindow: { name: `<a href="/locations/fixture-${id}-wic">Fixture ${id} WIC</a>`, address: "123 Main Street, Boston, MA 02108", phone: "617-555-0100" },
  ...extra,
});
const rows = (n) => Array.from({ length: n }, (_, index) => marker(index + 1));
function page(data, { total = data.length, start = data.length ? 1 : 0, hours = "Monday 9am-5pm", accessible = false } = {}) {
  const end = data.length ? start + data.length - 1 : 0;
  return `<div>Showing ${start}-${end} of ${total} results</div>`
    + `<script>ma.leafletMapData.push(${JSON.stringify({ map: "fixture-map", markers: data })});</script>`
    + '<div class="ma__location-listing__results"><ul>'
    + data.map((row) => '<li class="ma__image-promo js-location-listing-link">' + row.infoWindow.name
      + (hours ? `<ul class="ma__image-promo__hours"><li>${hours}</li></ul>` : "")
      + (accessible ? "Wheelchair Accessible" : "") + "</li>").join("") + "</ul></div>";
}
const response = (html) => new Response(html);
function feed(data, { pageSize = 2, override = () => undefined, pageOptions = {} } = {}) {
  const calls = [];
  let firstCount = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://www.mass.gov");
    assert.equal(url.pathname, "/wic-information-for-participants/locations");
    const number = Number(url.searchParams.get("page"));
    const occurrence = number === 0 ? ++firstCount : 1;
    const request = { number, occurrence, options, index: calls.length };
    calls.push(request);
    const replacement = await override(request);
    if (replacement !== undefined) return replacement;
    const subset = data.slice(number * pageSize, (number + 1) * pageSize);
    return response(page(subset, { total: data.length, start: subset.length ? number * pageSize + 1 : 0, ...pageOptions }));
  };
  return { fetchImpl, calls };
}
const resource = (row, options) => makeMassachusettsWicResource(row, page([row], options), { checkedOn });
async function refresh(data, options = {}) {
  const source = feed(data, options);
  const writes = [];
  const result = await refreshMassachusettsWic({ fetchImpl: source.fetchImpl, checkedOn, minimumRecords: 1, previousResources: options.previousResources, writeOutput: async (output) => writes.push(output) });
  return { ...result, writes, calls: source.calls };
}
async function rejectsWithoutWriting(data, options, expected = /Mass.gov|Massachusetts/) {
  const source = feed(data, options);
  const before = "reviewed bytes\n";
  let output = before;
  let writes = 0;
  await assert.rejects(refreshMassachusettsWic({ fetchImpl: source.fetchImpl, checkedOn, minimumRecords: 1, previousResources: options?.previousResources, requestTimeoutMs: options?.requestTimeoutMs, writeOutput: async (next) => { output = next; writes += 1; } }), expected);
  assert.equal(writes, 0);
  assert.equal(output, before);
  return source.calls;
}

test("import exposes offline functions without executing the CLI", () => {
  assert.equal(typeof refreshMassachusettsWic, "function");
  assert.equal(typeof fetchMassachusettsWicSnapshot, "function");
});

test("complete raw identity coverage includes ordered ranges, overflow and first-page bracketing", async () => {
  for (const count of [1, 2, 3, 6]) {
    const result = await refresh(rows(count));
    const pages = Math.ceil(count / 2);
    assert.equal(result.records.length, count);
    assert.equal(result.audit.expectedRows, count);
    assert.equal(result.audit.uniqueRawIds, count);
    assert.equal(result.audit.overflowRows, 0);
    assert.equal(result.audit.pagesFetched, pages);
    assert.deepEqual(result.calls.map((call) => call.number), [...Array.from({ length: pages + 1 }, (_, index) => index), 0]);
    assert.equal(result.writes.length, 1);
    for (const { options } of result.calls) {
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
    }
  }
});

test("range syntax is exact and duplicate matching counters are accepted", () => {
  const html = page(rows(2));
  assert.equal(parseMassachusettsWicPage(html + "<p>Showing 1 to 2 of 2 results</p>").total, 2);
  assert.equal(parseMassachusettsWicPage(html.replace("1-2", "1–2")).total, 2);
  for (const replacement of ["of 2 results", "Showing 1-2 of 2.5 results", "Showing 1-2 of -2 results", "Showing 1-2 of 2e1 results", "Showing 0-1 of 2 results", "Showing 1-3 of 2 results", "Showing 1-2 of 9007199254740993 results"]) {
    assert.throws(() => parseMassachusettsWicPage(html.replace("Showing 1-2 of 2 results", replacement)), /range/);
  }
  assert.throws(() => parseMassachusettsWicPage(html + "Showing 1-2 of 3 results"), /consistent result range/);
});

test("missing, malformed, duplicate and non-array map payloads fail closed", async () => {
  const html = page(rows(1));
  for (const bad of ["", html.replace("ma.leafletMapData", "other"), html.replace('"markers":[', '"markers":{'), html.replace('"markers":[', '"other":['), html + '<script>ma.leafletMapData.push({"map":"another","markers":[]});</script>', html.replace('"map":"fixture-map"', '"map":null')]) {
    const calls = await rejectsWithoutWriting(rows(1), { override: () => response(bad) }, /map|JSON|property|position/);
    assert.equal(calls.length, 1);
  }
});

test("JSON string delimiters inside marker text do not truncate the payload", () => {
  const row = marker(1);
  row.position.alt = 'Fixture }); \\" quoted WIC';
  assert.equal(parseMassachusettsWicPage(page([row])).markers[0].position.alt, row.position.alt);
});

test("short, oversized, skipped and repeated page ranges stop before later requests", async () => {
  for (const replacement of [page([], { total: 3 }), page(rows(2), { total: 3, start: 1 }), page([marker(3)], { total: 3, start: 2 }), page([marker(3)], { total: 4, start: 3 })]) {
    const calls = await rejectsWithoutWriting(rows(3), { override: ({ number }) => number === 1 ? response(replacement) : undefined }, /range|totals/);
    assert.equal(calls.length, 2);
  }
});

test("unbounded row/page counts and empty initial pages fail before another request", async () => {
  for (const html of [page(rows(1), { total: MASSACHUSETTS_WIC_MAX_ROWS + 1 }), page(rows(1), { total: 31 }), page([], { total: 1 }), page(rows(1), { total: 2, start: 2 })]) {
    const calls = await rejectsWithoutWriting(rows(1), { override: () => response(html) }, /range|budget/);
    assert.equal(calls.length, 1);
  }
});

test("overflow identities and changing ending counts never publish", async () => {
  for (const html of [page([marker(4)], { total: 4, start: 4 }), page([], { total: 4 })]) {
    const calls = await rejectsWithoutWriting(rows(3), { override: ({ number }) => number === 2 ? response(html) : undefined }, /overflow/);
    assert.equal(calls.length, 3);
  }
});

test("first-page identity, source facts, hours, accessibility and count changes fail bracketing", async () => {
  const changedPhone = rows(2);
  changedPhone[0].infoWindow.phone = "617-555-0199";
  for (const html of [page([marker(9), marker(2)], { total: 3 }), page(changedPhone, { total: 3 }), page(rows(2), { total: 3, hours: "Friday 1pm-2pm" }), page(rows(2), { total: 3, accessible: true }), page(rows(2), { total: 4 })]) {
    const calls = await rejectsWithoutWriting(rows(3), { override: ({ number, occurrence }) => number === 0 && occurrence === 2 ? response(html) : undefined }, /first page changed/);
    assert.equal(calls.length, 4);
  }
});

test("raw duplicate identities fail even when a duplicate row has invalid coordinates", async () => {
  const duplicate = marker(1, { position: { alt: "Bad duplicate", lat: null, lng: null } });
  await rejectsWithoutWriting([marker(1), duplicate], {}, /identities|duplicate/);
  const calls = await rejectsWithoutWriting([marker(1), marker(2), duplicate], {}, /duplicate source identity/);
  assert.equal(calls.length, 2);
});

test("missing, noncanonical and ambiguous source identities are rejected", async () => {
  for (const name of [undefined, null, "", '<a href="https://example.com/locations/fixture-1-wic">Wrong host</a>', '<a href="//mass.gov/locations/fixture-1-wic">Protocol relative</a>', '<a href="/locations/fixture-1-wic?x=1">Query</a>', '<a href="/locations/fixture-1-wic/">Trailing slash</a>', '<a href="/locations/fixture-1-wic" href="/locations/fixture-2-wic">Ambiguous</a>']) {
    const row = marker(1); row.infoWindow.name = name;
    await rejectsWithoutWriting([row], {}, /identity/);
  }
});

test("rendered listing membership must exactly match map identities", async () => {
  const html = page(rows(2));
  for (const bad of [html.replace('class="ma__location-listing__results"', 'class="missing"'), html.replace('js-location-listing-link', 'other'), html.replaceAll('href="/locations/fixture-2-wic"', 'href="/locations/fixture-1-wic"')]) {
    await rejectsWithoutWriting(rows(2), { override: () => response(bad) }, /results|identities/);
  }
});

test("missing and invalid coordinate types never become numeric exact zero locations", async () => {
  for (const field of ["lat", "lng"]) {
    for (const value of [undefined, null, "", "  ", false, true, [], {}, "0x2a", "4.2e1", "Infinity", NaN, Infinity]) {
      const row = marker(1); row.position[field] = value;
      assert.throws(() => resource(row), /coordinates must/);
      await rejectsWithoutWriting([row], {}, /coordinates must/);
    }
  }
});

test("coordinates accept decimal strings but reject swapped, world-invalid and non-Massachusetts points", () => {
  const row = marker(1, { position: { alt: "Decimal WIC", lat: " 42.3601 ", lng: "-71.0589" } });
  assert.equal(resource(row).lat, 42.3601);
  for (const [lat, lng] of [[0, 0], [-71.0589, 42.3601], [91, -71], [42, -181], [40.7, -74], [43, -71], [42, -69]]) {
    assert.throws(() => resource(marker(1, { position: { alt: "Wrong location", lat, lng } })), /outside Massachusetts bounds/);
  }
  for (const [lat, lng] of [[41.274064, -69.991984], [42.85664, -73.372288]]) {
    assert.equal(resource(marker(1, { position: { alt: "Envelope example", lat, lng } })).locationPrecision, "exact");
  }
});

test("required names/addresses and optional phone types fail closed", () => {
  for (const value of [undefined, null, "", " ", false, [], {}]) {
    const row = marker(1); row.position.alt = value;
    assert.throws(() => resource(row), /name or street address/);
    const second = marker(1); second.infoWindow.address = value;
    assert.throws(() => resource(second), /name or street address/);
  }
  for (const phone of [false, 123, {}, []]) {
    const row = marker(1); row.infoWindow.phone = phone;
    assert.throws(() => resource(row), /malformed phone/);
  }
});

test("retrieval is recorded separately without inventing or replacing publisher provenance", async () => {
  const data = rows(1);
  const fresh = await refresh(data);
  assert.equal(fresh.records[0].lastChecked, checkedOn);
  assert.equal(Object.hasOwn(fresh.records[0], "sourceUpdatedAt"), false);
  for (const sourceUpdatedAt of ["2026-04-30", "2026-08-05"]) {
    const previous = { ...resource(data[0]), sourceUpdatedAt, lastChecked: "2026-05-01" };
    const result = await refresh(data, { previousResources: [previous] });
    assert.equal(result.records[0].sourceUpdatedAt, sourceUpdatedAt);
    assert.equal(result.records[0].lastChecked, checkedOn);
  }
});

test("only explicit source facts change; editorial fields and unknown provenance survive", async () => {
  const row = marker(1);
  const previous = { ...resource(row), name: "Old name", address: "Old address", lat: 42.1, summary: "Reviewed instructions", services: ["Reviewed services"], eligibility: "Reviewed eligibility", availabilityNote: "Reviewed booking steps", accessibilityNote: "Reviewed entrance instructions", coordinateNote: "Reviewed map evidence", secondaryCategories: ["health", "referral"], customEvidence: { url: "https://example.com/review" } };
  const result = await refresh([row], { previousResources: [previous] });
  for (const field of ["summary", "services", "eligibility", "availabilityNote", "accessibilityNote", "coordinateNote", "secondaryCategories", "customEvidence"]) assert.deepEqual(result.records[0][field], previous[field]);
  assert.equal(result.records[0].name, row.position.alt);
  assert.equal(result.records[0].address, row.infoWindow.address);
  assert.equal(result.records[0].lat, row.position.lat);
});

test("removed optional source phone is not retained as stale contact information", async () => {
  const row = marker(1);
  const previous = resource(row);
  delete row.infoWindow.phone;
  const result = await refresh([row], { previousResources: [previous] });
  assert.equal(Object.hasOwn(result.records[0], "phone"), false);
});

test("membership removals, additions, equal-count replacements and explicit empty snapshots require review", async () => {
  const previousResources = rows(2).map((row) => resource(row));
  for (const data of [rows(1), rows(3), [marker(1), marker(3)]]) await rejectsWithoutWriting(data, { previousResources }, /Publication membership changed/);
  await rejectsWithoutWriting(rows(1), { previousResources: [] }, /Publication membership changed/);
  await rejectsWithoutWriting(rows(1), { previousResources: [previousResources[0], previousResources[0]] }, /duplicate resource IDs/);
});

test("changed source identity for an existing resource ID requires reconciliation", async () => {
  const row = marker(1);
  const previous = { ...resource(row), sourceRecordId: "/locations/other-wic" };
  await rejectsWithoutWriting([row], { previousResources: [previous] }, /Source identity changed/);
});

test("military eligibility, hours availability and known accessibility evidence changes require editorial review", async () => {
  const row = marker(1);
  const previous = resource(row);
  const military = marker(1); military.position.alt += " Military only";
  await rejectsWithoutWriting([military], { previousResources: [previous] }, /Changed accessType/);
  await rejectsWithoutWriting([row], { previousResources: [previous], pageOptions: { hours: "" } }, /Changed hours availability/);
  await rejectsWithoutWriting([row], { previousResources: [previous], pageOptions: { accessible: true } }, /Changed accessibility evidence/);
  await rejectsWithoutWriting([row], { previousResources: [resource(row, { hours: "" })] }, /Changed hours availability/);
});

test("HTTP access failures, network failures, malformed bodies and body rejections stop at every stage", async () => {
  for (let index = 0; index < 4; index += 1) {
    for (const fail of [() => new Response("Denied", { status: 403 }), () => new Response("Unavailable", { status: 503 }), () => { throw new Error("fixture network failure"); }, () => response("malformed"), () => ({ ok: true, text: async () => { throw new Error("fixture body failure"); } })]) {
      const calls = await rejectsWithoutWriting(rows(3), { override: (call) => call.index === index ? fail() : undefined }, /403|503|fixture|payload/);
      assert.equal(calls.length, index + 1);
    }
  }
});

test("request/body deadline bounds stalled transports at each stage without later requests", async () => {
  for (let index = 0; index < 4; index += 1) {
    for (const bodyOnly of [false, true]) {
      const calls = await rejectsWithoutWriting(rows(3), { requestTimeoutMs: 15, override: (call) => call.index === index ? bodyOnly ? { ok: true, text: () => new Promise(() => {}) } : new Promise(() => {}) : undefined }, /deadline/);
      assert.equal(calls.length, index + 1);
      assert.equal(calls.at(-1).options.signal.aborted, true);
    }
  }
});

test("invalid date, record floor and deadline options fail before fetching", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("must not fetch"); };
  for (const date of ["", "2026-02-30", "2026-13-01", "2026-1-01", null]) await assert.rejects(refreshMassachusettsWic({ fetchImpl, checkedOn: date }), /valid YYYY-MM-DD/);
  for (const minimumRecords of [0, -1, 1.5, NaN]) await assert.rejects(refreshMassachusettsWic({ fetchImpl, checkedOn, minimumRecords }), /positive integer/);
  for (const requestTimeoutMs of [0, -1, 1.5, MASSACHUSETTS_WIC_REQUEST_TIMEOUT_MS + 1, Infinity]) await assert.rejects(fetchMassachusettsWicSnapshot({ fetchImpl, requestTimeoutMs }), /bounded range/);
  assert.equal(calls, 0);
});

test("default publication floor cannot turn a tiny complete feed into a public snapshot", async () => {
  let writes = 0;
  await assert.rejects(refreshMassachusettsWic({ fetchImpl: feed(rows(2)).fetchImpl, checkedOn, writeOutput: async () => { writes += 1; } }), /refusing to publish/);
  assert.equal(writes, 0);
});

test("atomic snapshot integration preserves concurrent edits and respects a competing writer lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rwn-ma-refresh-"));
  const output = pathToFileURL(join(directory, "snapshot.js"));
  const lock = pathToFileURL(join(directory, ".snapshot.js.refresh.lock"));
  try {
    await writeFile(output, "reviewed before\n");
    const before = await readFile(output);
    const run = () => refreshMassachusettsWic({ fetchImpl: feed(rows(1)).fetchImpl, checkedOn, minimumRecords: 1, previousResources: [resource(marker(1))], writeOutput: (value) => replaceSourceSnapshot(output, before, value) });
    await writeFile(output, "concurrent editorial change\n");
    await assert.rejects(run(), /changed during collection/);
    assert.equal(await readFile(output, "utf8"), "concurrent editorial change\n");
    assert.deepEqual(await readdir(directory), ["snapshot.js"]);
    await writeFile(lock, "another refresh\n");
    await assert.rejects(run(), { code: "EEXIST" });
    assert.equal(await readFile(output, "utf8"), "concurrent editorial change\n");
    assert.equal(await readFile(lock, "utf8"), "another refresh\n");
    await rm(lock);
    const current = await readFile(output);
    const result = await refreshMassachusettsWic({ fetchImpl: feed(rows(1)).fetchImpl, checkedOn, minimumRecords: 1, previousResources: [resource(marker(1))], writeOutput: (value) => replaceSourceSnapshot(output, current, value) });
    assert.equal(await readFile(output, "utf8"), result.output);
    assert.deepEqual(await readdir(directory), ["snapshot.js"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("late transport completion cannot consume the body or write after deadline", async () => {
  let resolveFetch;
  let bodyReads = 0;
  let writes = 0;
  const pending = refreshMassachusettsWic({
    fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    checkedOn,
    minimumRecords: 1,
    requestTimeoutMs: 15,
    writeOutput: async () => { writes += 1; },
  });
  await assert.rejects(pending, /deadline/);
  resolveFetch({ ok: true, text: async () => { bodyReads += 1; return page(rows(1)); } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bodyReads, 0);
  assert.equal(writes, 0);
});


test("only real unambiguous anchor href attributes establish source identity", async () => {
  for (const name of [
    '<span data-href="/locations/fixture-1-wic">Fixture</span>',
    '<a data-href="/locations/fixture-1-wic">Fixture</a>',
    '<a title=\'href="/locations/fixture-1-wic"\'>Fixture</a>',
    '<a href=\'/locations/other-wic\' href="/locations/fixture-1-wic">Fixture</a>',
    '<a HREF="/locations/other-wic" href="/locations/fixture-1-wic">Fixture</a>',
    '<a href="/locations/fixture-1-wic" HREF="/locations/other-wic">Fixture</a>',
    '<a href=\'/locations/fixture-1-wic\'>Fixture</a>',
    '<a HREF="/locations/fixture-1-wic">Fixture</a>',
    '<a href=/locations/fixture-1-wic>Fixture</a>',
    '<a href="/locations/fixture-1-wic" href>Fixture</a>',
    '<a href="/locations/fixture-1-wic"></a><a href="/locations/other-wic">Other</a>',
  ]) {
    const row = marker(1); row.infoWindow.name = name;
    const calls = await rejectsWithoutWriting([row], {}, /identity/);
    assert.equal(calls.length, 1);
  }
  const valid = marker(1);
  valid.infoWindow.name = '<a title=\'text href="/locations/other-wic"\' data-href="/locations/ignored-wic" href="/locations/fixture-1-wic">Fixture</a>';
  const result = await refresh([valid]);
  assert.equal(result.records[0].sourceRecordId, "/locations/fixture-1-wic");
});


test("listing facts come from the matching closed card, not data attributes or following page chrome", () => {
  const data = rows(2);
  data[0].infoWindow.name = '<a data-href="/locations/fixture-2-wic" href="/locations/fixture-1-wic">Fixture 1 WIC</a>';
  const html = page(data) + '<footer>Wheelchair Accessible</footer>';
  for (const row of data) {
    const result = makeMassachusettsWicResource(row, html, { checkedOn });
    assert.equal(result.hours, "Monday 9am-5pm");
    assert.match(result.accessibilityNote, /^Accessibility details are not stated/);
  }
  const secondHours = html.replaceAll('Monday 9am-5pm', 'Tuesday 1pm-2pm');
  assert.equal(makeMassachusettsWicResource(data[1], secondHours, { checkedOn }).hours, "Tuesday 1pm-2pm");
  assert.throws(() => parseMassachusettsWicPage(page(rows(1)).replace('</li></ul></div>', '</ul></div>')), /unterminated/);
});
