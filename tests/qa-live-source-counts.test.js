import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { assertLiveSourceGlobeReady, countryStateProbeSource, installLiveSourceCountFixture, withCountryStateProbe } from "../scripts/qa-live-source-counts.mjs";

const host = "http://127.0.0.1:4175";
const endpoint = "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/Summer_Meals_Site_Finder_2026_(Testing)/FeatureServer/0/query";
const nearbyUrl = `${endpoint}?geometry=-75,40`;
const countUrl = `${endpoint}?returnCountOnly=true`;
function fixture(origin = host, mapData = {}) {
  const native = [], listeners = [];
  const context = vm.createContext({
    location: { origin, href: `${origin}/` }, navigator: {}, URL, Request, Response, ReadableStream, TextEncoder, DOMException, queueMicrotask,
    document: { addEventListener: (type, callback) => listeners.push({ type, callback }) },
    fetch: async (...args) => { native.push(args); const data = mapData[new URL(args[0], origin).pathname]; return new Response(typeof data === "string" ? data : data ? JSON.stringify(data) : "local"); },
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

test("synthetic locations use explicit fixed coordinates without asking a device", async () => {
  const f = fixture();
  let value;
  f.context.navigator.geolocation.getCurrentPosition(position => { value = position; });
  assert.equal(value, undefined, "success remains asynchronous like the browser API");
  await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(value.coords)), { latitude: 40, longitude: -75, accuracy: 1000 });
  assert.equal(f.probe.locationCalls, 1);
  f.probe.position = { latitude: 51.5, longitude: -0.12 };
  f.context.navigator.geolocation.getCurrentPosition(position => { value = position; });
  f.probe.position = { latitude: 0, longitude: 0 };
  await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(value.coords)), { latitude: 51.5, longitude: -0.12, accuracy: 1000 }, "an outstanding fixture request retains its original synthetic position");
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
  assert.deepEqual(JSON.parse(JSON.stringify(f.probe.requests.map(({ kind, geometry }) => ({ kind, geometry })))), [{ kind: "count", geometry: null }, { kind: "nearby", geometry: "-75,40" }]);
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

test("malformed national counts and truncated nearby envelopes retain their source meaning", async () => {
  const f = fixture();
  f.probe.scenario = { count: null, nearby: 1, nearbyTruncated: true };
  const count = f.context.fetch(countUrl), nearby = f.context.fetch(nearbyUrl);
  f.probe.release();
  assert.deepEqual(await (await count).json(), { count: null }, "the fixture must not coerce malformed counts into zero");
  const payload = await (await nearby).json();
  assert.equal(payload.exceededTransferLimit, true);
  assert.equal(payload.features.length, 1);
  assert.equal(payload.features[0].attributes.Start_date, undefined, "unknown source dates stay omitted, not fabricated");
  assert.equal(payload.features[0].attributes.End_date, undefined);
  assert.equal(f.native.length, 0);
});

test("each response retains its own scenario across delayed headers and replacement requests", async () => {
  const f = fixture();
  f.probe.scenario = { count: 100, nearby: 2 };
  const oldCount = f.context.fetch(countUrl), oldNearby = f.context.fetch(nearbyUrl);
  f.probe.scenario = { count: 202, nearby: 1 };
  let oldSettled = false;
  oldCount.then(() => { oldSettled = true; });
  const replacementCount = f.context.fetch(countUrl), replacementNearby = f.context.fetch(nearbyUrl);
  f.probe.release([2, 3]);
  assert.deepEqual(await (await replacementCount).json(), { count: 202 });
  assert.equal((await (await replacementNearby).json()).features.length, 1);
  assert.equal(oldSettled, false, "releasing new request IDs must leave old headers pending");
  f.probe.release([0, 1]);
  assert.deepEqual(await (await oldCount).json(), { count: 100 });
  assert.equal((await (await oldNearby).json()).features.length, 2);
});

test("real streamed response headers can arrive while JSON remains pending until body release", async () => {
  const f = fixture();
  f.probe.scenario = { count: 100, nearby: 1, countBodyPending: true };
  const countHeaders = f.context.fetch(countUrl), nearbyHeaders = f.context.fetch(nearbyUrl);
  f.probe.release();
  const response = await countHeaders;
  assert.ok(response instanceof Response);
  assert.ok(response.body instanceof ReadableStream);
  assert.equal(response.status, 200);
  assert.equal(f.probe.requests[0].headersReleased, true);
  assert.equal(f.probe.requests[0].bodyPending, true);
  let settled = false;
  const body = response.json().then(value => { settled = true; return value; });
  assert.equal((await (await nearbyHeaders).json()).features.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "nearby success must not finish the pending count stream");
  f.probe.releaseBodies([0]);
  assert.deepEqual(await body, { count: 100 });
  assert.equal(f.probe.requests[0].bodyPending, false);
  assert.equal(f.probe.requests[0].bodyReleased, true);
});

test("aborting after real headers errors the pending body and late release cannot restore success", async () => {
  const f = fixture();
  f.probe.scenario = { count: 31337, countBodyPending: true };
  const controller = new AbortController();
  const headers = f.context.fetch(countUrl, { signal: controller.signal });
  f.probe.release();
  const body = (await headers).json();
  controller.abort();
  await assert.rejects(body, error => error.name === "AbortError");
  assert.equal(f.probe.requests[0].aborted, true);
  assert.equal(f.probe.requests[0].bodyPending, false);
  assert.equal(f.probe.requests[0].bodyReleased, false);
  f.probe.scenario = { count: 202 };
  const replacement = f.context.fetch(countUrl);
  f.probe.release([1]);
  assert.deepEqual(await (await replacement).json(), { count: 202 });
  f.probe.releaseBodies([0]);
  assert.equal(f.probe.requests[0].bodyReleaseAttempts, 1);
  assert.equal(f.probe.requests[0].bodyReleased, false, "late release remains an inert attempt after abort");
  assert.equal(f.native.length, 0);
});

test("auto-release retries expose a fresh pending real body and retain independent success", async () => {
  const f = fixture();
  f.probe.scenario = { count: 999, nearby: 1, countBodyPending: true, autoHeaders: true };
  assert.equal((await (await f.context.fetch(nearbyUrl)).json()).features.length, 1);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const response = await f.context.fetch(countUrl, { signal: controller.signal });
    const body = response.json();
    assert.equal(f.probe.requests.at(-1).headersReleased, true);
    assert.equal(f.probe.requests.at(-1).bodyPending, true);
    controller.abort();
    await assert.rejects(body, error => error.name === "AbortError");
  }
  f.probe.releaseBodies();
  const attempts = f.probe.requests.filter(request => request.kind === "count");
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every(request => request.aborted && !request.bodyReleased && !request.bodyPending));
  f.probe.scenario = { count: 203, autoHeaders: true };
  assert.deepEqual(await (await f.context.fetch(countUrl)).json(), { count: 203 });
  assert.equal(f.native.length, 0);
});

test("success, abort and stream cancellation clean up fixture transport listeners", async () => {
  for (const finish of ["success", "abort", "cancel"]) {
    const f = fixture();
    f.probe.scenario = { count: 100, countBodyPending: true };
    const controller = new AbortController(), signal = controller.signal;
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    let listeners = 0;
    signal.addEventListener = (...args) => { listeners += 1; return add(...args); };
    signal.removeEventListener = (...args) => { listeners -= 1; return remove(...args); };
    const pending = f.context.fetch(countUrl, { signal });
    f.probe.release();
    const response = await pending;
    assert.equal(listeners, 1, "headers must not remove the body abort listener");
    if (finish === "cancel") {
      await response.body.cancel();
      assert.equal(f.probe.requests[0].bodyCanceled, true);
    } else {
      const body = response.json();
      if (finish === "success") {
        f.probe.releaseBodies();
        assert.deepEqual(await body, { count: 100 });
      } else {
        controller.abort();
        await assert.rejects(body, error => error.name === "AbortError");
      }
    }
    assert.equal(listeners, 0);
    f.probe.releaseBodies();
    assert.equal(listeners, 0, "a late release cannot clean up twice");
  }
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
  test(`the complete ${name} fixture preserves original map bytes and country order`, async () => {
    const bytes = await readFile(new URL(`../public/data/${name}`, import.meta.url), "utf8");
    const data = JSON.parse(bytes);
    const path = `/data/${name}`;
    const f = fixture(host, { [path]: bytes });
    f.probe.releaseDetail();
    const result = await (await f.context.fetch(path)).text();
    assert.equal(result, bytes);
    assert.ok(data.features.length > 1);
    assert.ok(data.features.some(feature => feature.properties.NAME === "China"));
    assert.ok(data.features.some(feature => feature.properties.NAME === "United States of America"));
    assert.deepEqual(JSON.parse(JSON.stringify(f.probe.geometryLoads)), [{ path, features: data.features.length }]);
    assert.equal(f.native.length, 1, "the original local geometry response is the only data source");
  });
}

test("the fixture holds detailed geometry until coarse-country evidence is captured", async () => {
  const path = "/data/countries-detail.geojson";
  const bytes = await readFile(new URL(`../public${path}`, import.meta.url), "utf8");
  const f = fixture(host, { [path]: bytes });
  let settled = false;
  const pending = f.context.fetch(path).then(response => { settled = true; return response.text(); });
  for (let attempt = 0; attempt < 1000 && !f.probe.geometryLoads.length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.probe.geometryLoads.length, 1, "the real detailed response arrived");
  assert.equal(settled, false);
  f.probe.releaseDetail();
  assert.equal(await pending, bytes, "release does not edit the response");
  assert.equal(f.probe.detailReleased, true);
});

test("the CI country observer exposes frozen primitive snapshots without a setter", () => {
  const context = vm.createContext({ window: { __rwnLiveCountQA: {} } });
  vm.runInContext(`const state = { countryFeatures: [{}, {}], detailCountryFeatures: [], detailGeometryReady: false, userCountry: null }; ${countryStateProbeSource}`, context);
  const first = context.window.__rwnLiveCountQA.countryState;
  assert.deepEqual(JSON.parse(JSON.stringify(first)), { coarseFeatures: 2, detailFeatures: 0, detailGeometryReady: false, userCountry: null });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.getOwnPropertyDescriptor(context.window.__rwnLiveCountQA, "countryState").set, undefined);
  assert.throws(() => vm.runInContext('"use strict"; window.__rwnLiveCountQA.countryState = {};', context), /getter|read only/);
  assert.throws(() => vm.runInContext('"use strict"; window.__rwnLiveCountQA.countryState.userCountry = "China";', context), /read only/);
  vm.runInContext('state.detailCountryFeatures = [{}, {}, {}]; state.detailGeometryReady = true; state.userCountry = "United States";', context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.__rwnLiveCountQA.countryState)), { coarseFeatures: 2, detailFeatures: 3, detailGeometryReady: true, userCountry: "United States" });
  assert.equal(first.userCountry, null, "an old snapshot cannot become a live mutable state reference");
  assert.doesNotThrow(() => vm.runInNewContext(countryStateProbeSource, { window: {} }), "the observer stays inert without the explicit fixture");
});

for (const fails of [false, true]) {
  test(`temporary CI instrumentation restores exact original bytes after ${fails ? "failure" : "success"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "rwn-country-probe-test-"));
    const path = join(directory, "app.js");
    const original = Buffer.from("// Untouched generated-module fixture.\nconst state = {};\n");
    await writeFile(path, original);
    try {
      const run = () => withCountryStateProbe(async () => {
        const temporary = await readFile(path, "utf8");
        assert.equal(temporary, original.toString() + countryStateProbeSource);
        if (fails) throw new Error("Synthetic verifier failure");
        return "complete";
      }, path);
      if (fails) await assert.rejects(run, /Synthetic verifier failure/);
      else assert.equal(await run(), "complete");
      assert.deepEqual(await readFile(path), original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("ordinary production source and build output contain no CI country observer", async () => {
  for (const path of ["../src/app.js", "../dist/src/app.js"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /__rwnLiveCountQA|countryStateProbeSource/);
  }
});


test("complete-geometry QA fails explicitly on unsupported, pending, hidden or inconsistent globe startup", () => {
  assert.doesNotThrow(() => assertLiveSourceGlobeReady({ globeStartup: "ready", globeFallbackVisible: false }));
  for (const snapshot of [
    { globeStartup: "unavailable", globeFallbackVisible: true },
    { globeStartup: "loading", globeFallbackVisible: false },
    { globeStartup: "ready", globeFallbackVisible: true },
    {},
  ]) assert.throws(() => assertLiveSourceGlobeReady(snapshot), /requires initialized WebGL/);
});
