import assert from "node:assert/strict";
import test from "node:test";
import { createThreeAssets, versionThreeReferences } from "../scripts/three-assets.mjs";

const renderer = 'import { Core } from "./three.core.min.js"; export { Core };';
const core = "export const Core = 1;";

test("either Three file rotates the complete vendor graph", () => {
  const before = createThreeAssets(renderer, core);
  assert.deepEqual(createThreeAssets(Buffer.from(renderer), Buffer.from(core)), before);
  for (const after of [createThreeAssets(`${renderer}\n// renderer update`, core), createThreeAssets(renderer, `${core}\n// core update`)]) {
    assert.notEqual(after.release, before.release);
    assert.notEqual(after.moduleName, before.moduleName);
    assert.notEqual(after.coreName, before.coreName);
    assert.ok(after.moduleSource.includes(`"./${after.coreName}"`));
    assert.equal(after.moduleSource.includes("three.core.min.js"), false);
  }
});

test("renderer core imports and exports use the same generation with either quote style", () => {
  const assets = createThreeAssets(`${renderer}\nexport { Other } from './three.core.min.js';`, core);
  assert.ok(assets.moduleSource.includes(`"./${assets.coreName}"`));
  assert.ok(assets.moduleSource.includes(`'./${assets.coreName}'`));
  assert.equal(assets.coreSource, core);
});

test("an unexpected vendor layout fails the build instead of shipping a mixed graph", () => {
  assert.throws(() => createThreeAssets('import "./other-core.js";', core), /expected core module/);
});

test("preloads and both source import styles use the hashed renderer without rewriting unrelated paths", () => {
  const assets = createThreeAssets(renderer, core);
  const source = `<link rel="modulepreload" href="/vendor/three.module.js">\nimport * as THREE from '/vendor/three.module.js';\nconst help = "/help/three.module.js";`;
  const result = versionThreeReferences(source, assets);
  assert.equal(result.match(new RegExp(assets.moduleName.replaceAll(".", "\\."), "g")).length, 2);
  assert.ok(result.includes('"/help/three.module.js"'));
  assert.equal(versionThreeReferences(result, assets), result);
});
