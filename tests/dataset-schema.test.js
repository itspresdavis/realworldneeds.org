import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

function jsonLdGraphs(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
}

test("transparency center publishes crawlable open-data discovery metadata", async () => {
  const html = await read("dist/transparency.html");
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.match(html, /rel="alternate" type="application\/json" href="\/data\/resources\.json"/);
  assert.match(html, /rel="alternate" type="text\/csv" href="\/directory\.csv"/);
  assert.doesNotMatch(html, /\{\{(?:RESOURCE_COUNT|LATEST_REVIEW)\}\}/);

  const graphs = jsonLdGraphs(html);
  const nodes = graphs.flatMap((entry) => entry["@graph"] || [entry]);
  const dataset = nodes.find((node) => node["@type"] === "Dataset");
  const catalog = nodes.find((node) => node["@type"] === "DataCatalog");
  const page = nodes.find((node) => node["@type"] === "WebPage");

  assert.ok(dataset, "Dataset structured data missing");
  assert.ok(catalog, "DataCatalog structured data missing");
  assert.ok(page, "Transparency WebPage structured data missing");
  assert.equal(dataset.isAccessibleForFree, true);
  assert.match(dataset.dateModified || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(dataset.size || "", /^\d+ reviewed directory records$/);
  assert.equal(dataset.creator?.["@id"], "https://www.realworldneeds.org/#organization");

  const downloads = dataset.distribution || [];
  assert.ok(downloads.some((item) => item.encodingFormat === "text/csv" && item.contentUrl === "https://www.realworldneeds.org/directory.csv"));
  assert.ok(downloads.some((item) => item.encodingFormat === "application/json" && item.contentUrl === "https://www.realworldneeds.org/data/resources.json"));
});
