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
  assert.doesNotMatch(html, /"logo":"https:\/\/www\.realworldneeds\.org\/media\/earth-blue-marble\.jpg"/);
  assert.match(html, /"image":\s*"https:\/\/www\.realworldneeds\.org\/media\/earth-blue-marble\.jpg"/);
});

test("bootstrap loads the world-class interaction layer with the release hash", async () => {
  const bootstrap = await text("dist/src/bootstrap.js");
  const { release } = JSON.parse(await text("dist/data/release.json"));
  assert.match(bootstrap, new RegExp(`import\\(\"\\./world-class\\.js\\?v=${release}\"\\)`));
  assert.match(bootstrap, /installWorldClassUX\(\)/);
});

test("directory pages remain indexable HTML while gaining instant local filtering", async () => {
  const html = await text("dist/directory/index.html");
  const { release } = JSON.parse(await text("dist/data/release.json"));
  assert.match(html, /data-directory-search/);
  assert.match(html, /data-directory-query/);
  assert.match(html, /data-directory-categories/);
  assert.match(html, new RegExp(`/directory-enhancements\\.css\\?v=${release}`));
  assert.match(html, new RegExp(`/directory\\.js\\?v=${release}`));
  assert.match(html, /<article class="directory-record"/);
  assert.doesNotMatch(html, /noindex/);
});

test("directory filtering is privacy-minimizing and does not depend on network requests", async () => {
  const client = await text("public/directory.js");
  assert.doesNotMatch(client, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|geolocation|location\.search/);
  assert.match(client, /data-directory-query/);
  assert.match(client, /Escape/);
});

test("service pages add crawlable related-help links", async () => {
  const sample = resources.find((resource) => resource.id === "bowery-mission") || resources[0];
  const html = await text(`dist/service/${sample.id}/index.html`);
  assert.match(html, /class="related-services"/);
  assert.match(html, /Other help near|Related help in|Related essential services/);
  const relatedLinks = html.match(/href="\/service\//g) || [];
  assert.ok(relatedLinks.length >= 2, "service page should link to at least one other permanent service page");
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
  assert.equal(manifest.schemaVersion, "1.1");
  assert.equal(manifest.pageCount, manifest.cities.length);
  assert.equal(new Set(manifest.cities.map((entry) => entry.path)).size, manifest.cities.length);
  for (const entry of manifest.cities) {
    assert.match(entry.lastmod, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.count >= manifest.minimumListings);
    assert.ok(Object.hasOwn(entry, "administrativeArea"));
  }
});

test("new interaction layers stay intentionally small", async () => {
  const budgets = [
    ["src/world-class.js", 10_000],
    ["src/world-class.css", 12_000],
    ["public/directory.js", 7_000],
    ["public/directory-enhancements.css", 12_000]
  ];
  for (const [path, maximum] of budgets) {
    const { size } = await stat(path);
    assert.ok(size <= maximum, `${path} is ${size.toLocaleString()} bytes; budget is ${maximum.toLocaleString()} bytes`);
  }
});

test("accessibility layer includes mobile target sizing, forced-colors, and reduced-motion support", async () => {
  const css = await text("src/world-class.css");
  const script = await text("src/world-class.js");
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(script, /removeAttribute\("aria-live"\)/);
  assert.match(script, /aria-keyshortcuts/);
});
