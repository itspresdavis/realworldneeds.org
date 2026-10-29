import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/bootstrap.js", import.meta.url), "utf8");
const installedOrder = ["installProfessionalPresentation", "installRefinements", "installAccessibility", "installResultActions"];

function fixture({ readyState = "interactive", delayed, supported = true, secure = true, rejected = false, moduleErrors = [], installerError, installerFalse, partialApp = false } = {}) {
  const makePreboot = () => ({
    links: ["/directory/help/food", "/directory/help/water", "/directory/help/shelter", "/directory/help/clothing", "/directory/help/hygiene", "/directory/help/health", "/directory", "/editorial-policy", "/transparency", "/accessibility"],
    status: { textContent: "Preparing the interactive finder. Browse by need while it loads." },
    cloneNode() { return makePreboot(); },
    querySelector(selector) { assert.equal(selector, ".preboot-finder__status"); return this.status; },
  });
  const preboot = makePreboot();
  const root = { children: [preboot], replaceChildren(...children) { this.children = children; } };
  const document = { readyState, documentElement: { dataset: {} }, getElementById: id => ({ root, "preboot-finder": preboot })[id] || null };
  const window = new EventTarget();
  window.isSecureContext = secure;
  const registrations = [], installed = [], attempted = [], imports = [], failures = [], logs = [];
  window.addEventListener("rwn:offline-unavailable", event => failures.push(event.type));
  const navigator = supported ? { serviceWorker: { register(...args) {
    registrations.push(args);
    return rejected ? Promise.reject(new Error("Registration unavailable")) : Promise.resolve({});
  } } } : {};
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const installer = name => () => {
    attempted.push(name);
    if (name === installerError) throw new Error("Simulated installer failure with private detail");
    if (name === installerFalse) return false;
    installed.push(name);
  };
  const modules = {
    "./app.js": {},
    "./refinement.js": { installRefinements: installer("installRefinements") },
    "./professional.js": { installProfessionalPresentation: installer("installProfessionalPresentation") },
    "./accessibility.js": { installAccessibility: installer("installAccessibility") },
    "./result-actions.js": { installResultActions: installer("installResultActions") },
    "./telemetry.js": { startTelemetry() {} },
  };
  const loadModule = async specifier => {
    imports.push(specifier);
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected module ${specifier}`);
    if (specifier === delayed) await gate;
    if (specifier === "./app.js" && partialApp) root.replaceChildren({ incompleteApp: true });
    if (moduleErrors.includes(specifier)) throw new Error("Simulated module failure with private detail");
    return modules[specifier];
  };
  // Only replace the import transport. Run the complete bootstrap, its awaits,
  // installers, readiness decision and failure callback without slicing them.
  const program = source.replace(/\bimport\(/g, "loadModule(");
  const done = vm.runInNewContext(`(async () => {${program}\n})()`, { document, window, navigator, loadModule, CustomEvent, console: { error: message => logs.push(message) } });
  const load = () => { document.readyState = "complete"; window.dispatchEvent(new Event("load")); };
  const finish = async () => { release(); await done; await Promise.resolve(); };
  return { document, root, preboot, registrations, installed, attempted, imports, failures, logs, done, load, finish };
}

function assertRegistered(f) {
  assert.deepEqual(f.installed, installedOrder);
  assert.equal(f.document.documentElement.dataset.finderStartup, "ready");
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


const optionalModules = [
  ["./professional.js", "installProfessionalPresentation"],
  ["./refinement.js", "installRefinements"],
  ["./accessibility.js", "installAccessibility"],
  ["./result-actions.js", "installResultActions"],
];

for (const [specifier, installer] of optionalModules) {
  test(`a failed ${specifier} import preserves other layers and offline registration`, async () => {
    const f = fixture({ readyState: "complete", moduleErrors: [specifier] });
    await f.done;
    assert.deepEqual(f.installed, installedOrder.filter(name => name !== installer));
    assert.equal(f.registrations.length, 1);
    assert.equal(f.document.documentElement.dataset.finderStartup, "degraded");
    assert.equal(f.logs.length, 1);
    assert.doesNotMatch(f.logs[0], /private detail/);
    assert.equal(f.root.children[0], f.preboot, "optional failure does not replace the application shell");
  });
}

for (const installerError of installedOrder) {
  test(`a throwing ${installerError} preserves deterministic remaining installation`, async () => {
    const f = fixture({ readyState: "complete", installerError });
    await f.done;
    assert.deepEqual(f.attempted, installedOrder);
    assert.deepEqual(f.installed, installedOrder.filter(name => name !== installerError));
    assert.equal(f.registrations.length, 1);
    assert.equal(f.document.documentElement.dataset.finderStartup, "degraded");
    assert.equal(f.logs.length, 1);
  });
}

test("an installer that reports unavailable does not mark startup ready", async () => {
  const f = fixture({ readyState: "complete", installerFalse: "installProfessionalPresentation" });
  await f.done;
  assert.deepEqual(f.attempted, installedOrder);
  assert.equal(f.document.documentElement.dataset.finderStartup, "degraded");
  assert.equal(f.logs.length, 1);
  assert.equal(f.registrations.length, 1);
});

test("early optional rejection is handled while the app import is still pending", async () => {
  const f = fixture({ readyState: "complete", delayed: "./app.js", moduleErrors: ["./professional.js", "./result-actions.js"] });
  // Give Node an event-loop turn: an unhandled rejection would fail this test.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.imports.length, 5);
  assert.deepEqual(f.attempted, []);
  await f.finish();
  assert.deepEqual(f.installed, ["installRefinements", "installAccessibility"]);
  assert.equal(f.logs.length, 2);
  assert.equal(f.registrations.length, 1);
  assert.equal(f.document.documentElement.dataset.finderStartup, "degraded");
});

for (const partialApp of [false, true]) {
  test(`core failure restores actual directory links after partial app=${partialApp}`, async () => {
    const f = fixture({ readyState: "complete", moduleErrors: ["./app.js", "./professional.js"], partialApp });
    await f.done;
    await new Promise(resolve => setImmediate(resolve));
    const fallback = f.root.children[0];
    assert.notEqual(fallback, f.preboot, "restores the snapshot captured before imports");
    assert.deepEqual(fallback.links, f.preboot.links);
    assert.match(fallback.status.textContent, /could not load/);
    assert.doesNotMatch(fallback.status.textContent, /Preparing/);
    assert.deepEqual(f.attempted, [], "enhancement installers require a successful core app");
    assert.equal(f.document.documentElement.dataset.finderStartup, "unavailable");
    assert.equal(f.logs.length, 1);
    assert.equal(f.registrations.length, 1, "directory offline support remains available");
  });
}
