import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { homepageOfflineSnapshot, assertHomepageDelayedLoad, assertHomepageWorkerReady, assertHomepageOfflineDirectory, withHomepageDeadline, verifyHomepageOfflineStartup } from "../scripts/qa-homepage-offline-startup.mjs";

const origin = "http://127.0.0.1:4176";
const delayed = () => ({ origin, path: "/", readyState: "complete", loadEventEnd: 120, secure: true, online: true, globe: true, professional: false, overlay: false, registrations: [], controller: null, cachedDirectory: false });
const ready = () => ({ ...delayed(), professional: true, registrations: [{ scope: `${origin}/`, active: "activated", script: `${origin}/sw.js` }], controller: `${origin}/sw.js`, cachedDirectory: true, cachedIndex: false, forbiddenCachedPaths: [] });
const offline = () => ({ ...ready(), path: "/directory", online: false, directory: true, records: 60, noticeVisible: true, networkState: "offline", noticeText: "Reconnect before traveling or relying on a listing.", overflow: 0 });

test("home startup gate requires a cold worker, finished real load and genuinely held import", () => {
  assertHomepageDelayedLoad(delayed(), origin, 1);
  assert.throws(() => assertHomepageDelayedLoad(delayed(), origin, 0));
  for (const change of [{ origin: "https://other.example" }, { path: "/directory" }, { readyState: "interactive" }, { loadEventEnd: 0 }, { secure: false }, { online: false }, { globe: false }, { professional: true }, { overlay: true }, { registrations: [{}] }, { controller: "old-worker" }, { cachedDirectory: true }]) {
    assert.throws(() => assertHomepageDelayedLoad({ ...delayed(), ...change }, origin, 1), JSON.stringify(change));
  }
});

test("home worker readiness requires real activation, the unchanged root worker and lazy index", () => {
  assertHomepageWorkerReady(ready(), origin);
  for (const change of [{ path: "/directory" }, { secure: false }, { online: false }, { professional: false }, { cachedDirectory: false }, { overlay: true }, { registrations: [] }, { registrations: [{ scope: `${origin}/directory/`, active: "activated", script: `${origin}/sw.js` }] }, { controller: null }, { cachedIndex: true }, { forbiddenCachedPaths: ["/service/example"] }]) {
    assert.throws(() => assertHomepageWorkerReady({ ...ready(), ...change }, origin), JSON.stringify(change));
  }
});

test("home-only offline journey requires usable static rows and honest reconnection safeguards", () => {
  assertHomepageOfflineDirectory(offline(), origin);
  for (const change of [{ origin: "https://other.example" }, { path: "/" }, { online: true }, { controller: null }, { directory: false }, { records: 0 }, { noticeVisible: false }, { overlay: true }, { networkState: "online" }, { noticeText: "Current availability confirmed" }, { overflow: 9 }, { overflow: null }, { forbiddenCachedPaths: ["/api/account"] }]) {
    assert.throws(() => assertHomepageOfflineDirectory({ ...offline(), ...change }, origin), JSON.stringify(change));
  }
});

test("runtime presentation observation uses the installed body marker, not the build-time html class", async () => {
  const body = { classList: { contains: () => false } };
  const context = {
    navigator: { onLine: true, serviceWorker: { getRegistrations: async () => [] } },
    window: { isSecureContext: true }, location: { href: `${origin}/`, origin, pathname: "/" },
    performance: { getEntriesByType: () => [{ loadEventEnd: 120 }] }, innerWidth: 390,
    document: { body, readyState: "complete", documentElement: { scrollWidth: 390, classList: { contains: () => true } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
  };
  assert.equal((await vm.runInNewContext(`(${homepageOfflineSnapshot})()`, context)).professional, false);
  body.classList.contains = () => true;
  assert.equal((await vm.runInNewContext(`(${homepageOfflineSnapshot})()`, context)).professional, true);
  context.document.documentElement = null;
  context.document.body = null;
  const provisional = await vm.runInNewContext(`(${homepageOfflineSnapshot})()`, context);
  assert.equal(provisional.professional, false);
  assert.equal(provisional.overflow, null);
});

test("CI adds the home case before the unchanged directory journey and preserves real loading", async () => {
  const helper = await readFile(new URL("../scripts/qa-homepage-offline-startup.mjs", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/browser-offline.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("await verifyHomepageOfflineStartup(") < runner.indexOf('await navigate(client, `${HOST}/directory`, 800)'));
  assert.match(helper, /Fetch\.enable/);
  assert.match(helper, /\/src\/result-actions\.js/);
  assert.match(helper, /loadEventEnd > 0/);
  assert.match(helper, /await navigateWithin\(`\$\{origin\}\/directory`\)/);
  assert.match(helper, /assert\.deepEqual\(documents, \[\{ url: `\$\{origin\}\/`, offline: false \}\]/);
  assert.match(helper, /cleanup\("leave controlled document", \(\) => navigateWithin\("about:blank"\)\)/);
  assert.match(helper, /cleanup\("fresh directory state", \(\) => call\("Storage\.clearDataForOrigin", \{ origin, storageTypes: "service_workers,cache_storage" \}\)\)/);
  assert.ok(helper.indexOf('cleanup("leave controlled document"') < helper.indexOf('cleanup("fresh directory state"'));
  assert.doesNotMatch(helper, /serviceWorker\.register|Fetch\.fulfillRequest|dispatchEvent\(|\.click\(|Emulation\.setScriptExecutionDisabled/);
  for (const guard of ["offline.results < 1", "offline.apiCached", "!offline.serviceNavigationBlocked", "!offline.noticeFocused"]) assert.ok(runner.includes(guard), guard);
});

test("homepage QA bounds hung observations without swallowing real errors", async () => {
  assert.equal(await withHomepageDeadline(Promise.resolve("ready"), 1000, "late"), "ready");
  const failure = new Error("real failure");
  await assert.rejects(withHomepageDeadline(Promise.reject(failure), 1000, "late"), error => error === failure);
  await assert.rejects(withHomepageDeadline(new Promise(() => {}), 5, "observation timed out"), /observation timed out/);
});

async function runnerFixture({ dirty = false, cleanupFailure = false } = {}) {
  const qaDir = await mkdtemp(join(tmpdir(), "rwn-home-startup-oracle-"));
  const listeners = new Map(), calls = [];
  let snapshot, networkOffline = false, disableCalls = 0;
  const client = {
    on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
    async call(method, params) {
      calls.push({ method, params });
      if (method === "Fetch.continueRequest") snapshot = ready();
      if (method === "Network.emulateNetworkConditions") networkOffline = params.offline;
      if (method === "Fetch.disable") {
        disableCalls++;
        if (cleanupFailure && (dirty || disableCalls === 2)) throw new Error("cleanup interception failure");
      }
      return {};
    }
  };
  const navigate = async (_, url, settle) => {
    assert.equal(settle, 0);
    calls.push({ method: "navigate", url });
    if (url === "about:blank") return;
    listeners.get("Network.requestWillBeSent")?.({ type: "Document", request: { url } });
    if (url === `${origin}/`) {
      snapshot = { ...delayed(), ...(dirty ? { registrations: [{ scope: "unexpected prior worker" }] } : {}) };
      listeners.get("Fetch.requestPaused")({ requestId: "real-import", request: { url: `${origin}/src/result-actions.js?v=123456789abc` } });
    } else {
      assert.equal(url, `${origin}/directory`);
      assert.equal(networkOffline, true, "the first directory visit must be offline");
      snapshot = offline();
    }
  };
  return {
    qaDir, calls, listeners,
    run: () => verifyHomepageOfflineStartup({ client, host: origin, navigate, evaluate: async () => structuredClone(snapshot), capture: async (_, name) => { calls.push({ method: "capture", name }); }, qaDir }),
    evidence: async () => JSON.parse(await readFile(join(qaDir, "homepage-offline-startup.json"), "utf8")),
    dispose: () => rm(qaDir, { recursive: true, force: true })
  };
}

test("home offline orchestration releases the real import, navigates offline and restores the existing cold fixture", async () => {
  const f = await runnerFixture();
  try {
    await f.run();
    const evidence = await f.evidence();
    assert.deepEqual(evidence.documents, [{ url: `${origin}/`, offline: false }, { url: `${origin}/directory`, offline: true }]);
    assert.equal(evidence.heldImports, 1);
    assert.deepEqual(evidence.cleanupErrors, []);
    assert.equal(f.listeners.size, 0);
    assert.deepEqual(f.calls.filter(call => call.method === "Storage.clearDataForOrigin").map(call => call.params), [{ origin, storageTypes: "service_workers,cache_storage" }]);
    const blank = f.calls.findIndex(call => call.method === "navigate" && call.url === "about:blank");
    assert.ok(blank > f.calls.findIndex(call => call.method === "capture"));
    assert.equal(f.calls[blank + 1].method, "Storage.clearDataForOrigin");
  } finally { await f.dispose(); }
});

for (const dirty of [false, true]) {
  test(`home offline cleanup retains evidence and later cleanup after an interception failure (primary error: ${dirty})`, async () => {
    const f = await runnerFixture({ dirty, cleanupFailure: true });
    try {
      await assert.rejects(f.run(), dirty ? /homepage must begin without a previous worker/ : /cleanup did not restore/);
      const evidence = await f.evidence();
      assert.deepEqual(evidence.cleanupErrors, [{ label: "request interception", message: "cleanup interception failure" }]);
      assert.ok(f.calls.some(call => call.method === "Network.emulateNetworkConditions" && call.params.offline === false));
      assert.ok(f.calls.some(call => call.method === "Storage.clearDataForOrigin"));
      assert.equal(f.listeners.size, 0);
      if (dirty) assert.match(evidence.error, /homepage must begin without a previous worker/);
      else assert.equal(evidence.error, undefined);
    } finally { await f.dispose(); }
  });
}
