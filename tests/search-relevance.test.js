import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resources } from "../src/data/resources.js";
import { createInitialTypeSet, matchesResource } from "../src/utils/geo.js";
import {
  normalizeSearch,
  prepareResourceSearch,
  querySearchTokens,
  resourceSearchScore as score,
  resourceSearchText,
} from "../src/utils/search.js";
import { warmSearchIndex } from "../src/utils/search-warmup.js";

const find = (query) =>
  resources
    .filter((resource) => score(resource, query) >= 0)
    .sort(
      (a, b) =>
        score(b, query) - score(a, query) || a.name.localeCompare(b.name),
    );
const fixture = (extra) => ({
  name: "Community support",
  city: "Example",
  country: "United Kingdom",
  category: "food",
  address: "1 Main Street",
  ...extra,
});
const indexRecord = (resource) => ({
  name: resource.name,
  place: `${resource.city}, ${resource.country}`,
  country: resource.country,
  category: resource.category,
  categories: [resource.category, ...(resource.secondaryCategories || [])],
  search: resourceSearchText(resource),
});

test("Unicode search terms stay meaningful without inventing translations or dropping mixed-query constraints", () => {
  for (const query of ["東京", "مساعدة", "Київ", "food 東京", "مساعدة food", "東京 E16LT", "E16LT 東京"]) {
    assert.ok(querySearchTokens(query).length > 0, query);
    assert.equal(find(query).length, 0, `${query}: the current catalog has no literal match`);
    for (const convert of [(resource) => resource, indexRecord]) {
      assert.equal(score(convert(fixture({ name: "Community food pantry" })), query), -1, query);
    }
  }
  for (const name of ["東京", "مساعدة", "Київ", "हिन्दी", "বাংলা", "ภาษาไทย", "서울"]) {
    const service = fixture({ name });
    for (const convert of [(resource) => resource, indexRecord]) {
      assert.ok(score(convert(service), name) >= 0, `${name}: literal catalog text`);
      assert.ok(score(convert(service), `${name} food`) >= 0, `${name}: mixed catalog text`);
    }
    assert.equal(normalizeSearch(name.normalize("NFC")), normalizeSearch(name.normalize("NFD")), name);
  }
  assert.equal(normalizeSearch("ї"), "і\u0308", "Cyrillic marks are not Latin accents");
  assert.equal(normalizeSearch("हिन्दी"), "हिन्दी", "Indic vowel and joining marks remain meaningful");
  for (const [accented, plain] of [["Bogotá", "Bogota"], ["vêtements", "vetements"], ["WÍÇ", "WIC"]])
    assert.equal(normalizeSearch(accented), normalizeSearch(plain));
  for (const query of ["", "   ", "please find help near me", "---"]) {
    assert.deepEqual(querySearchTokens(query), [], `${query}: existing empty/noise-only semantics`);
    assert.equal(score(fixture({}), query), 0);
  }
});

test("complete UK postcode spacing variants retain the same exact lookup on both search surfaces", () => {
  // All six regular outward-code shapes; these fixtures test formatting, not
  // delivery validity. ONS separates the final three-character inward code:
  // https://www.ons.gov.uk/methodology/geography/ukgeographies/postalgeography
  for (const postcode of ["M1 1AA", "M60 1NW", "CR2 6XH", "DN55 1PT", "W1P 1HQ", "EC1A 1BB"]) {
    const compact = postcode.replace(" ", "");
    const service = fixture({ address: `1 Main Street, ${postcode}` });
    for (const convert of [(resource) => resource, indexRecord]) {
      const record = convert(service), expected = score(record, postcode);
      assert.ok(expected >= 0, postcode);
      for (const query of [compact, compact.toLowerCase(), postcode.toLowerCase(), postcode.replace(" ", "-"), postcode.replace(" ", "   ")])
        assert.equal(score(record, query), expected, query);
      assert.equal(score(record, `food ${compact}`), score(record, `food ${postcode}`));
      assert.ok(score(record, postcode.split(" ")[0]) >= 0, `${postcode}: partial outward code`);
      assert.equal(score(record, `${compact}x`), -1, "do not split inside longer words");
      assert.equal(score(record, `x${compact}x`), -1, "do not match word interiors");
    }
  }
  assert.deepEqual(find("E16LT").map((record) => record.id), ["crisis-skylight-london"]);
  assert.deepEqual(find("E16LT").map((record) => record.id), find("E1 6LT").map((record) => record.id));
  const exact = fixture({ address: "1 Example Road, NR2 1RF" });
  for (const convert of [(resource) => resource, indexRecord]) {
    for (const query of ["NR2 1RF", "NR21RF", "food NR21RF"]) {
      assert.ok(score(convert(exact), query) >= 0, query);
      for (const address of ["1 Example Road, NR23 1RF", "1 Example Road, NR2 1RFA"]) {
        assert.equal(score(convert(fixture({ address })), query), -1, `${query}: ${address}`);
      }
    }
    assert.ok(score(convert(fixture({ address: "1 Example Road, NR23 1RF" })), "NR2") >= 0,
      "incomplete outward codes retain prefix recall");
  }
  const expectedLondon = resources.filter((record) => /\bE1 6LT\b/i.test(record.address)).map((record) => record.id).sort();
  assert.ok(expectedLondon.length > 0, "the exact-postcode oracle uses a published address");
  for (const query of ["E1 6LT", "E16LT"])
    assert.deepEqual(find(query).map((record) => record.id).sort(), expectedLondon, query);
  for (const value of ["E1", "E16L", "12345", "12345-6789", "WIC", "ABC123", "E16CI", "xe16ltx"]) {
    assert.equal(normalizeSearch(value), value.toLowerCase().replace("-", " "), `${value}: not a complete UK postcode`);
  }
});

test("published UK addresses remain searchable with or without their postcode space", () => {
  let reviewed = 0;
  for (const resource of resources.filter((record) => record.country === "United Kingdom")) {
    const postcode = resource.address.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s+(\d[ABD-HJLNP-UW-Z]{2})\b/i);
    if (!postcode) continue;
    reviewed += 1;
    const spaced = `${postcode[1]} ${postcode[2]}`, compact = `${postcode[1]}${postcode[2]}`;
    for (const record of [resource, indexRecord(resource)]) {
      assert.ok(score(record, spaced) >= 0, resource.id);
      assert.equal(score(record, compact), score(record, spaced), `${resource.id}: ${compact}`);
    }
  }
  assert.equal(reviewed, 13, `published UK postcodes no longer include the withheld Trussell centre snapshot, found ${reviewed}`);
});

test("sparse legacy directory records derive a city only from a known country suffix", () => {
  const cases = [
    ["missing country", { place: "Synthetic test place" }, ""],
    ["unknown comma-separated country", { place: "London, United Kingdom" }, ""],
    ["empty country", { place: "Synthetic test place", country: "" }, ""],
    ["null country", { place: "Synthetic test place", country: null }, ""],
    ["missing place", { country: "United Kingdom" }, ""],
    ["country-only place", { place: "United Kingdom", country: "United Kingdom" }, ""],
    ["known suffix", { place: "London, United Kingdom", country: "United Kingdom" }, "london"],
    ["trimmed case-insensitive suffix", { place: " London, UNITED KINGDOM ", country: " United Kingdom " }, "london"],
    ["different suffix", { place: "London, Canada", country: "United Kingdom" }, ""],
    ["missing comma separator", { place: "London United Kingdom", country: "United Kingdom" }, ""],
    ["country is not a suffix", { place: "London, United Kingdom office", country: "United Kingdom" }, ""],
    ["explicit city", { city: "Boston", place: "London, United Kingdom", country: "United Kingdom" }, "boston"],
    ["explicit empty city", { city: "", place: "London, United Kingdom", country: "United Kingdom" }, ""],
  ];
  for (const [label, fields, city] of cases) {
    const record = { name: "Fixture survivor", category: "food", categoryLabels: ["Food"], search: "fixture survivor food", ...fields };
    assert.equal(prepareResourceSearch(record).city, city, label);
    assert.ok(score(record, "fixture") >= 0, `${label}: searchable sparse record`);
    assert.ok(score(record, "food") >= 0, `${label}: category match`);
    assert.equal(score(record, "removed"), -1, `${label}: unrelated query`);
  }
});

test("completed WIC requires program evidence while Wi and Wick retain prefix recall", () => {
  const wic = fixture({ name: "Community WIC program", city: "Boston" });
  const wick = fixture({ name: "Wick foodbank", city: "Wick" });
  const norwich = fixture({ name: "Norwich foodbank", city: "Norwich" });
  const brunswick = fixture({ name: "Brunswick pantry", city: "Brunswick" });
  for (const convert of [(resource) => resource, indexRecord]) {
    for (const query of ["WIC", "wic", "W.I.C.", "w.i.c", "WÍÇ", "wic ", "WIC food"]) {
      assert.ok(score(convert(wic), query) >= 0, query);
      for (const other of [wick, norwich, brunswick])
        assert.equal(score(convert(other), query), -1, `${query}: ${other.name}`);
    }
    assert.ok(score(convert(wic), "wi") >= 0);
    assert.ok(score(convert(wick), "wi") >= 0);
    assert.ok(score(convert(wick), "wick") >= 0);
    assert.equal(score(convert(wic), "wick"), -1);
    assert.ok(score(convert(fixture({ name: "ABC Community" })), "ab") >= 0);
    assert.ok(score(convert(fixture({ name: "Abcdef Community" })), "abc") >= 0,
      "Unknown acronyms keep the ordinary prefix rule");
  }
  const ranked = find("WIC");
  assert.equal(ranked.length, 395);
  assert.ok(ranked.every((resource) => /(?:^|\s)wic(?:\s|$)/.test(resourceSearchText(resource))));
  assert.ok(ranked.some((resource) => /Norwich WIC/.test(resource.name)));
  assert.ok(find("wi").some((resource) => resource.city === "Winchendon"));
  assert.ok(find("winchendon").some((resource) => resource.city === "Winchendon"));
});

test("exact London place outranks London Colney and a London Road in Bedford", () => {
  const london = fixture({ city: "London" });
  const colney = fixture({
    name: "London Colney Distribution Centre",
    city: "London Colney",
  });
  const road = fixture({
    name: "London Road Methodist Church",
    city: "Bedford",
    address: "96 London Road, Bedford",
  });
  for (const query of ["London", "food London", "London food"]) {
    assert.ok(score(london, query) > score(colney, query));
    assert.ok(score(london, query) > score(road, query));
  }
  assert.ok(
    find("London")
      .slice(0, 5)
      .every((resource) => resource.city === "London"),
  );
  assert.equal(find("Whitechapel Road")[0].id, "whitechapel-mission");
  assert.equal(find("Commercial Street")[0].id, "crisis-skylight-london");
});

test("exact street phrases beat scattered or merely prefixed words without hiding other matches", () => {
  for (const street of ["High Street", "Commercial Street", "Whitechapel Road"]) {
    assert.ok(
      normalizeSearch(find(street)[0].address).includes(
        normalizeSearch(street),
      ),
      street,
    );
  }
  const street = fixture({ address: "229 Bedford Road, Kempston, Bedford" });
  const scattered = fixture({
    name: "London Road Methodist",
    city: "Bedford",
    address: "96 London Road, Bedford",
  });
  assert.ok(score(street, "Bedford Road") > score(scattered, "Bedford Road"));
  assert.ok(score(scattered, "Bedford Road") >= 0);
  assert.ok(score(street, "bedford ro") >= 0);
  assert.equal(score(street, "ford road"), -1);
});

test("ZIP codes, partial and complete postcodes, and multiword provider names stay searchable", () => {
  const us = fixture({
    name: "Saint Mary Community Center",
    country: "United States",
    city: "New York",
    address: "25 Main Street, NY 10001-1234",
  });
  const uk = fixture({
    name: "Crisis Skylight London",
    city: "London",
    address: "50-52 Commercial Street, London E1 6LT",
  });
  for (const query of ["10001", "10001-1234", "Saint Mary", "mary comm"])
    assert.ok(score(us, query) >= 0, query);
  for (const query of [
    "E1",
    "E1 6LT",
    "e1-6lt",
    "Crisis Skylight",
    "commercial str",
  ])
    assert.ok(score(uk, query) >= 0, query);
  assert.equal(score(us, "10002"), -1);
  assert.equal(score(uk, "e2 6lt"), -1);
});

test("city aliases survive repeated words and deduplicated corpora", () => {
  const nypl = resources.find(
    (resource) => resource.name === "The New York Public Library",
  );
  assert.ok(nypl);
  assert.ok(score(nypl, "NYC") >= 0);
  assert.equal(score(nypl, "NYC"), score(indexRecord(nypl), "NYC"));
  assert.ok(find("NYC shelter").length > 0);
});

test("punctuation, diacritics, multilingual needs, and curated typos work on both surfaces", () => {
  const service = fixture({
    name: "St Mary’s Wi-Fi",
    city: "Bogotá",
    category: "health",
    secondaryCategories: ["hygiene", "clothing"],
  });
  for (const [left, right] of [
    ["Bogotá", "Bogota"],
    ["St Mary’s", "St Marys"],
    ["Wi-Fi", "wi fi"],
    ["santé", "sante"],
    ["vêtements", "vetements"],
  ]) {
    assert.ok(score(service, left) >= 0, left);
    assert.equal(score(service, left), score(service, right));
    assert.equal(score(service, left), score(indexRecord(service), left));
  }
  assert.ok(score(service, "hygene") >= 0);
  assert.ok(score(fixture({ category: "shelter" }), "shleter") >= 0);
  assert.ok(
    score(fixture({ address: "22 Bed Road" }), "Bed Road") >= 0,
    "need aliases retain literal street words",
  );
});

test("secondary categories and empty filters remain independent of search scoring", () => {
  const resource = fixture({ secondaryCategories: ["clothing"] });
  assert.equal(
    matchesResource(resource, "community", new Set(["clothing"])),
    true,
  );
  assert.equal(
    matchesResource(resource, "community", new Set(["health"])),
    false,
  );
  assert.equal(matchesResource(resource, "community", new Set()), false);
  assert.equal(matchesResource(resource, "", createInitialTypeSet()), true);
});

test("the generated directory and homepage have identical scores for every record", async () => {
  const payload = JSON.parse(
    await readFile("dist/data/search-index.json", "utf8"),
  );
  const indexed = new Map(payload.records.map((record) => [record.id, record]));
  const queries = [
    "",
    "London",
    "lond",
    "WIC",
    "W.I.C.",
    "wi",
    "wick",
    "Norwich",
    "London Road",
    "King Street",
    "High Street",
    "Bedford Road",
    "NYC",
    "NYC shelter",
    "new york food",
    "water",
    "free food near me",
    "santé",
    "vêtements",
    "hygene",
    "Wi-Fi",
    "E1 6LT",
    "10001",
    "St Mary’s",
    "temporary",
    "closed",
    "東京",
    "مساعدة",
    "Київ",
    "food 東京",
    "E16LT",
    "W37QE",
    "NR2 1RF",
    "NR21RF",
    "food NR21RF",
  ];
  for (const resource of resources) {
    const record = indexed.get(resource.id);
    assert.ok(record, resource.id);
    for (const query of queries)
      assert.equal(
        score(record, query),
        score(resource, query),
        `${resource.id}: ${query}`,
      );
  }
});

test("idle preparation limits each slice and does no work synchronously", () => {
  const queue = [],
    seen = [],
    records = Array.from({ length: 100 }, (_, id) => ({ id }));
  let clock = 0;
  warmSearchIndex(
    records,
    (callback) => queue.push(callback),
    () => clock,
    (resource) => {
      seen.push(resource.id);
      clock += 1;
    },
  );
  assert.equal(seen.length, 0);
  while (queue.length) {
    const before = seen.length;
    queue.shift()();
    assert.ok(seen.length - before <= 4);
  }
  assert.deepEqual(
    seen,
    records.map((resource) => resource.id),
  );
  warmSearchIndex([], () => assert.fail("an empty catalog needs no task"));
});

test("NYC aliases require a real phrase rather than scattered city and source words", () => {
  const johnson = resources.find((resource) => resource.id === "ny-wic-221-09");
  assert.ok(johnson);
  const scattered = fixture({
    name: "New York advice",
    city: "City",
    sourceName: "State guide",
  });
  for (const resource of [johnson, scattered]) {
    assert.equal(score(resource, "NYC"), -1);
    assert.equal(score(indexRecord(resource), "NYC"), -1);
  }
  const repeated = fixture({
    name: "New York library",
    city: "New York",
    summary: "Branches across New York City",
  });
  assert.ok(score(repeated, "NYC") >= 0);
  assert.equal(score(repeated, "NYC"), score(indexRecord(repeated), "NYC"));
});

test("typing prioritizes remaining preparation without duplicate work or a long slice", async () => {
  const idle = [],
    active = [],
    seen = [],
    records = Array.from({ length: 100 }, (_, id) => ({ id }));
  let clock = 0;
  const preparation = warmSearchIndex(
    records,
    (callback) => idle.push(callback),
    () => clock,
    (resource) => {
      seen.push(resource.id);
      clock += 1;
    },
    (callback) => active.push(callback),
  );
  preparation.prioritize();
  preparation.prioritize();
  assert.equal(active.length, 1);
  idle.shift()();
  assert.equal(seen.length, 0, "the older idle callback is invalidated");
  while (active.length) {
    const before = seen.length;
    active.shift()();
    assert.ok(seen.length - before <= 4);
  }
  await preparation.ready;
  preparation.prioritize();
  assert.equal(active.length, 0);
  assert.deepEqual(
    seen,
    records.map((resource) => resource.id),
  );
});

const warmupSource = (await readFile(new URL("../src/utils/search-warmup.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]+\n/, "")
  .replace("export function warmSearchIndex(", "function warmSearchIndex(");

// Run the real default scheduler with isolated host APIs, without opening live
// Node ports or changing globals used by another test.
function schedulerFixture({ count = 53, cost = 0, channelAvailable = true, injected = false } = {}) {
  const idle = [], messages = [], timers = [], channels = [], override = [], seen = [];
  const records = Array.from({ length: count }, (_, id) => ({ id }));
  let clock = 0;
  class TestMessageChannel {
    constructor() {
      this.port1 = { onmessage: null, closed: false, closes: 0, close() { this.closed = true; this.closes += 1; } };
      this.port2 = {
        closed: false,
        closes: 0,
        close() { this.closed = true; this.closes += 1; },
        postMessage: (data) => {
          assert.equal(this.port2.closed, false, "completed preparation must not post to a closed port");
          messages.push(() => {
            if (!this.port1.closed) this.port1.onmessage({ data });
          });
        },
      };
      channels.push(this);
    }
  }
  const context = vm.createContext({
    MessageChannel: channelAvailable ? TestMessageChannel : undefined,
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  const warm = vm.runInContext(`${warmupSource}\nwarmSearchIndex;`, context);
  const preparation = warm(
    records,
    (callback) => idle.push(callback),
    () => clock,
    (resource) => { seen.push(resource.id); clock += cost; },
    injected ? (callback) => override.push(callback) : undefined,
  );
  return { preparation, idle, messages, timers, channels, override, seen, records };
}

test("posted-task preparation is lazy, bounded, and closes both ports exactly once", async () => {
  const f = schedulerFixture();
  assert.equal(f.channels.length, 0);
  assert.equal(f.seen.length, 0);
  f.idle.shift()();
  assert.equal(f.seen.length, 24, "idle preparation still respects the record limit");
  const staleIdle = f.idle.shift();
  f.preparation.prioritize();
  f.preparation.prioritize();
  assert.equal(f.channels.length, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.seen.length, 24, "prioritization does no synchronous preparation");
  staleIdle();
  assert.equal(f.seen.length, 24);
  while (f.messages.length) {
    assert.equal(f.messages.length, 1, "only one active slice is queued");
    const before = f.seen.length;
    f.messages.shift()();
    assert.ok(f.seen.length - before <= 24);
  }
  await f.preparation.ready;
  assert.equal(f.preparation.prepared, true);
  assert.deepEqual(f.seen, f.records.map((record) => record.id));
  for (const port of [f.channels[0].port1, f.channels[0].port2]) {
    assert.equal(port.closed, true);
    assert.equal(port.closes, 1);
  }
  staleIdle();
  f.preparation.prioritize();
  assert.equal(f.seen.length, 53);
  assert.equal(f.channels.length, 1);
  assert.equal(f.messages.length, 0);
  assert.equal(f.timers.length, 0, "the available posted-task path does not use timers");
});

test("posted-task preparation also honors the four-millisecond slice limit", async () => {
  const f = schedulerFixture({ count: 19, cost: 1 });
  f.preparation.prioritize();
  while (f.messages.length) {
    const before = f.seen.length;
    f.messages.shift()();
    assert.ok(f.seen.length - before <= 4);
  }
  await f.preparation.ready;
  assert.deepEqual(f.seen, f.records.map((record) => record.id));
  assert.ok(f.channels[0].port1.closed && f.channels[0].port2.closed);
});

test("active preparation falls back to queued timers when MessageChannel is unavailable", async () => {
  const f = schedulerFixture({ channelAvailable: false });
  f.preparation.prioritize();
  f.preparation.prioritize();
  assert.equal(f.channels.length, 0);
  assert.equal(f.timers.length, 1);
  assert.equal(f.seen.length, 0);
  f.idle.shift()();
  assert.equal(f.seen.length, 0, "the pre-priority idle callback stays invalidated");
  while (f.timers.length) {
    assert.equal(f.timers.length, 1);
    const { callback, delay } = f.timers.shift();
    assert.equal(delay, 0);
    const before = f.seen.length;
    callback();
    assert.ok(f.seen.length - before <= 24);
  }
  await f.preparation.ready;
  f.preparation.prioritize();
  assert.deepEqual(f.seen, f.records.map((record) => record.id));
  assert.equal(f.timers.length, 0);
});

test("empty and idle-only catalogs resolve without creating a channel", async () => {
  for (const count of [0, 53]) {
    const f = schedulerFixture({ count });
    while (f.idle.length) f.idle.shift()();
    await f.preparation.ready;
    assert.equal(f.preparation.prepared, true);
    f.preparation.prioritize();
    assert.deepEqual(f.seen, f.records.map((record) => record.id));
    assert.equal(f.channels.length, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.timers.length, 0);
    assert.equal(f.idle.length, 0);
  }
});

test("an injected active scheduler overrides both channel and timer defaults", async () => {
  const f = schedulerFixture({ injected: true });
  f.preparation.prioritize();
  f.preparation.prioritize();
  assert.equal(f.override.length, 1);
  while (f.override.length) f.override.shift()();
  await f.preparation.ready;
  f.idle.shift()();
  assert.deepEqual(f.seen, f.records.map((record) => record.id));
  assert.equal(f.channels.length, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.timers.length, 0);
});
