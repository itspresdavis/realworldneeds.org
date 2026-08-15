import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("directory pages offer a compact direct route to the first listing while preserving browse navigation", async () => {
  const build = await read("scripts/build.mjs");
  const css = await read("public/professional-pages.css");
  assert.match(build, /class="directory-results-jump" href="#directory-results"/);
  assert.match(build, /class="directory-results-anchor" id="directory-results" tabindex="-1"/);
  assert.match(css, /\.directory-results-jump/);
});

test("static scale remains guarded by explicit route and payload budgets", async () => {
  const scale = await read("scripts/check-static-scale.mjs");
  const packageJson = JSON.parse(await read("package.json"));
  assert.match(scale, /files: 3200/);
  assert.match(scale, /htmlPages: 2900/);
  assert.match(scale, /searchIndexBytes: 1_500_000/);
  assert.match(packageJson.scripts.check, /scripts\/check-static-scale\.mjs/);
});
