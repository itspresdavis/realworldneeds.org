import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const text = (path) => readFile(path, "utf8");

test("local SEO pages are bounded to cities with enough reviewed listings", async () => {
  const manifest = JSON.parse(await text("dist/data/resources/local-index.json"));
  assert.equal(manifest.minimumListings, 3);
  assert.ok(manifest.pageCount > 0);
  assert.equal(manifest.pageCount, manifest.cities.length);
  for (const city of manifest.cities) {
    assert.ok(city.count >= manifest.minimumListings);
    assert.match(city.path, /^\/directory\/local\/[a-z0-9-]+\/[a-z0-9-]+$/);
  }
});

test("local SEO pages are canonical, source connected, and included in sitemap", async () => {
  const manifest = JSON.parse(await text("dist/data/resources/local-index.json"));
  const sample = manifest.cities[0];
  assert.ok(sample);
  const html = await text(`dist${sample.path}/index.html`);
  assert.match(html, new RegExp(`rel="canonical" href="https://www\\.realworldneeds\\.org${sample.path}"`));
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"@type":"ItemList"/);
  assert.match(html, /Visit original source/);
  assert.match(html, /Services can change/);

  const sitemap = await text("dist/sitemap.xml");
  assert.match(sitemap, new RegExp(`https://www\\.realworldneeds\\.org${sample.path}`));
});
