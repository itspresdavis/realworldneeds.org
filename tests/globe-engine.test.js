import test from "node:test";
import assert from "node:assert/strict";
import { loadGlobeEngine } from "../src/utils/globe-engine.js";

test("unavailable WebGL never imports the rendering engine", async () => {
  for (const canvas of [null, { getContext: () => null }, { getContext() { throw Error("blocked"); } }, { getContext: () => ({ isContextLost: () => true }) }]) {
    let imports = 0;
    assert.equal(await loadGlobeEngine(canvas, () => { imports++; }), null);
    assert.equal(imports, 0);
  }
});
test("WebGL engine loading uses the tested canvas and preserves import failures", async () => {
  const context = {}, THREE = {}, points = {};
  let requests = 0;
  const canvas = { getContext(type, attrs) { requests++; assert.equal(type, "webgl2"); assert.equal(attrs.alpha, true); return context; } };
  assert.deepEqual(await loadGlobeEngine(canvas, async () => [THREE, points]), { THREE, points, context });
  assert.equal(requests, 1);
  await assert.rejects(loadGlobeEngine(canvas, async () => { throw Error("network failure"); }), /network failure/);
});
