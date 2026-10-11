import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const fixtureId = "synthetic-cache-removal-fixture";
const read = (root, path) => readFile(join(root, path), "utf8");
const build = (cwd, command = ["npm", "run", "build"]) => new Promise((done, fail) => {
  const child = spawn(command[0], command.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("error", fail);
  child.on("close", (code) => code === 0 ? done() : fail(new Error(`Synthetic build failed (${code}): ${output}`)));
});

// Exercise the complete production build, not a reconstructed hash expression.
// The removed row is invented; no hidden source payload or old private row is used.
test("data-only removal rotates finder, directory-index and offline URLs across complete builds", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "rwn-cache-release-"));
  try {
    for (const path of ["src", "public", "scripts", "index.html", "package.json"]) {
      await cp(path, join(root, path), { recursive: true });
    }
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const generatedPath = "src/data/generated/trussell-foodbanks.js";
    const original = await read(root, generatedPath);
    await writeFile(join(root, generatedPath), `${original}\ntrussellFoodbankResources.push({ ...trussellFoodbankResources[0], id: "${fixtureId}", name: "Synthetic cache removal fixture", address: "Invented test address", sourceUrl: "https://example.org/fixture", phone: null, lat: 51, lng: 0 });\n`);
    await build(root);
    const before = JSON.parse(await read(root, "dist/data/release.json"));
    assert.ok((await read(root, "dist/data/search-index.json")).includes(fixtureId));
    await stat(join(root, `dist/service/${fixtureId}/index.html`));
    await writeFile(join(root, generatedPath), original);
    await build(root);
    const after = JSON.parse(await read(root, "dist/data/release.json"));
    for (const key of ["release", "runtimeAssetRelease", "directoryRelease", "savedServicesRelease", "offlineRelease"]) {
      assert.match(before[key], /^[a-f0-9]{12}$/);
      assert.notEqual(after[key], before[key], `${key} must rotate for data-only changes`);
    }
    assert.equal(before.runtimeAssetRelease, before.release);
    assert.equal(after.runtimeAssetRelease, after.release);
    assert.equal(before.resourceCount, after.resourceCount + 1);
    assert.ok((await read(root, "dist/index.html")).includes(`/src/bootstrap.js?v=${after.release}`));
    assert.ok((await read(root, "dist/src/bootstrap.js")).includes(`./app.js?v=${after.release}`));
    assert.ok((await read(root, "dist/src/app.js")).includes(`./data/resources.js?v=${after.release}`));
    assert.ok((await read(root, "dist/src/data/resources.js")).includes(`./generated/trussell-foodbanks.js?v=${after.release}`));
    assert.ok((await read(root, "dist/directory/index.html")).includes(`${after.offlineAssets["/directory.js"]}?v=${after.directoryRelease}`));
    assert.ok((await read(root, "dist/sw.js")).includes(`rwn-offline-${after.offlineRelease}`));
    for (const path of [generatedPath, "data/search-index.json", "data/resources.json", "directory.csv", "sitemap.xml"]) {
      assert.equal((await read(root, `dist/${path}`)).includes(fixtureId), false, path);
    }
    await assert.rejects(stat(join(root, `dist/service/${fixtureId}/index.html`)), { code: "ENOENT" });
    // Exercise the final worker transform independently: unchanged final bytes
    // retain the cache identity, while an HTML-only output change rotates it.
    const versionWorker = ["node", "scripts/version-offline-worker.mjs"];
    await cp(join(root, "public/sw.js"), join(root, "dist/sw.js"));
    await build(root, versionWorker);
    assert.equal(JSON.parse(await read(root, "dist/data/release.json")).offlineRelease, after.offlineRelease);
    await writeFile(join(root, "dist/directory/index.html"), `${await read(root, "dist/directory/index.html")}\n<!-- synthetic output-only change -->`);
    await cp(join(root, "public/sw.js"), join(root, "dist/sw.js"));
    await build(root, versionWorker);
    const transformed = JSON.parse(await read(root, "dist/data/release.json"));
    assert.notEqual(transformed.offlineRelease, after.offlineRelease, "different warm HTML must not share the active cache name");
    assert.deepEqual(transformed.offlineAssets, after.offlineAssets, "identical runtime bytes keep stable path identities");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
