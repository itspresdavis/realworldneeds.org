import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (root, path) => readFile(join(root, path), "utf8");
const build = (cwd) => new Promise((done, fail) => {
  const child = spawn(process.execPath, ["scripts/build.mjs"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("error", fail);
  child.on("close", (code) => code === 0 ? done() : fail(new Error(`Isolated build failed (${code}): ${output}`)));
});

async function graph(root) {
  const info = JSON.parse(await read(root, "dist/data/release.json"));
  assert.match(info.vendorRelease, /^[a-f0-9]{12}$/);
  const module = `three.module.${info.vendorRelease}.js`;
  const core = `three.core.${info.vendorRelease}.js`;
  const index = await read(root, "dist/index.html");
  assert.ok(index.includes(`href="/vendor/${module}"`), "preload must use the same renderer as both imports");
  assert.ok(index.includes(`/src/bootstrap.js?v=${info.release}`));
  for (const path of ["dist/src/app.js", "dist/src/globe-points.js"]) {
    const source = await read(root, path);
    assert.ok(source.includes(`/vendor/${module}`), path);
    assert.equal(source.includes('"/vendor/three.module.js"'), false, path);
  }
  const renderer = await read(root, `dist/vendor/${module}`);
  const coreSource = await read(root, `dist/vendor/${core}`);
  assert.ok(renderer.includes(`./${core}`));
  assert.equal(renderer.includes("./three.core.min.js"), false);
  assert.equal(await read(root, "dist/vendor/three.module.js"), renderer, "old app URL must still load a renderer paired with its hashed core");
  assert.equal(await read(root, "dist/vendor/three.core.min.js"), coreSource, "old cached renderer dependency must remain available");
  return { ...info, module, core, renderer, coreSource, vendorPaths: await readdir(join(root, "dist/vendor")) };
}

test("dependency-only updates rotate the built source and complete Three graph while retaining current compatibility URLs", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "rwn-vendor-cache-"));
  try {
    for (const path of ["src", "public", "scripts", "index.html", "package.json"]) await cp(path, join(root, path), { recursive: true });
    await mkdir(join(root, "node_modules/three/build"), { recursive: true });
    // Copy vendor bytes, never symlink them: mutate only this synthetic fixture.
    for (const name of ["three.module.min.js", "three.core.min.js"]) {
      await cp(`node_modules/three/build/${name}`, join(root, `node_modules/three/build/${name}`));
    }
    await build(root);
    const before = await graph(root);
    const warmCache = new Map(before.vendorPaths.map((path) => [`/vendor/${path}`, true]));
    const vendorPath = "node_modules/three/build/three.core.min.js";
    await writeFile(join(root, vendorPath), `${await read(root, vendorPath)}\n// synthetic dependency-only update\n`);
    await build(root);
    const after = await graph(root);
    assert.notEqual(after.vendorRelease, before.vendorRelease);
    assert.notEqual(after.release, before.release, "cached app/bootstrap URLs must rotate even when src and index do not change");
    assert.notEqual(after.module, before.module);
    assert.notEqual(after.core, before.core);
    assert.equal(warmCache.has(`/vendor/${after.module}`), false, "new renderer cannot reuse an old vendor cache entry");
    assert.equal(warmCache.has(`/vendor/${after.core}`), false, "new renderer cannot load the old cached core");
    assert.ok(after.coreSource.endsWith("// synthetic dependency-only update\n"));
    assert.deepEqual(after.vendorPaths.sort(), [after.module, after.core, "three.module.js", "three.core.min.js"].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
