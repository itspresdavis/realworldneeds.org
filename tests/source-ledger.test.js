import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resources } from "../src/data/resources.js";
import { sourceRegistry } from "../src/data/live-sources.js";

const read = (path) => readFile(path, "utf8");

function unregisteredSourceGroups() {
  const registered = new Set(sourceRegistry.map((source) => source.id));
  return new Set(resources
    .filter((resource) => !resource.datasetId || !registered.has(resource.datasetId))
    .map((resource) => resource.sourceName || "Original source"));
}

test("source ledger publishes every structured source family with audit context", async () => {
  const html = await read("dist/sources/index.html");
  assert.match(html, /<title>Data Sources &amp; Provenance \| Real World Needs<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.realworldneeds\.org\/sources"/);
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.match(html, /inclusion does not imply sponsorship, endorsement, or a partnership with RWN/i);
  assert.match(html, /Machine-readable source registry/);
  assert.match(html, /Full resource JSON/);

  for (const source of sourceRegistry) {
    assert.ok(html.includes(source.title), `source ledger missing ${source.title}`);
    assert.ok(html.includes(source.owner), `source ledger missing owner ${source.owner}`);
    assert.ok(html.includes(source.sourceUrl.replaceAll("&", "&amp;")), `source ledger missing source URL ${source.sourceUrl}`);
    assert.ok(html.includes(source.auditedAt || source.sourceUpdatedAt), `source ledger missing audit/source date for ${source.id}`);
  }
});

test("source ledger release metadata matches the registry and record-level source groups", async () => {
  const release = JSON.parse(await read("dist/data/release.json"));
  const expectedOther = unregisteredSourceGroups();
  assert.equal(release.sourceLedger?.structuredSourceFamilies, sourceRegistry.length);
  assert.equal(release.sourceLedger?.originalSourceGroups, expectedOther.size);
  assert.equal(release.sourceLedger?.totalSourceGroups, sourceRegistry.length + expectedOther.size);
  assert.match(release.sourceLedger?.lastmod || "", /^\d{4}-\d{2}-\d{2}$/);
});

test("source ledger is crawlable and discoverable from transparency", async () => {
  const sitemap = await read("dist/sitemap.xml");
  const transparency = await read("dist/transparency.html");
  assert.match(sitemap, /<loc>https:\/\/www\.realworldneeds\.org\/sources<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(transparency, /href="\/sources">Browse source ledger<\/a>/);
  assert.match(transparency, /href="\/sources">Human source ledger<\/a>/);
  assert.match(transparency, /href="\/sources">Sources<\/a>/);
});

test("source ledger structured data describes a collection without inventing endorsements", async () => {
  const html = await read("dist/sources/index.html");
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "source ledger JSON-LD missing");
  const data = JSON.parse(match[1]);
  const graph = data["@graph"] || [];
  const collection = graph.find((node) => node["@type"] === "CollectionPage");
  const list = graph.find((node) => node["@type"] === "ItemList");
  assert.equal(collection?.url, "https://www.realworldneeds.org/sources");
  assert.equal(list?.numberOfItems, sourceRegistry.length + unregisteredSourceGroups().size);
  assert.doesNotMatch(JSON.stringify(data), /partner|sponsor|endorsedBy/i);
});
