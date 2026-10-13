import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertCatalogFailure, assertCatalogRecovered } from "../scripts/qa-catalog-recovery.mjs";

const failure = () => ({
  href: "http://127.0.0.1:12345/directory", timeOrigin: 123, controller: "http://127.0.0.1:12345/sw.js",
  saved: '["qa-contact-phone"]', query: "Synthetic", help: "Food", message: "Search is temporarily unavailable.",
  retry: { visible: true, busy: false }, rows: []
});

test("catalog browser failure assertion rejects the original forever-loading baseline", () => {
  const state = failure(); assertCatalogFailure(state);
  for (const change of [{ controller: undefined }, { message: "Searching this directory…", retry: { visible: false } },
    { retry: { visible: true, busy: true } }, { rows: ["withdrawn"] }]) {
    assert.throws(() => assertCatalogFailure({ ...state, ...change }));
  }
});

test("catalog browser recovery requires an active worker, native retries, retained state and visible focus", () => {
  const before = failure();
  const after = { ...before, rows: ["current"], retry: { visible: false, busy: false },
    focus: { restored: true, visible: true, body: false }, workerRequests: [{ workerStart: 123 }], clicks: [{ trusted: true }, { trusted: true }] };
  assertCatalogRecovered(before, after, 1);
  for (const change of [{ saved: "[]" }, { timeOrigin: 124 }, { query: "" }, { help: "" }, { controller: null },
    { rows: [] }, { retry: { visible: true } }, { focus: { restored: true, visible: false } },
    { focus: { restored: false, visible: true } }, { focus: { restored: true, visible: true, body: true } },
    { workerRequests: [{ workerStart: 0 }] }, { clicks: [{ trusted: true }] }, { clicks: [{ trusted: true }, { trusted: false }] }]) {
    assert.throws(() => assertCatalogRecovered(before, { ...after, ...change }, 1));
  }
});

test("catalog CI coverage keeps the real worker and timeouts, with isolated HTTP stalls only", async () => {
  const qa = await readFile("scripts/qa-catalog-recovery.mjs", "utf8");
  const runner = await readFile("scripts/browser-service-qa.mjs", "utf8");
  assert.match(qa, /setBypassServiceWorker", \{ bypass: false \}/);
  assert.doesNotMatch(qa, /bypass: true|Fetch\.enable|setOffline|globalThis\.fetch|window\.fetch|8000.*replace|6000.*replace/);
  assert.match(qa, /\["search", "saved"\]/); assert.match(qa, /\["hung-headers", "hung-body"\]/);
  assert.match(qa, /pressConnectivityRecoveryKey\(client, "Enter", 13\)/);
  assert.match(qa, /initial\[0\]\.closed/);
  assert.match(qa, /await app\.cleanup\(\)/);
  assert.match(runner, /await verifyCatalogRecovery\(/);
});
