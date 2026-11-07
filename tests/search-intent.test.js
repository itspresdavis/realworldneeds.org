import test from "node:test";
import assert from "node:assert/strict";
import { resources } from "../src/data/resources.js";
import {
  resourceSearchScore,
  resourceSearchText,
  createIndexedSearchMatcher,
} from "../src/utils/search.js";
const compact = (record) => ({ ...record, search: resourceSearchText(record) });
const matchers = [
  [resourceSearchScore, resources],
  [createIndexedSearchMatcher().score, resources.map(compact)],
];
for (const [score, records] of matchers) {
  const find = (query) =>
    records
      .filter((record) => score(record, query) >= 0)
      .sort(
        (a, b) =>
          score(b, query) - score(a, query) || a.name.localeCompare(b.name),
      );
  for (const [urgent, ordinary] of [
    ["shelter tonight Boston", "shelter Boston"],
    ["food today Boston MA", "food Boston MA"],
    ["albergue esta noche Boston", "albergue Boston"],
    ["duchas hoy Providence", "duchas Providence"],
    ["meals right now Boston", "meals Boston"],
  ])
    test(`time intent preserves candidates: ${urgent} (${score === resourceSearchScore ? "source" : "index"})`, () =>
      assert.deepEqual(
        find(urgent).map((r) => r.id),
        find(ordinary).map((r) => r.id),
      ));
  test(`generic food ranks practical food service ahead of restricted benefits (${score === resourceSearchScore ? "source" : "index"})`, () => {
    const results = find("food Boston MA");
    assert.ok(results.length);
    assert.ok(!results[0].id.includes("wic"));
    assert.ok(
      results.some((r) => /wic/i.test(r.name)),
      "benefits remain discoverable",
    );
  });
  test(`explicit meals exclude benefit-only and pantry-only records (${score === resourceSearchScore ? "source" : "index"})`, () => {
    const results = find("meals Boston MA");
    assert.ok(results.length);
    assert.ok(results.every((r) => !/wic/i.test(r.name)));
    assert.equal(results[0].kind, "direct");
  });
  test(`groceries keep evidenced grocery or pantry services (${score === resourceSearchScore ? "source" : "index"})`, () => {
    const results = find("groceries Boston");
    assert.ok(results.length);
    assert.ok(results.every((r) => !/wic/i.test(r.name)));
    assert.ok(
      results.some((r) => r.country === "United Kingdom"),
      "Boston ambiguity remains",
    );
  });
  test(`food benefits preserve WIC eligibility distinction (${score === resourceSearchScore ? "source" : "index"})`, () => {
    const results = find("food benefits Boston MA");
    assert.ok(results.some((r) => /wic/i.test(r.name)));
    assert.ok(
      results.every((r) => /wic|snap|benefit/i.test(resourceSearchText(r))),
    );
  });
}

const {
  loadPostalAreas,
  resolveSearchIntent,
  resourceMatchesIntent,
  resourceMatchesArea,
  replaceFoodIntent,
  distanceFromArea,
} = await import("../src/utils/search-intent.js");
const { postalAreas } = await import("../src/data/generated/postal-areas.js");
await loadPostalAreas(
  async () =>
    new Response(JSON.stringify({ schemaVersion: "1.0", areas: postalAreas })),
);
for (const [query, place, required, excluded] of [
  ["shelter tonight", "Boston MA", "pine-street-mens-inn", null],
  ["food today", "Boston MA", "rosies-place-boston", null],
  ["albergue esta noche", "Boston MA", "boston-night-center", null],
  ["meals", "Boston MA", "cardinal-medeiros-day", null],
  ["food", "Boston UK", null, "rosies-place-boston"],
  ["WIC", "Boston MA", "ma-wic-boston-medical-center-0", null],
  ["duchas hoy", "Providence RI", null, "pine-street-mens-inn"],
  ["shelter", "Rosarito Mexico", null, "pine-street-mens-inn"],
  ["food", "東京", null, "rosies-place-boston"],
  ["water", "Tijuana Mexico", null, "rosies-place-boston"],
])
  test(`independent need/place: ${query} / ${place}`, () => {
    const plan = resolveSearchIntent(query, place),
      rows = resources.filter(
        (r) =>
          resourceMatchesIntent(r, plan) &&
          resourceSearchScore(r, plan.query) >= 0,
      );
    if (required) assert.ok(rows.some((r) => r.id === required));
    if (excluded) assert.ok(!rows.some((r) => r.id === excluded));
    if (place === "東京") assert.deepEqual(rows, []);
  });

test("postal input preserves leading zeros and requires an explicit country/radius choice", () => {
  const initial = resolveSearchIntent("food 02108");
  assert.equal(initial.postal, "02108");
  assert.equal(initial.postalSupported, true);
  assert.equal(initial.area, null);
  assert.equal(initial.query, "food 02108");
  const chosen = resolveSearchIntent("food 02108", "", {
    postal: "02108",
    radius: 10,
  });
  assert.deepEqual(chosen.area.point, postalAreas["02108"]);
  assert.equal(chosen.area.country, "United States");
  assert.equal(chosen.query, "food");
  const rows = resources.filter(
    (r) =>
      resourceMatchesIntent(r, chosen) &&
      resourceSearchScore(r, chosen.query) >= 0,
  );
  assert.ok(rows.some((r) => r.id === "rosies-place-boston"));
  assert.ok(rows.every((r) => r.country === "United States"));
  assert.ok(!rows.some((r) => r.id === "bowery-mission"));
});
test("postal choices cannot survive changed, unsupported or conflicting location text", () => {
  for (const [query, selection] of [
    ["food 99999", { postal: "99999", radius: 10 }],
    ["food 02108", { postal: "02109", radius: 10 }],
    ["food 02108", { postal: "02108", radius: 250 }],
    ["food 02108 Mexico", { postal: "02108", radius: 10 }],
  ])
    assert.equal(resolveSearchIntent(query, "", selection).area, null);
  assert.equal(resolveSearchIntent("food 99999").postalSupported, false);
});
test("postal areas never invent provider coordinates or physical network coverage", () => {
  const area = resolveSearchIntent("02108", "", {
    postal: "02108",
    radius: 10,
  }).area;
  assert.equal(
    resourceMatchesArea(
      {
        kind: "locator",
        country: "United States",
        lat: area.point[0],
        lng: area.point[1],
        coverageNote: "Find help in California",
      },
      area,
    ),
    false,
  );
  assert.equal(
    resourceMatchesArea(
      {
        kind: "locator",
        country: "United States",
        coverageNote: "Nationwide official finder; check eligibility",
      },
      area,
    ),
    true,
  );
  assert.equal(
    resourceMatchesArea(
      {
        kind: "direct",
        country: "United States",
        address: "Address not published",
      },
      area,
    ),
    false,
  );
  const original = {
    kind: "direct",
    country: "United States",
    lat: null,
    lng: null,
    address: "Published entrance, Boston, MA 02108",
  };
  assert.equal(resourceMatchesArea(original, area), true);
  assert.equal(original.lat, null);
  assert.equal(original.lng, null);
  assert.equal(distanceFromArea(area.point, area.point), 0);
});
test("food choices retain the original place and time intent", () => {
  assert.equal(
    replaceFoodIntent("food tonight Boston", "meals"),
    "meals tonight Boston",
  );
  assert.equal(replaceFoodIntent("food 02108", "groceries"), "groceries 02108");
  assert.equal(
    replaceFoodIntent("food Boston", "food benefits"),
    "food benefits Boston",
  );
  assert.equal(replaceFoodIntent("food Boston", "unknown"), "food Boston");
});
test("manual geography excludes incidental street and provider mentions", () => {
  const plan = resolveSearchIntent("food", "Boston");
  assert.equal(
    resourceMatchesIntent(
      {
        name: "Boston Food",
        city: "Seattle",
        country: "United States",
        category: "food",
        address: "Boston Road, Seattle, WA 98101",
      },
      plan,
    ),
    false,
  );
  assert.equal(
    resourceMatchesIntent(
      {
        name: "Community food",
        city: "Boston",
        country: "United Kingdom",
        category: "food",
      },
      plan,
    ),
    true,
  );
});

test("optional postal fetch is bounded and failed requests can really retry", async () => {
  const module = await import("../src/utils/search-intent.js?retry-fixture");
  let calls = 0;
  await assert.rejects(
    module.loadPostalAreas(async () => {
      calls++;
      throw Error("fixture offline");
    }),
  );
  assert.equal(module.resolveSearchIntent("food 02108").postalStatus, "error");
  await module.loadPostalAreas(async (url, options) => {
    calls++;
    assert.equal(url, "/data/postal-areas.json");
    assert.equal(options.credentials, "same-origin");
    assert.ok(options.signal);
    return new Response(
      JSON.stringify({ schemaVersion: "1.0", areas: postalAreas }),
    );
  });
  assert.equal(calls, 2);
  assert.equal(module.resolveSearchIntent("food 02108").postalSupported, true);
});
for (const [label, response] of [
  [
    "wrong schema",
    () =>
      new Response(JSON.stringify({ schemaVersion: "99", areas: postalAreas })),
  ],
  [
    "declared oversized body",
    () => new Response("{}", { headers: { "Content-Length": "64001" } }),
  ],
  ["streamed oversized body", () => new Response("x".repeat(64001))],
  ["unavailable storage", () => new Response("{}", { status: 503 })],
  [
    "invalid coordinate",
    () =>
      new Response(
        JSON.stringify({
          schemaVersion: "1.0",
          areas: { ...postalAreas, "02108": [999, 999] },
        }),
      ),
  ],
])
  test(`postal lookup rejects ${label}`, async () => {
    const module = await import(
      `../src/utils/search-intent.js?${encodeURIComponent(label)}`
    );
    await assert.rejects(module.loadPostalAreas(async () => response()));
    assert.equal(module.resolveSearchIntent("02108").postalSupported, false);
    assert.equal(module.resolveSearchIntent("02108").area, null);
  });
