import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { installLiveSourceCountFixture } from "../scripts/qa-live-source-counts.mjs";

const host = "http://127.0.0.1:4175";
const endpoint = "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/Summer_Meals_Site_Finder_2026_(Testing)/FeatureServer/0/query";
const nearbyUrl = `${endpoint}?geometry=-75,40`;
const countUrl = `${endpoint}?returnCountOnly=true`;
function fixture(origin = host, mapData = {}) {
  const native = [], listeners = [];
  const context = vm.createContext({
    location: { origin, href: `${origin}/` }, navigator: {}, URL, Request, Response, DOMException, queueMicrotask,
    document: { addEventListener: (type, callback) => listeners.push({ type, callback }) },
    fetch: async (...args) => { native.push(args); const data = mapData[new URL(args[0], origin).pathname]; return new Response(data ? JSON.stringify(data) : "local"); },
  });
  context.window = context;
  vm.runInContext(`(${installLiveSourceCountFixture})(${JSON.stringify(host)})`, context);
  return { context, native, listeners, probe: context.__rwnLiveCountQA };
}

test("count browser fixture does not alter other origins", () => {
  const f = fixture("https://example.invalid");
  assert.equal(f.probe, undefined);
  assert.equal(f.context.navigator.geolocation, undefined);
  assert.equal(f.listeners.length, 0);
});

test("synthetic location uses fixed coordinates without asking a device", async () => {
  const f = fixture();
  let value;
  f.context.navigator.geolocation.getCurrentPosition(position => { value = position; });
  assert.equal(value, undefined, "success remains asynchronous like the browser API");
  await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(value.coords)), { latitude: 40, longitude: -75, accuracy: 1000 });
  assert.equal(f.probe.locationCalls, 1);
});

test("synthetic zero and nearby data are held until release and never reach the network", async () => {
  const f = fixture();
  let settled = false;
  const count = f.context.fetch(countUrl).then(async response => { settled = true; return response.json(); });
  const nearby = f.context.fetch(nearbyUrl).then(response => response.json());
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.native.length, 0);
  f.probe.release();
  assert.deepEqual(await count, { count: 0 });
  assert.deepEqual(await nearby, { features: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(f.probe.requests)), [{ kind: "count", geometry: null }, { kind: "nearby", geometry: "-75,40" }]);
});

test("browser fixture keeps positive national and nearby counts independent", async () => {
  const f = fixture();
  f.probe.scenario = { count: 100, nearby: 1 };
  const count = f.context.fetch(countUrl), nearby = f.context.fetch(nearbyUrl);
  f.probe.release();
  assert.deepEqual(await (await count).json(), { count: 100 });
  const features = (await (await nearby).json()).features;
  assert.equal(features.length, 1);
  assert.match(features[0].attributes.Site_Name, /^Synthetic QA/);
  assert.equal(f.native.length, 0);
});

test("source fixture failures are independent, immediate HTTP errors rather than zero", async () => {
  const f = fixture();
  f.probe.scenario = { countFailed: true, nearby: 0 };
  const count = f.context.fetch(countUrl), nearby = f.context.fetch(nearbyUrl);
  f.probe.release();
  assert.equal((await count).status, 400);
  assert.deepEqual(await (await nearby).json(), { features: [] });
  f.probe.scenario = { count: 200, nearbyFailed: true };
  const count2 = f.context.fetch(countUrl), nearby2 = f.context.fetch(nearbyUrl);
  f.probe.release();
  assert.deepEqual(await (await count2).json(), { count: 200 });
  assert.equal((await nearby2).status, 400);
});

test("aborting synthetic requests prevents a late release from settling success", async () => {
  const f = fixture();
  const controller = new AbortController();
  const pending = f.context.fetch(countUrl, { signal: controller.signal });
  controller.abort(); f.probe.release();
  await assert.rejects(pending, error => error.name === "AbortError");
  await assert.rejects(f.context.fetch(nearbyUrl, { signal: controller.signal }), error => error.name === "AbortError");
});

test("the fixture passes through local assets while blocking unexpected external requests", async () => {
  const f = fixture();
  assert.equal(await (await f.context.fetch("/src/app.js")).text(), "local");
  await assert.rejects(f.context.fetch("https://unexpected.example.invalid"), /External request blocked/);
  assert.equal(f.native.length, 1);
});

test("the fixture records trusted About location, Use and Clear activations", () => {
  const f = fixture();
  const click = f.listeners.find(listener => listener.type === "click").callback;
  for (const id of ["about", "locateMe", "clearLocation"]) {
    click({ isTrusted: true, target: { closest: () => ({ id: id === "about" ? "" : id, matches: () => id === "about" }) } });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(f.probe.clicks)), ["about", "locateMe", "clearLocation"].map(id => ({ id, trusted: true })));
});

for (const name of ["countries.geojson", "countries-detail.geojson"]) {
  test(`the isolated ${name} fixture retains the original U.S. feature byte-for-byte in JSON`, async () => {
    const data = JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url), "utf8"));
    const path = `/data/${name}`;
    const f = fixture(host, { [path]: data });
    const result = await (await f.context.fetch(path)).json();
    assert.equal(result.features.length, 1);
    assert.equal(JSON.stringify(result.features), JSON.stringify(data.features.filter(feature => feature.properties?.NAME === "United States of America")));
    assert.deepEqual({ ...result, features: [] }, { ...data, features: [] }, "all other GeoJSON fields remain unchanged");
    assert.deepEqual(JSON.parse(JSON.stringify(f.probe.geometryFilters)), [{ path, originalFeatures: data.features.length, retainedFeatures: 1 }]);
    assert.equal(f.native.length, 1, "the original local geometry response is the only data source");
  });
}

test("the map fixture fails closed rather than inventing or combining U.S. geometry", async () => {
  const path = "/data/countries.geojson";
  for (const features of [[], [{ properties: { NAME: "China" } }], Array(2).fill({ properties: { NAME: "United States of America" } })]) {
    const f = fixture(host, { [path]: { type: "FeatureCollection", features } });
    await assert.rejects(f.context.fetch(path), /exactly one unchanged U.S. geometry feature/);
  }
});
