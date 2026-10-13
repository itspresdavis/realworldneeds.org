import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/data/live-sources.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const response = data => ({ ok: true, status: 200, json: async () => data });
const point = { lat: 42.36, lng: -71.06 };
const feature = {
  attributes: { FID: 42, MasterID: "official-site-42", Site_Name: "Synthetic meal site", Site_City: "Boston", Site_State: "MA", Site_Address1: "1 Example Street", Start_date: Date.UTC(2026, 5, 15), End_date: Date.UTC(2026, 7, 21), Score: 100 },
  geometry: { x: -71.06, y: 42.36 },
};
const options = fetchImpl => ({ date: "2026-08-05", fetchImpl });
const track = promise => {
  const state = { status: "pending" };
  promise.then(value => Object.assign(state, { status: "fulfilled", value }), error => Object.assign(state, { status: "rejected", error }));
  return state;
};
function fixture() {
  let now = Date.UTC(2026, 9, 13), nextId = 0;
  const timers = new Map();
  class ClockDate extends Date { static now() { return now; } }
  const context = vm.createContext({ URL, AbortController, DOMException, Date: ClockDate,
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source.replace(/^export /gm, "") + "\nglobalThis.api = {fetchUsdaActiveCount, fetchNearbyUsdaSites, usdaFeatureToResource, resetUsdaCircuitForTests}; globalThis.circuit = usdaCircuit;", context);
  const advance = async ms => {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = target; await flush();
  };
  return { api: context.api, circuit: context.circuit, context, timers, advance };
}
function callerSignal() {
  const caller = new AbortController(), listeners = new Set();
  const add = caller.signal.addEventListener.bind(caller.signal), remove = caller.signal.removeEventListener.bind(caller.signal);
  caller.signal.addEventListener = (type, fn, ...args) => { if (type === "abort") listeners.add(fn); return add(type, fn, ...args); };
  caller.signal.removeEventListener = (type, fn, ...args) => { if (type === "abort") listeners.delete(fn); return remove(type, fn, ...args); };
  return { caller, listeners };
}

for (const phase of ["headers", "body"]) {
  test(`uncooperative ${phase} settles by the unchanged 22-second whole-request budget`, async () => {
    const f = fixture(), { caller, listeners } = callerSignal(), transports = [], pending = [];
    const state = track(f.api.fetchUsdaActiveCount({ ...options(async (_, { signal }) => {
      transports.push(signal); const d = deferred(); pending.push(d);
      return phase === "headers" ? d.promise : { ok: true, json: () => d.promise };
    }), signal: caller.signal }));
    await flush(); await f.advance(21999);
    assert.equal(state.status, "pending"); assert.equal(transports.length, 3);
    await f.advance(1);
    assert.equal(state.status, "rejected"); assert.match(state.error.message, /time|deadline/i);
    assert.ok(transports.every(signal => signal.aborted)); assert.equal(f.circuit.failures, 1);
    assert.equal(f.timers.size, 0); assert.equal(listeners.size, 0);
    pending[0].resolve(phase === "headers" ? response({ count: 99 }) : { count: 99 });
    pending[1].reject(new Error("late rejection")); pending[2].resolve(phase === "headers" ? response({ count: 99 }) : { count: 99 });
    await flush(); assert.equal(state.status, "rejected"); assert.equal(f.circuit.failures, 1);
  });
}

test("a body arriving immediately before its deadline succeeds and cleans up", async () => {
  const f = fixture(), body = deferred(), { caller, listeners } = callerSignal();
  const state = track(f.api.fetchUsdaActiveCount({ ...options(async () => ({ ok: true, json: () => body.promise })), signal: caller.signal }));
  await flush(); assert.equal(f.timers.size, 1); await f.advance(6999);
  body.resolve({ count: 7 }); await flush(); assert.equal(state.value, 7);
  assert.equal(f.timers.size, 0); assert.equal(listeners.size, 0);
  await f.advance(10000); assert.equal(state.status, "fulfilled");
});

for (const phase of ["before", "headers", "body", "first-backoff", "second-backoff"]) {
  test(`caller cancellation during ${phase} settles promptly without a source failure`, async () => {
    const f = fixture(), { caller, listeners } = callerSignal(), pending = deferred(), signals = []; let calls = 0;
    f.circuit.failures = 1;
    if (phase === "before") caller.abort();
    const state = track(f.api.fetchUsdaActiveCount({ ...options(async (_, { signal }) => {
      calls++; signals.push(signal);
      if (phase.endsWith("backoff")) return { ok: false, status: 503 };
      return phase === "body" ? { ok: true, json: () => pending.promise } : pending.promise;
    }), signal: caller.signal }));
    await flush(); if (phase === "second-backoff") await f.advance(250);
    caller.abort(); await flush();
    assert.equal(state.status, "rejected"); assert.equal(state.error.name, "AbortError");
    assert.equal(calls, phase === "before" ? 0 : phase === "second-backoff" ? 2 : 1);
    assert.ok(signals.every(signal => signal.aborted || phase.endsWith("backoff")));
    assert.equal(f.timers.size, 0); assert.equal(listeners.size, 0); assert.equal(f.circuit.failures, 1);
    pending.resolve(phase === "headers" ? response({ count: 123 }) : { count: 123 }); await flush();
    await f.advance(60000); assert.equal(f.circuit.failures, 1);
  });
}

for (const arcgis of [false, true]) {
  for (const status of [400, 403, 404, 408, 425, 429, 500, 503]) {
    test(`${arcgis ? "ArcGIS" : "HTTP"} ${status} keeps bounded retry and denial policy`, async () => {
      const f = fixture(); let calls = 0;
      const state = track(f.api.fetchUsdaActiveCount(options(async () => {
        calls++; return arcgis ? response({ error: { code: status, message: "Synthetic failure" } }) : { ok: false, status };
      })));
      await flush(); await f.advance(1000);
      assert.equal(state.status, "rejected"); assert.equal(calls, status >= 408 ? 3 : 1);
      assert.equal(f.circuit.failures, 1); assert.equal(f.timers.size, 0);
    });
  }
}

test("transient retries can recover with valid zero and reset the shared circuit", async () => {
  const f = fixture(); let calls = 0; f.circuit.failures = 2;
  const state = track(f.api.fetchUsdaActiveCount(options(async () => ++calls < 3 ? { ok: false, status: 503 } : response({ count: 0 }))));
  await flush(); await f.advance(1000);
  assert.equal(state.value, 0); assert.equal(calls, 3); assert.equal(f.circuit.failures, 0); assert.equal(f.timers.size, 0);
});

for (const [label, count] of [["missing", undefined], ["null", null], ["blank", ""], ["whitespace", " "], ["numeric string", "7"], ["false", false], ["true", true], ["array", []], ["object", {}], ["NaN", NaN], ["infinite", Infinity], ["negative", -1], ["fraction", 1.5], ["unsafe", Number.MAX_SAFE_INTEGER + 1]]) {
  test(`invalid count ${label} fails once without retry or false source success`, async () => {
    const f = fixture(); let calls = 0; f.circuit.failures = 1;
    const state = track(f.api.fetchUsdaActiveCount(options(async () => { calls++; return response({ count }); })));
    await flush(); assert.equal(state.status, "rejected"); assert.equal(calls, 1); assert.equal(f.circuit.failures, 2); assert.equal(f.timers.size, 0);
  });
}
for (const count of [0, 7, Number.MAX_SAFE_INTEGER]) {
  test(`numeric safe count ${count} succeeds`, async () => {
    const f = fixture(); f.circuit.failures = 2;
    assert.equal(await f.api.fetchUsdaActiveCount(options(async () => response({ count }))), count);
    assert.equal(f.circuit.failures, 0);
  });
}

test("semantic failures trip the shared circuit and cancellation cannot reset it", async () => {
  const f = fixture(); let calls = 0;
  for (let i = 0; i < 3; i++) {
    await assert.rejects(f.api.fetchUsdaActiveCount(options(async () => { calls++; return response({ count: null }); })));
    assert.equal(f.circuit.failures, i + 1);
  }
  await assert.rejects(f.api.fetchNearbyUsdaSites(point, options(async () => { calls++; return response({ features: [] }); })), error => error.code === "RWN_SOURCE_CIRCUIT_OPEN");
  assert.equal(calls, 3);
  const caller = new AbortController(); caller.abort();
  await assert.rejects(f.api.fetchUsdaActiveCount({ ...options(async () => { calls++; return response({ count: 0 }); }), signal: caller.signal }), error => error.name === "AbortError");
  assert.equal(calls, 3); assert.equal(f.circuit.failures, 3);
  await f.advance(60000);
  assert.equal(await f.api.fetchUsdaActiveCount(options(async () => response({ count: 0 }))), 0);
  assert.equal(f.circuit.failures, 0);
});

for (const [label, data] of [["null", null], ["array", []], ["string", "bad"], ["missing features", {}], ["null features", { features: null }], ["object features", { features: {} }], ["transfer limit", { features: [feature], exceededTransferLimit: true }], ["malformed transfer flag", { features: [], exceededTransferLimit: "false" }], ["malformed error", { features: [], error: null }]]) {
  test(`nearby ${label} cannot establish authoritative empty coverage`, async () => {
    const f = fixture(); let calls = 0;
    const state = track(f.api.fetchNearbyUsdaSites(point, options(async () => { calls++; return response(data); })));
    await flush(); assert.equal(state.status, "rejected"); assert.equal(calls, 1); assert.equal(f.circuit.failures, 1); assert.equal(f.timers.size, 0);
  });
}

test("malformed JSON is terminal and accounts for one failure", async () => {
  const f = fixture(); let calls = 0;
  const state = track(f.api.fetchUsdaActiveCount(options(async () => { calls++; return { ok: true, json: async () => { throw new SyntaxError("Malformed JSON"); } }; })));
  await flush(); assert.equal(state.status, "rejected"); assert.equal(calls, 1); assert.equal(f.circuit.failures, 1);
});

test("explicit valid empty nearby payload resets failures", async () => {
  const f = fixture(); f.circuit.failures = 2;
  assert.equal((await f.api.fetchNearbyUsdaSites(point, options(async () => response({ features: [], exceededTransferLimit: false })))).length, 0);
  assert.equal(f.circuit.failures, 0);
});

for (const geometry of [{ x: null, y: null }, { x: "", y: " " }, { x: false, y: true }, { x: "-71", y: "42" }, { x: NaN, y: 42 }, { x: 200, y: 95 }, { x: -181, y: 0 }, { x: 0, y: -91 }]) {
  test(`invalid source coordinates ${JSON.stringify(geometry)} are excluded`, () => {
    assert.equal(fixture().api.usdaFeatureToResource({ ...feature, geometry }, "2026-08-05"), null);
  });
}
for (const geometry of [{ x: 0, y: 0 }, { x: 180, y: 90 }, { x: -180, y: -90 }, feature.geometry]) {
  test(`numeric in-world source coordinates ${JSON.stringify(geometry)} survive unchanged`, () => {
    const result = fixture().api.usdaFeatureToResource({ ...feature, geometry }, "2026-08-05");
    assert.equal(result.lat, geometry.y); assert.equal(result.lng, geometry.x);
    assert.equal(result.id, "usda-summer-2026-official-site-42");
  });
}

test("missing source dates remain unknown, including independently missing endpoints", () => {
  const f = fixture();
  for (const value of [null, undefined]) {
    const result = f.api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Start_date: value, End_date: value } }, "2026-08-05");
    assert.ok(result); assert.equal(result.validFrom, undefined); assert.equal(result.validThrough, undefined);
    assert.doesNotMatch(result.availabilityNote, /1970|published for/);
  }
  const result = f.api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Start_date: null } }, "2026-08-05");
  assert.equal(result.validFrom, undefined); assert.equal(result.validThrough, "2026-08-21");
});
for (const value of ["", " ", false, true, [], "1781481600000", NaN, Infinity, 1e20]) {
  test(`malformed source date ${JSON.stringify(value)} excludes the record without throwing`, () => {
    assert.equal(fixture().api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Start_date: value } }, "2026-08-05"), null);
  });
}

test("reversed date windows are excluded and numeric zero is a real epoch timestamp", () => {
  const f = fixture();
  assert.equal(f.api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Start_date: feature.attributes.End_date + 1 } }, "2026-08-05"), null);
  const result = f.api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Start_date: 0 } }, "2026-08-05");
  assert.equal(result.validFrom, "1970-01-01");
});

test("mixed nearby records preserve safe exclusions while all-invalid input is unavailable", async () => {
  const f = fixture(), invalid = { ...feature, attributes: { ...feature.attributes, Start_date: 1e20 } };
  const valid = await f.api.fetchNearbyUsdaSites(point, options(async () => response({ features: [invalid, feature, null] })));
  assert.equal(valid.length, 1); assert.equal(valid[0].sourceRecordId, "official-site-42");
  await assert.rejects(f.api.fetchNearbyUsdaSites(point, options(async () => response({ features: [invalid, null] }))));
});
for (const otherId of ["official-site-42", "official site 42"]) {
  test(`duplicate or normalized-colliding identity ${otherId} rejects ambiguous nearby results`, async () => {
    const f = fixture(), other = { ...feature, attributes: { ...feature.attributes, MasterID: otherId, FID: 43 } };
    await assert.rejects(f.api.fetchNearbyUsdaSites(point, options(async () => response({ features: [feature, other] }))), /identit|duplicate/i);
    assert.equal(f.circuit.failures, 1);
  });
}

function appFixture(fetchImpl) {
  const f = fixture(), effects = [];
  const between = (start, end) => { const a = app.indexOf(start), b = app.indexOf(end, a); assert.ok(a >= 0 && b > a); return app.slice(a, b); };
  f.context.fetch = fetchImpl;
  f.context.state = { userLocation: point, userCountry: "United States", liveResources: [], liveNationalCount: null, liveSourceStatus: "idle" };
  f.context.document = { getElementById: () => ({ classList: { remove() {} } }) };
  f.context.resourceDistanceKm = () => 1;
  f.context.updateFilters = () => effects.push("filters");
  f.context.renderLiveSourceState = () => effects.push("status");
  vm.runInContext(`let liveSourceController = null, locationRequestGeneration = 0;\n${between("function clearUserLocation()", "function clearFinderFilters(")}\n${between("async function loadLiveResourcesNearUser()", "function latLngVector(")}`, f.context);
  return { ...f, state: f.context.state, effects };
}
for (const failed of ["count", "nearby", "both"]) {
  test(`actual app and helpers retain independent outcomes after ${failed} body deadline`, async () => {
    const f = appFixture(async url => {
      const kind = new URL(url).searchParams.get("returnCountOnly") === "true" ? "count" : "nearby";
      return kind === failed || failed === "both" ? { ok: true, json: () => new Promise(() => {}) } : response(kind === "count" ? { count: 100 } : { features: [feature] });
    });
    const state = track(f.context.loadLiveResourcesNearUser()); await flush(); await f.advance(22000);
    assert.equal(state.status, "fulfilled"); assert.equal(f.state.liveNationalCount, failed === "nearby" ? 100 : null);
    assert.equal(f.state.liveResources.length, failed === "count" ? 1 : 0);
    assert.equal(f.state.liveSourceStatus, failed === "count" ? "loaded" : "unavailable");
    assert.equal(f.timers.size, 0);
  });
}
for (const phase of ["headers", "body", "backoff"]) {
  for (const replace of [false, true]) {
    test(`actual app ${replace ? "replacement" : "Clear"} during ${phase} discards late work`, async () => {
      const pending = [], signals = []; let fresh = false;
      const f = appFixture(async (url, { signal }) => {
        const count = new URL(url).searchParams.get("returnCountOnly") === "true";
        signals.push(signal);
        if (fresh) return response(count ? { count: 200 } : { features: [feature] });
        if (phase === "backoff") return { ok: false, status: 503 };
        const d = deferred(); pending.push({ ...d, count });
        return phase === "headers" ? d.promise : { ok: true, json: () => d.promise };
      });
      const old = track(f.context.loadLiveResourcesNearUser()); await flush();
      if (replace) { fresh = true; await f.context.loadLiveResourcesNearUser(); } else f.context.clearUserLocation();
      await flush(); const expected = JSON.stringify(f.state), effects = [...f.effects];
      assert.equal(old.status, "fulfilled"); assert.equal(f.circuit.failures, 0);
      for (const [i, d] of pending.entries()) { if (i % 2) d.reject(new Error("Late old failure")); else d.resolve(phase === "headers" ? response({ count: 77 }) : { count: 77 }); }
      await flush(); await f.advance(60000);
      assert.equal(JSON.stringify(f.state), expected); assert.deepEqual(f.effects, effects); assert.equal(f.timers.size, 0);
      assert.ok(signals.slice(0, 2).every(signal => signal.aborted || phase === "backoff"));
    });
  }
}

test("representable expanded-year timestamps retain the full ISO date", () => {
  const f = fixture();
  for (const value of [-8640000000000000, 8640000000000000]) {
    const result = f.api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Start_date: value, End_date: value } }, "2026-08-05");
    assert.equal(result.validFrom, new Date(value).toISOString().split("T")[0]);
    assert.equal(result.validThrough, result.validFrom);
  }
});

for (const code of [0, -1, 400, 403, 404]) {
  test(`malformed ArcGIS message cannot obscure nonretryable code ${code}`, async () => {
    const f = fixture(); let calls = 0;
    const state = track(f.api.fetchUsdaActiveCount(options(async () => { calls++; return response({ error: { code, message: { toString: null } } }); })));
    await flush(); assert.equal(state.status, "rejected"); assert.equal(calls, 1); assert.equal(f.circuit.failures, 1);
  });
}

test("non-scalar source text is excluded safely without obscuring usable mixed records", async () => {
  const f = fixture(), invalid = { ...feature, attributes: { ...feature.attributes, Site_Name: { toString: null } } };
  assert.equal(f.api.usdaFeatureToResource(invalid, "2026-08-05"), null);
  const valid = await f.api.fetchNearbyUsdaSites(point, options(async () => response({ features: [feature, invalid] })));
  assert.equal(valid.length, 1);
  await assert.rejects(f.api.fetchNearbyUsdaSites(point, options(async () => response({ features: [invalid] }))));
  const badOptionalScore = f.api.usdaFeatureToResource({ ...feature, attributes: { ...feature.attributes, Score: { toString: null } } }, "2026-08-05");
  assert.ok(badOptionalScore); assert.doesNotMatch(badOptionalScore.coordinateNote, /\(score/);
});
