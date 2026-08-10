import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import { resources } from "../src/data/resources.js";

const text = (path) => readFile(path, "utf8");

function sitemapEntry(sitemap, path) {
  const url = `https://www.realworldneeds.org${path}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sitemap.match(new RegExp(`<url><loc>${url}<\\/loc>(?:<lastmod>([^<]+)<\\/lastmod>)?<\\/url>`));
}

test("homepage ships world-class UX assets and accurate organization semantics", async () => {
  const html = await text("dist/index.html");
  const release = JSON.parse(await text("dist/data/release.json"));
  assert.match(html, new RegExp(`/src/world-class\\.css\\?v=${release.release}`));
  assert.match(html, /How listings are checked/);
  assert.match(html, /Transparency/);
  assert.doesNotMatch(html, /"logo":"https:\/\/www\.realworldneeds\.org\/media\/rwn-social\.jpg"/);
  assert.match(html, /"image":\s*"https:\/\/www\.realworldneeds\.org\/media\/rwn-social\.jpg"/);
});

test("bootstrap loads the world-class interaction layer with the release hash", async () => {
  const bootstrap = await text("dist/src/bootstrap.js");
  const { release } = JSON.parse(await text("dist/data/release.json"));
  assert.match(bootstrap, new RegExp(`import\\(\"\\./world-class\\.js\\?v=${release}\"\\)`));
  assert.match(bootstrap, /installWorldClassUX\(\)/);
});

test("directory pages remain indexable HTML while gaining whole-catalog search", async () => {
  const html = await text("dist/directory/index.html");
  const release = JSON.parse(await text("dist/data/release.json"));
  assert.match(release.directoryRelease, /^[a-f0-9]{12}$/);
  assert.match(html, /data-directory-search/);
  assert.match(html, /data-directory-query/);
  assert.match(html, /data-directory-categories/);
  assert.match(html, new RegExp(`/directory-enhancements\\.css\\?v=${release.directoryRelease}`));
  assert.match(html, new RegExp(`/directory\\.js\\?v=${release.directoryRelease}`));
  assert.match(html, /<article class="directory-record"/);
  assert.doesNotMatch(html, /noindex/);
});

test("whole-catalog directory search uses a static privacy-preserving contextual index", async () => {
  const client = await text("public/directory.js");
  const searchIndex = JSON.parse(await text("dist/data/search-index.json"));
  assert.equal(searchIndex.schemaVersion, "1.2");
  assert.equal(searchIndex.resourceCount, resources.length);
  assert.equal(searchIndex.records.length, resources.length);
  assert.match(searchIndex.privacy, /Search terms remain in the visitor's browser/);
  assert.ok(searchIndex.scopes && typeof searchIndex.scopes === "object");
  assert.match(client, /new URL\(import\.meta\.url\)\.searchParams\.get\("v"\)/);
  assert.match(client, /searchIndexUrl = `\/data\/search-index\.json\$\{releaseVersion/);
  assert.match(client, /fetch\(searchIndexUrl/);
  assert.match(client, /payload\.scopes\[currentScope\]/);
  assert.doesNotMatch(client, /XMLHttpRequest|sendBeacon|localStorage|sessionStorage|geolocation|location\.search/);
  assert.doesNotMatch(client, /input\?\.value.*searchIndexUrl|searchIndexUrl.*input\?\.value/);
  assert.match(client, /MAX_RESULTS = 60/);
  assert.match(client, /Escape/);
  for (const record of searchIndex.records.slice(0, 10)) {
    assert.deepEqual(Object.keys(record).sort(), ["categories", "category", "categoryLabels", "checked", "country", "id", "kind", "name", "place", "search"].sort());
  }
  const usIndex = searchIndex.records.findIndex((record) => record.country === "United States");
  assert.ok(usIndex >= 0);
  assert.ok(searchIndex.scopes["/directory/united-states"].includes(usIndex));
  for (const indexes of Object.values(searchIndex.scopes)) {
    assert.ok(indexes.every((index) => Number.isInteger(index) && index >= 0 && index < searchIndex.records.length));
  }
});

test("service pages add crawlable related-help links and source-backed accessibility notes", async () => {
  const sample = resources.find((resource) => resource.id === "bowery-mission") || resources[0];
  const html = await text(`dist/service/${sample.id}/index.html`);
  assert.match(html, /class="related-services"/);
  assert.match(html, /Other help near|Related help in|Related essential services/);
  const relatedLinks = html.match(/href="\/service\//g) || [];
  assert.ok(relatedLinks.length >= 2, "service page should link to at least one other permanent service page");

  const accessible = resources.find((resource) => resource.accessibilityNote);
  assert.ok(accessible, "catalog should contain a source-backed accessibility note");
  const accessibleHtml = await text(`dist/service/${accessible.id}/index.html`);
  assert.match(accessibleHtml, /class="service-accessibility"/);
  assert.ok(accessibleHtml.includes(accessible.accessibilityNote));
});

test("sitemap freshness follows the resource data instead of one fake global date", async () => {
  const sitemap = await text("dist/sitemap.xml");
  const sample = resources.find((resource) => resource.id === "bowery-mission") || resources[0];
  const service = sitemapEntry(sitemap, `/service/${sample.id}`);
  assert.ok(service, "sample service should exist in sitemap");
  assert.equal(service[1], sample.lastChecked);

  for (const path of ["/privacy", "/terms", "/accessibility", "/editorial-policy"]) {
    const entry = sitemapEntry(sitemap, path);
    assert.ok(entry, `${path} should exist in sitemap`);
    assert.equal(entry[1], undefined, `${path} should not claim a resource-review lastmod`);
  }
});

test("local SEO manifest uses qualified locality metadata and unique canonical paths", async () => {
  const manifest = JSON.parse(await text("dist/data/resources/local-index.json"));
  assert.equal(manifest.schemaVersion, "1.2");
  assert.equal(manifest.pageCount, manifest.cities.length);
  assert.equal(new Set(manifest.cities.map((entry) => entry.path)).size, manifest.cities.length);
  assert.equal(manifest.categoryPageCount, manifest.cities.reduce((sum, entry) => sum + entry.categories.length, 0));
  for (const entry of manifest.cities) {
    assert.match(entry.lastmod, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.count >= manifest.minimumListings);
    assert.ok(Object.hasOwn(entry, "administrativeArea"));
    assert.ok(Array.isArray(entry.categories));
    for (const category of entry.categories) {
      assert.ok(category.count >= manifest.minimumCategoryListings);
      assert.ok(category.path.startsWith(`${entry.path}/help/`));
      assert.match(category.lastmod, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("local need pages are crawlable, useful, and linked from their city page", async () => {
  const manifest = JSON.parse(await text("dist/data/resources/local-index.json"));
  const city = manifest.cities.find((entry) => entry.categories.length > 0);
  assert.ok(city, "at least one local directory should have a sufficiently deep need-specific page");
  const category = city.categories[0];
  const cityHtml = await text(`dist${city.path}/index.html`);
  const categoryHtml = await text(`dist${category.path}/index.html`);
  assert.ok(cityHtml.includes(category.path), "city page should crawlably link to local need page");
  assert.match(categoryHtml, /"@type":"CollectionPage"/);
  assert.match(categoryHtml, /Visit original source/);
  assert.match(categoryHtml, /data-directory-search/);
  assert.ok((categoryHtml.match(/<article class="directory-record"/g) || []).length >= manifest.minimumCategoryListings);

  const sitemap = await text("dist/sitemap.xml");
  const entry = sitemapEntry(sitemap, category.path);
  assert.ok(entry, "local need page should be in sitemap");
  assert.equal(entry[1], category.lastmod);
});

test("country pages expose local directories through normal crawlable links", async () => {
  const manifest = JSON.parse(await text("dist/data/resources/local-index.json"));
  const us = manifest.cities.find((entry) => entry.country === "United States");
  assert.ok(us, "United States should have an eligible local directory");
  const html = await text("dist/directory/united-states/index.html");
  assert.match(html, /class="directory-local-links"/);
  assert.ok(html.includes(us.path));
});

test("new interaction layers and search index stay within deliberate budgets", async () => {
  const budgets = [
    ["src/world-class.js", 10_000],
    ["src/world-class.css", 12_000],
    ["public/directory.js", 12_000],
    ["public/directory-enhancements.css", 18_000],
    ["dist/data/search-index.json", 1_500_000]
  ];
  for (const [path, maximum] of budgets) {
    const { size } = await stat(path);
    assert.ok(size <= maximum, `${path} is ${size.toLocaleString()} bytes; budget is ${maximum.toLocaleString()} bytes`);
  }
});

test("accessibility layer includes mobile target sizing, forced-colors, reduced-motion, and below-fold containment", async () => {
  const css = await text("src/world-class.css");
  const script = await text("src/world-class.js");
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(script, /removeAttribute\("aria-live"\)/);
  assert.match(script, /aria-keyshortcuts/);
});
