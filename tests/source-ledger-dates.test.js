import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { sourceCheckRange } from "../scripts/source-check-range.mjs";

const source = (await readFile("scripts/build-source-ledger.mjs", "utf8")).replace(/^import .*;\n/gm, "");
const registryEntry = (id, dates = {}) => ({
  id, title: id, owner: "Fixture publisher", sourceUrl: "https://example.invalid/" + id,
  mode: "reviewed-snapshot", ...dates,
});
const listing = dates => ({
  id: "fixture-listing", name: "Fixture listing", sourceName: "Fixture original source",
  category: "food", sourceUrl: "https://example.invalid/provider", ...dates,
});

async function generate(sourceRegistry, resources) {
  const files = new Map([
    ["dist/transparency.html", '<a href="/data/sources.json">View data sources</a>'],
    ["dist/sitemap.xml", '<?xml version="1.0"?><urlset></urlset>'],
    ["dist/data/release.json", "{}"],
  ]);
  await vm.runInNewContext("(async () => {\n" + source + "\n})()", {
    sourceRegistry, resources, sourceCheckRange, categories: { food: { label: "Food" } },
    Date: class { constructor() { throw Error("Build time must not become a review date"); } },
    mkdir: async () => {},
    readFile: async path => {
      assert.ok(files.has(path), "Unexpected fixture read " + path);
      return files.get(path);
    },
    writeFile: async (path, value) => files.set(path, value),
  });
  return files;
}
const cards = files => [...files.get("dist/sources/index.html").matchAll(/<article class="directory-record source-ledger-card">[\s\S]*?<\/article>/g)].map(match => match[0]);

test("source dates retain their own meaning and never inherit another entry's audit or listing date", async () => {
  const files = await generate([
    registryEntry("audited", { auditedAt: "2026-02-03", sourceUpdatedAt: "2026-05-04" }),
    registryEntry("updated-only", { sourceUpdatedAt: "2026-06-07" }),
    registryEntry("unknown"),
  ], [listing({ lastChecked: "2026-09-01" })]);
  const [audited, updated, unknown] = cards(files);
  assert.match(audited, /<time datetime="2026-02-03">Audited 2026-02-03<\/time>/);
  assert.match(updated, /<time datetime="2026-06-07">Source updated 2026-06-07<\/time>/);
  assert.doesNotMatch(updated, />Audited /);
  assert.match(unknown, /Audit date not recorded/);
  assert.doesNotMatch(unknown, /<time|\d{4}-\d{2}-\d{2}/);
  assert.equal(JSON.parse(files.get("dist/data/release.json")).sourceLedger.lastmod, "2026-09-01");
  assert.match(files.get("dist/sitemap.xml"), /<lastmod>2026-09-01<\/lastmod>/);
});

test("all missing dates stay unknown, omit sitemap lastmod and produce deterministic output", async () => {
  for (const [registry, resources] of [
    [[], []],
    [[registryEntry("unknown", { auditedAt: null, sourceUpdatedAt: "" })], [listing({})]],
  ]) {
    const first = await generate(registry, resources), second = await generate(registry, resources);
    assert.deepEqual([...first], [...second]);
    assert.equal(JSON.parse(first.get("dist/data/release.json")).sourceLedger.lastmod, null);
    assert.doesNotMatch(first.get("dist/sitemap.xml"), /<lastmod>/);
    assert.doesNotMatch(first.get("dist/sources/index.html"), /Audited \d{4}|<time/);
    assert.match(first.get("dist/sources/index.html"), /Date not recorded/);
  }
});
