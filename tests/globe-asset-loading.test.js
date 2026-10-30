import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const between = (start, end) => {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
  return app.slice(first, last);
};
const geometrySource = between("function loadLandGeometry()", "function bindEvents()");
const imageSource = between("function loadEarthImagery()", "function loadDetailEarthImagery()");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const feature = { properties: { NAME: "United Kingdom" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };

function fixture({ renderer = null } = {}) {
  const requests = [], images = [], notices = [], effects = [], timers = new Map();
  const context = vm.createContext({
    state: { countryFeatures: [], landRings: [], userLocation: null },
    landGeometryReady: false, landGeometryPromise: null, earthTextureImage: null, earthTextureRequested: false,
    globeRenderer: renderer, globeSurface: null, AbortController,
    Promise, console: { error() {}, warn() {} },
    setTimeout(callback, ms) { const id = {}; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, { signal }) {
      const pending = deferred();
      const request = { url, signal, ...pending }; requests.push(request);
      signal.addEventListener("abort", () => pending.reject(new Error("Aborted")), { once: true });
      return pending.promise;
    },
    Image: class { constructor() { images.push(this); } },
    extractRings: geometry => geometry.coordinates,
    rebuildCountryBorders: () => effects.push("borders"),
    updateGlobeLandMask: () => effects.push("mask"),
    wakeGlobe: () => effects.push("frame"),
    refreshGlobeSurface: () => effects.push("surface"),
    selectedResource: () => null,
    notify: message => notices.push(message),
  });
  vm.runInContext(geometrySource + imageSource, context);
  return { context, requests, images, notices, effects, timers };
}

for (const supported of [false, true]) {
  test(`homepage starts map downloads only when WebGL ${supported ? "works" : "fails: no downloads"}`, () => {
    const f = fixture();
    Object.assign(f.context, {
      shell() {}, renderStatic() {}, updateFilters() {}, warmSearchIndex() {}, resources: [],
      bindEvents() {}, writeFinderHistory() {}, initThreeGlobe: () => supported,
    });
    vm.runInContext(between("shell();\nrenderStatic();", "if (requestedResource && requestedResource === initialResource)"), f.context);
    assert.equal(f.requests.length, supported ? 1 : 0);
    assert.equal(f.images.length, supported ? 1 : 0);
    assert.doesNotMatch(index, /<link[^>]+(?:preload|prefetch)[^>]+earth-blue-marble/);
  });
}

test("country lookup shares one download, retains parsed data, and skips GPU work in fallback", async () => {
  const f = fixture();
  const first = f.context.loadLandGeometry(), second = f.context.loadLandGeometry();
  assert.equal(first, second);
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ ok: true, json: async () => ({ features: [feature] }) });
  assert.equal(await first, true);
  assert.equal(f.context.state.countryFeatures[0], feature);
  assert.equal(f.context.state.landRings.length, 1);
  assert.equal(await f.context.loadLandGeometry(), true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.effects, []);
});

test("a working renderer receives country borders and its land mask", async () => {
  const f = fixture({ renderer: {} });
  const result = f.context.loadLandGeometry();
  f.requests[0].resolve({ ok: true, json: async () => ({ features: [feature] }) });
  assert.equal(await result, true);
  assert.deepEqual(f.effects, ["borders", "mask", "frame"]);
});

for (const phase of ["headers", "body"]) {
  test(`a stalled country ${phase} aborts within the bound and a later request can recover`, async () => {
    const f = fixture();
    const result = f.context.loadLandGeometry();
    if (phase === "body") {
      const body = deferred();
      f.requests[0].signal.addEventListener("abort", () => body.reject(new Error("Body aborted")), { once: true });
      f.requests[0].resolve({ ok: true, json: () => body.promise });
      await Promise.resolve();
    }
    const timer = [...f.timers.values()][0];
    assert.equal(timer.ms, 8000);
    timer.callback();
    assert.equal(await result, false);
    assert.equal(f.requests[0].signal.aborted, true);
    assert.equal(f.timers.size, 0);
    assert.equal(f.context.landGeometryReady, false);
    assert.equal(f.notices.length, 1);
    const retry = f.context.loadLandGeometry();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve({ ok: true, json: async () => ({ features: [feature] }) });
    assert.equal(await retry, true);
  });
}

for (const response of [{ ok: false, status: 503 }, { ok: true, json: async () => ({ features: [] }) }]) {
  test(`bad country data (${response.status || "empty"}) does not become a successful cached result`, async () => {
    const f = fixture();
    const result = f.context.loadLandGeometry(); f.requests[0].resolve(response);
    assert.equal(await result, false);
    assert.equal(f.context.landGeometryReady, false);
    assert.equal(f.context.state.countryFeatures.length, 0);
    assert.equal(f.timers.size, 0);
  });
}

test("Earth imagery shares pending and completed requests but allows recovery from image failure", async () => {
  const f = fixture();
  f.context.loadEarthImagery(); f.context.loadEarthImagery();
  assert.equal(f.images.length, 1);
  f.images[0].onerror();
  f.context.loadEarthImagery();
  assert.equal(f.images.length, 2);
  await f.images[1].onload();
  assert.equal(f.context.earthTextureImage, f.images[1]);
  f.context.loadEarthImagery();
  assert.equal(f.images.length, 2);
  assert.deepEqual(f.effects, ["surface"]);
});

test("successful map recovery after initial failure starts previously unused assets", () => {
  const f = fixture();
  Object.assign(f.context, {
    globeCanvasElement: {}, resetGlobeContextResources() {}, globeContextLost: true, globeUnavailableReported: true,
    globeStageElement: { classList: { remove() {} } }, document: { getElementById: () => ({}) },
    initThreeGlobe: () => true, globeRenderer: { getContext: () => ({ isContextLost: () => false }) },
    syncGlobePointLayer() {}, reportGlobeUnavailable: () => assert.fail("recovery unexpectedly failed"),
  });
  vm.runInContext(between("function recoverGlobeContext()", "function renderThreeGlobe("), f.context);
  f.context.recoverGlobeContext();
  assert.equal(f.requests.length, 1); assert.equal(f.images.length, 1);
  assert.equal(f.context.globeContextLost, false);
  assert.deepEqual(f.notices, ["Interactive map restored"]);
});

test("fallback navigation cannot start detailed country downloads", async () => {
  const f = fixture();
  vm.runInContext(between("async function loadDetailGeometry()", "function loadLandGeometry()"), f.context);
  await f.context.loadDetailGeometry();
  assert.equal(f.requests.length, 0);
  assert.equal(f.context.state.detailGeometryRequested, undefined, "a later working renderer may still request detail");
});

for (const outcome of ["success", "failure", "timeout"]) test(`base imagery waits for the initial land mask and still publishes after geometry ${outcome}`, async () => {
  const f = fixture({ renderer: {} });
  f.context.loadEarthImagery();
  const geometry = f.context.loadLandGeometry();
  const promoted = f.images[0].onload();
  await Promise.resolve();
  assert.equal(f.context.earthTextureImage, null, "loaded imagery must not publish an unmasked intermediate ocean");
  assert.deepEqual(f.effects, []);
  f.context.loadEarthImagery();
  assert.equal(f.context.loadLandGeometry(), geometry);
  assert.equal(f.images.length, 1); assert.equal(f.requests.length, 1);
  if (outcome === "success") f.requests[0].resolve({ ok: true, json: async () => ({ features: [feature] }) });
  else if (outcome === "failure") f.requests[0].resolve({ ok: false, status: 503 });
  else {
    const timer = [...f.timers.values()][0];
    assert.equal(timer.ms, 8000);
    timer.callback();
  }
  await promoted;
  assert.equal(await geometry, outcome === "success");
  assert.equal(f.context.earthTextureImage, f.images[0], "failed map data must not prevent independent imagery fallback");
  assert.deepEqual(f.effects, outcome === "success" ? ["borders", "mask", "frame", "surface"] : ["surface"]);
  assert.equal(f.images.length, 1); assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
  f.context.loadEarthImagery();
  assert.equal(f.images.length, 1, "promotion must retain the completed image cache");
  if (outcome !== "success") {
    const retry = f.context.loadLandGeometry();
    f.requests[1].resolve({ ok: true, json: async () => ({ features: [feature] }) });
    assert.equal(await retry, true);
    assert.equal(f.images.length, 1, "country recovery must not refetch successful imagery");
  }
});
