import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { resources } from "../src/data/resources.js";

async function text(path) {
  return readFile(path, "utf8");
}

test("built homepage uses one content-derived release version for every shipped source asset", async () => {
  const html = await text("dist/index.html");
  const release = JSON.parse(await text("dist/data/release.json"));
  assert.match(release.release, /^[a-f0-9]{12}$/);
  assert.equal(release.presentationRelease, release.release);
  assert.match(html, new RegExp(`/src/styles\\.css\\?v=${release.release}`));
  assert.match(html, new RegExp(`/src/clarity\\.css\\?v=${release.release}`));
  assert.match(html, new RegExp(`/src/app\\.js\\?v=${release.release}`));
  assert.match(html, new RegExp(`/src/bootstrap\\.js\\?v=${release.release}`));
  assert.doesNotMatch(html, /<script[^>]+src="\/src\/professional\.js/);
  assert.doesNotMatch(html, /\/src\/(?:professional|experience|refinement|world-class)\.css\?v=/);
  assert.match(html, /data-rwn-critical-shell/);
  assert.doesNotMatch(html, /rwn-2026\d+/);
});

test("built homepage contains useful server-visible finder content before JavaScript", async () => {
  const html = await text("dist/index.html");
  assert.match(html, /<main class="preboot-finder"/);
  assert.match(html, /Find essential services near you/);
  assert.match(html, /Listings include provider contact details, the original source, and the date RWN checked it/);
  assert.match(html, /\/directory\/help\/food/);
  assert.match(html, /Browse the full directory/);
  assert.doesNotMatch(html, /No account required\. No paywall/);
});

test("built bootstrap installs release-versioned finder, presentation, and accessibility layers", async () => {
  const bootstrap = await text("dist/src/bootstrap.js");
  const { release } = JSON.parse(await text("dist/data/release.json"));
  assert.match(bootstrap, new RegExp(`import\\(\"\\./app\\.js\\?v=${release}\"\\)`));
  assert.match(bootstrap, new RegExp(`import\\(\"\\./refinement\\.js\\?v=${release}\"\\)`));
  assert.match(bootstrap, new RegExp(`import\\(\"\\./professional\\.js\\?v=${release}\"\\)`));
  assert.match(bootstrap, new RegExp(`import\\(\"\\./accessibility\\.js\\?v=${release}\"\\)`));
  assert.match(bootstrap, /installRefinements\(\);/);
  assert.match(bootstrap, /installProfessionalPresentation\(\);/);
  assert.match(bootstrap, /installAccessibility\(\)/);
});

test("production app output cannot render numeric cluster badges", async () => {
  const app = await text("dist/src/app.js");
  assert.doesNotMatch(app, /<span><b>\$\{cluster\.members\.length\}<\/b><\/span>/);
  assert.match(app, /<span aria-hidden="true"><\/span>/);
  assert.match(app, /aria-label="Explore \$\{cluster\.members\.length\} grouped listings"/);
});

test("directory pages cap DOM size and expose crawlable geographic pages", async () => {
  const firstPage = await text("dist/directory/index.html");
  const recordCount = (firstPage.match(/<article class="directory-record"/g) || []).length;
  assert.equal(recordCount, 80);
  assert.match(firstPage, /Browse by need/);
  assert.match(firstPage, /Browse by region/);
  assert.match(firstPage, /Browse by country/);
  assert.match(firstPage, /href="\/directory\/united-states"/);

  const secondPage = await text("dist/directory/page/2/index.html");
  assert.ok((secondPage.match(/<article class="directory-record"/g) || []).length <= 80);
  assert.match(secondPage, /Page 2 of/);

  const us = await text("dist/directory/united-states/index.html");
  assert.match(us, /Free essential services in United States/);
});

test("help-by-need pages are canonical, structured, and source connected", async () => {
  const food = await text("dist/directory/help/food/index.html");
  assert.match(food, /Find free food help/);
  assert.match(food, /rel="canonical" href="https:\/\/www\.realworldneeds\.org\/directory\/help\/food"/);
  assert.match(food, /"@type":"CollectionPage"/);
  assert.match(food, /"@type":"ItemList"/);
  assert.match(food, /View details/);
  assert.match(food, /Official source/);

  const manifest = JSON.parse(await text("dist/data/resources/index.json"));
  assert.ok(Array.isArray(manifest.categories));
  assert.ok(manifest.categories.some((entry) => entry.type === "food" && entry.count > 0));
  const categoryFiles = await readdir("dist/data/resources/by-category");
  assert.ok(categoryFiles.includes("food.json"));
});

test("every reviewed resource gets an indexable service detail page", async () => {
  const sample = resources[0];
  const html = await text(`dist/service/${sample.id}/index.html`);
  assert.match(html, new RegExp(`<h1>${sample.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`));
  assert.match(html, /"@type":"Service"/);
  assert.match(html, /Official source/);
  assert.match(html, /Show on RWN map/);

  const serviceDirectories = await readdir("dist/service");
  assert.equal(serviceDirectories.length, resources.length);
});

test("sitemap includes need pages and individual service pages", async () => {
  const sitemap = await text("dist/sitemap.xml");
  assert.match(sitemap, /https:\/\/www\.realworldneeds\.org\/directory\/help\/food/);
  assert.match(sitemap, new RegExp(`https:\\/\\/www\\.realworldneeds\\.org\\/service\\/${resources[0].id}`));
  assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test("compact map index contains only lightweight globe fields", async () => {
  const data = JSON.parse(await text("dist/data/map-index.json"));
  assert.equal(data.resourceCount, resources.length);
  assert.equal(data.resources.length, resources.length);
  const allowed = ["category", "country", "id", "kind", "lat", "lng", "region"];
  for (const record of data.resources) {
    assert.deepEqual(Object.keys(record).sort(), allowed);
    assert.equal(typeof record.id, "string");
    assert.equal(typeof record.lat, "number");
    assert.equal(typeof record.lng, "number");
  }
});

test("country shards cover the full reviewed catalog exactly once", async () => {
  const manifest = JSON.parse(await text("dist/data/resources/index.json"));
  assert.equal(manifest.resourceCount, resources.length);
  assert.equal(manifest.countries.reduce((sum, entry) => sum + entry.count, 0), resources.length);
  const slugs = manifest.countries.map((entry) => entry.slug);
  assert.equal(new Set(slugs).size, slugs.length);

  const files = await readdir("dist/data/resources/by-country");
  assert.equal(files.length, manifest.countries.length);
});
