import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resources } from "../src/data/resources.js";
import { createInitialTypeSet, matchesResource } from "../src/utils/geo.js";
import {
  normalizeSearch,
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
  assert.ok(find("wi").some((resource) => resource.city === "Wick"));
  assert.ok(find("wick").some((resource) => resource.city === "Wick"));
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
      .slice(0, 10)
      .every((resource) => resource.city === "London"),
  );
  assert.equal(find("London Road")[0].city, "Bedford");
  assert.equal(find("London Colney")[0].city, "London Colney");
});

test("exact street phrases beat scattered or merely prefixed words without hiding other matches", () => {
  for (const street of ["King Street", "High Street", "Bedford Road"]) {
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
