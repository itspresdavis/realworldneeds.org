import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUsdaActiveCountUrl,
  buildUsdaNearbyUrl,
  fetchNearbyUsdaSites,
  fetchUsdaActiveCount,
  resetUsdaCircuitForTests,
  roundedSearchPoint,
  sourceRegistry,
  usdaFeatureToResource
} from "../src/data/live-sources.js";

const feature = {
  attributes: {
    FID: 42,
    MasterID: "official-site-42",
    Site_Name: "Central Library Meals",
    Site_Address1: "100 Main St",
    Site_Address2: "Community Room",
    Site_City: "Boston",
    Site_State: "MA",
    Site_Zip: "02108",
    Site_Phone: "(617) 555-0100",
    Start_date: Date.UTC(2026, 5, 15),
    End_date: Date.UTC(2026, 7, 21),
    Days_of_operation: "M,T,W,TH,F",
    Breakfast_Time2: "00:00-00:00",
    Lunch_Time2: "11:30-13:00",
    Snack_Time_AM2: null,
    Snack_Time_PM2: "15:00-15:30",
    Dinner_Supper_Time2: null,
    Service_Model: "CONGREGATE",
    Score: 100
  },
  geometry: { x: -71.0589, y: 42.3601 }
};

test("USDA nearby queries use active dates and a deliberately rounded search point", () => {
  assert.deepEqual(roundedSearchPoint({ lat: 42.360123, lng: -71.058999 }), { lat: 42.4, lng: -71.1 });
  const url = buildUsdaNearbyUrl({ lat: 42.360123, lng: -71.058999 }, "2026-08-05");
  const geometry = JSON.parse(url.searchParams.get("geometry"));
  assert.deepEqual({ x: geometry.x, y: geometry.y }, { x: -71.1, y: 42.4 });
  assert.equal(url.searchParams.get("distance"), "160");
  assert.match(url.searchParams.get("where"), /Start_date <= timestamp '2026-08-05 23:59:59'/);
  assert.match(url.searchParams.get("where"), /End_date >= timestamp '2026-08-05 00:00:00'/);
  assert.doesNotMatch(url.toString(), /42\.360123|-71\.058999/);
});

test("USDA official features preserve address, service times, dates, eligibility, and provenance", () => {
  const resource = usdaFeatureToResource(feature, "2026-08-05");
  assert.equal(resource.id, "usda-summer-2026-official-site-42");
  assert.equal(resource.address, "100 Main St, Community Room, Boston, MA, 02108");
  assert.match(resource.hours, /Mon, Tue, Wed, Thu, Fri/);
  assert.match(resource.hours, /Lunch 11:30-13:00/);
  assert.doesNotMatch(resource.hours, /00:00-00:00/);
  assert.equal(resource.validFrom, "2026-06-15");
  assert.equal(resource.validThrough, "2026-08-21");
  assert.equal(resource.locationPrecision, "exact");
  assert.equal(resource.costModel, "free-eligible");
  assert.equal(resource.verificationMethod, "live-official-feed");
  assert.match(resource.eligibility, /18 and younger/);
});

test("official live fetch helpers validate source payloads", async () => {
  resetUsdaCircuitForTests();
  const responses = [
    { count: 17442 },
    { features: [feature] }
  ];
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const body = responses.shift();
    return { ok: true, status: 200, json: async () => body };
  };
  assert.equal(await fetchUsdaActiveCount({ date: "2026-08-05", fetchImpl }), 17442);
  const nearby = await fetchNearbyUsdaSites({ lat: 42.36, lng: -71.06 }, { date: "2026-08-05", fetchImpl });
  assert.equal(nearby.length, 1);
  assert.match(requested[0], new RegExp(buildUsdaActiveCountUrl("2026-08-05").origin));
});

test("transient live-source failures retry and recover", async () => {
  resetUsdaCircuitForTests();
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ count: 17442 }) };
  };

  assert.equal(await fetchUsdaActiveCount({ date: "2026-08-05", fetchImpl }), 17442);
  assert.equal(attempts, 2);
});

test("non-retryable live-source failures fail immediately", async () => {
  resetUsdaCircuitForTests();
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { ok: false, status: 404, json: async () => ({}) };
  };

  await assert.rejects(() => fetchUsdaActiveCount({ date: "2026-08-05", fetchImpl }), /404/);
  assert.equal(attempts, 1);
});

test("source registry makes audit counts and refresh modes explicit", () => {
  assert.ok(sourceRegistry.length >= 4);
  assert.equal(sourceRegistry.find((source) => source.id === "usda-summer-meals-2026").activeRecordsAtAudit, 17442);
  assert.equal(sourceRegistry.find((source) => source.id === "massachusetts-wic-locations").recordCount, 101);
  assert.equal(sourceRegistry.find((source) => source.id === "new-york-wic-sites").recordCount, 293);
  assert.equal(sourceRegistry.find((source) => source.id === "trussell-food-bank-centres").recordCount, 1);
  assert.ok(sourceRegistry.every((source) => source.sourceUrl.startsWith("https://")));
});
