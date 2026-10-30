import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("directory pages offer a compact direct route to the first listing while preserving browse navigation", async () => {
  const build = await read("scripts/build.mjs");
  const css = await read("public/professional-pages.css");
  assert.match(build, /class="directory-results-jump" href="#directory-results"/);
  assert.match(build, /class="directory-results-anchor" id="directory-results" tabindex="-1"/);
  const html = await read("dist/directory/index.html");
  assert.match(html, /href="#directory-browse"/);
  assert.doesNotMatch(html, /aria-label="Breadcrumb"/);
  const search = html.indexOf('data-directory-search');
  const tools = html.indexOf('class="directory-page-tools"');
  assert.ok(search >= 0 && tools > search, "search must exist before page controls when the root breadcrumb is omitted");
  const child = await read("dist/directory/help/food/index.html");
  assert.match(child, /aria-label="Breadcrumb"/);
  assert.match(child, /href="\/directory">Directory<\/a>/);
  const breadcrumb = child.indexOf('aria-label="Breadcrumb"');
  const childSearch = child.indexOf('data-directory-search');
  const childTools = child.indexOf('class="directory-page-tools"');
  assert.ok(breadcrumb >= 0 && childSearch > breadcrumb && childTools > childSearch, "child pages retain breadcrumb, search, then page controls");
  assert.ok(html.indexOf('class="directory-records"') < html.indexOf('id="directory-browse"'), "secondary browse panels must not delay the first listing");
  assert.match(html, /id="directory-browse" tabindex="-1"/);
  assert.match(html, /href="\/directory.csv" download/);
  assert.match(css, /\.directory-page-tools/);
});

test("static scale remains guarded by explicit route and payload budgets", async () => {
  const scale = await read("scripts/check-static-scale.mjs");
  const packageJson = JSON.parse(await read("package.json"));
  assert.match(scale, /files: 3200/);
  assert.match(scale, /htmlPages: 2900/);
  assert.match(scale, /searchIndexBytes: 1_500_000/);
  assert.match(packageJson.scripts.check, /scripts\/check-static-scale\.mjs/);
});
