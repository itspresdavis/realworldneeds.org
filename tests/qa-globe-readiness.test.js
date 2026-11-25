import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { waitForGlobeRendererReady } from "../scripts/qa-globe-readiness.mjs";

function fixture(initial, advance = () => {}) {
  let now = 0;
  const state = { startup: "loading", recoveryBound: false, unavailable: false, canvasPresent: true, stagePresent: true, ...initial };
  const canvas = { dataset: {}, getContext() { throw new Error("The readiness check must never create a graphics context"); } };
  const stage = { classList: { contains: () => state.unavailable } };
  const document = {
    documentElement: { get dataset() { return { globeStartup: state.startup }; } },
    getElementById(id) {
      assert.equal(id, "globeCanvas");
      canvas.dataset.rwnContextRecovery = state.recoveryBound ? "true" : undefined;
      return state.canvasPresent ? canvas : null;
    },
    querySelector(selector) { assert.equal(selector, ".globe-stage"); return state.stagePresent ? stage : null; }
  };
  const context = vm.createContext({ document, performance: { now: () => now }, setTimeout(resolve, delay) { now += delay; advance(state, now); resolve(); } });
  return { run: options => vm.runInContext(`(${waitForGlobeRendererReady.toString()})(${JSON.stringify(options || { timeoutMs: 100, pollMs: 25 })})`, context), elapsed: () => now };
}

test("held optional engine cannot advance to a context-loss assertion", async () => {
  const f = fixture(); let injected = false;
  await assert.rejects(f.run().then(() => { injected = true; }), /"startup":"loading"/);
  assert.equal(injected, false);
  assert.equal(f.elapsed(), 100);
});

test("ready renderer without its recovery listener is rejected", async () => {
  await assert.rejects(fixture({ startup: "ready" }).run(), /"recoveryBound":false/);
});

test("finder readiness or recovery listener alone does not imply renderer readiness", async () => {
  await assert.rejects(fixture({ recoveryBound: true }).run(), /"startup":"loading"/);
});

test("readiness waits for both renderer and recovery binding after the delayed import", async () => {
  const f = fixture({}, (state, elapsed) => {
    if (elapsed >= 25) state.startup = "ready";
    if (elapsed >= 75) state.recoveryBound = true;
  });
  const result = await f.run();
  assert.equal(result.startup, "ready");
  assert.equal(result.recoveryBound, true);
  assert.equal(f.elapsed(), 75);
});

test("unavailable capability fails immediately with actionable diagnostic state", async () => {
  const f = fixture({ startup: "unavailable", unavailable: true });
  await assert.rejects(f.run(), /"startup":"unavailable"/);
  assert.equal(f.elapsed(), 0);
});

for (const state of [{ canvasPresent: false }, { stagePresent: false }, { unavailable: true }]) {
  test(`apparently ready state still requires its actual visible stage: ${JSON.stringify(state)}`, async () => {
    await assert.rejects(fixture({ startup: "ready", recoveryBound: true, ...state }).run(), /not ready for context-loss recovery/);
  });
}

test("institutional recovery check awaits readiness before injecting context loss", async () => {
  const source = await readFile(new URL("../scripts/browser-institutional.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const fallback = await evaluate"));
  assert.ok(body.indexOf("waitForGlobeRendererReady.toString()") >= 0);
  assert.ok(body.indexOf("waitForGlobeRendererReady.toString()") < body.indexOf('dispatchEvent(new Event("webglcontextlost"'));
});
