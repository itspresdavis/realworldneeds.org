import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/bootstrap.js", import.meta.url), "utf8");
const installedOrder = ["installProfessionalPresentation", "installRefinements", "installAccessibility", "installResultActions"];

function fixture({ readyState = "interactive", delayed, supported = true, secure = true, rejected = false } = {}) {
  const document = { readyState, documentElement: { dataset: {} }, getElementById: () => null };
  const window = new EventTarget();
  window.isSecureContext = secure;
  const registrations = [], installed = [], imports = [], failures = [];
  window.addEventListener("rwn:offline-unavailable", event => failures.push(event.type));
  const navigator = supported ? { serviceWorker: { register(...args) {
    registrations.push(args);
    return rejected ? Promise.reject(new Error("Registration unavailable")) : Promise.resolve({});
  } } } : {};
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const modules = {
    "./app.js": {},
    "./refinement.js": { installRefinements: () => installed.push("installRefinements") },
    "./professional.js": { installProfessionalPresentation: () => installed.push("installProfessionalPresentation") },
    "./accessibility.js": { installAccessibility: () => installed.push("installAccessibility") },
    "./result-actions.js": { installResultActions: () => installed.push("installResultActions") },
    "./telemetry.js": { startTelemetry() {} },
  };
  const loadModule = async specifier => {
    imports.push(specifier);
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected module ${specifier}`);
    if (specifier === delayed) await gate;
    return modules[specifier];
  };
  // Only replace the import transport. Run the complete bootstrap, its awaits,
  // installers, readiness decision and failure callback without slicing them.
  const program = source.replace(/\bimport\(/g, "loadModule(");
  const done = vm.runInNewContext(`(async () => {${program}\n})()`, { document, window, navigator, loadModule, CustomEvent });
  const load = () => { document.readyState = "complete"; window.dispatchEvent(new Event("load")); };
  const finish = async () => { release(); await done; await Promise.resolve(); };
  return { document, registrations, installed, imports, failures, done, load, finish };
}

function assertRegistered(f) {
  assert.deepEqual(f.installed, installedOrder);
  assert.deepEqual(JSON.parse(JSON.stringify(f.registrations)), [["/sw.js", { scope: "/" }]]);
}

test("homepage registers once after load when bootstrap finishes first", async () => {
  const f = fixture();
  await f.done;
  assert.equal(f.registrations.length, 0, "registration remains off the loading critical path");
  f.load();
  f.load();
  assertRegistered(f);
});

for (const delayed of ["./app.js", "./result-actions.js"]) {
  test(`homepage registers after load fires during the ${delayed} import`, async () => {
    const f = fixture({ delayed });
    assert.equal(f.imports.length, 5, "the existing parallel import sequence is preserved");
    f.load();
    assert.equal(f.registrations.length, 0, "registration does not jump ahead of initialization");
    await f.finish();
    assertRegistered(f);
    f.load();
    assert.equal(f.registrations.length, 1);
  });
}

test("homepage registers immediately when the document is already complete", async () => {
  const f = fixture({ readyState: "complete" });
  await f.done;
  assertRegistered(f);
  f.load();
  assert.equal(f.registrations.length, 1);
});

test("homepage still waits for load in a loading document", async () => {
  const f = fixture({ readyState: "loading" });
  await f.done;
  assert.equal(f.registrations.length, 0);
  f.load();
  assertRegistered(f);
});

for (const options of [{ supported: false }, { secure: false }]) {
  test(`homepage keeps the registration availability guard ${JSON.stringify(options)}`, async () => {
    const f = fixture({ readyState: "complete", ...options });
    await f.done;
    f.load();
    assert.equal(f.registrations.length, 0);
    assert.deepEqual(f.installed, installedOrder);
    assert.deepEqual(f.failures, []);
  });
}

for (const readyState of ["interactive", "complete"]) {
  test(`homepage preserves rejected-registration reporting from ${readyState}`, async () => {
    const f = fixture({ readyState, rejected: true });
    await f.done;
    if (readyState !== "complete") f.load();
    await Promise.resolve();
    assertRegistered(f);
    assert.equal(f.document.documentElement.dataset.offlineSaving, "unavailable");
    assert.deepEqual(f.failures, ["rwn:offline-unavailable"]);
    f.load();
    await Promise.resolve();
    assert.equal(f.registrations.length, 1);
    assert.equal(f.failures.length, 1);
  });
}
