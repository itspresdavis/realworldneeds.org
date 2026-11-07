import { SEARCH_CATALOG_SCHEMA } from "../public/catalog-request.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resources } from "../src/data/resources.js";

const text = (path) => readFile(path, "utf8");

function primaryLabels(html) {
  const nav = html.match(/<nav class="rwn-page-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || "";
  return [...nav.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((match) => match[1].trim());
}

test("public pages share one task-first navigation order and an explicit mobile Menu", async () => {
  const pages = await Promise.all([
    text("dist/directory/index.html"),
    text("dist/service/whitechapel-mission/index.html"),
    text("dist/transparency.html"),
    text("dist/editorial-policy.html")
  ]);
  const expected = ["Find help", "Directory", "Saved", "About RWN", "How listings are checked", "Sources", "Transparency"];
  for (const html of pages) {
    assert.deepEqual(primaryLabels(html), expected);
    assert.match(html, /class="rwn-page-menu"/);
    assert.match(html, /<summary[^>]*>Menu<\/summary>/);
    assert.match(html, /\/navigation-actions\.[a-f0-9]{12}\.css\?v=[a-f0-9]{12}/);
    assert.match(html, /class="legal-footer rwn-unified-footer"/);
  }
});

test("directory rows put urgent actions first and keep verification detail one disclosure away", async () => {
  const firstPage = resources.slice(0, 60);
  const resource = firstPage.find((item) => item.kind === "direct" && item.phone) || firstPage.find((item) => item.kind === "direct");
  assert.ok(resource, "a first-page direct service is required for action QA");
  const html = await text("dist/directory/index.html");
  const encodedId = encodeURIComponent(resource.id);
  const record = html.match(new RegExp(`<article class="directory-record"[^>]*>[\\s\\S]*?href="/service/${encodedId}"[\\s\\S]*?</article>`))?.[0] || "";
  assert.match(record, new RegExp(`data-rwn-actions="${resource.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  if (resource.phone) assert.match(record, /href="tel:/);
  assert.match(record, /google\.com\/maps\/dir\/\?api=1&amp;destination=/);
  assert.match(record, />Open listing<\/a>/);
  assert.match(record, /<details class="directory-record__more">/);
  assert.match(record, />Official source<\/a>/);
  assert.doesNotMatch(record, /directory-quick-actions/);
});

test("service pages make call and one clear directions choice immediate while preserving source verification", async () => {
  const resource = resources.find((item) => item.kind === "direct" && item.phone) || resources.find((item) => item.kind === "direct");
  assert.ok(resource);
  const html = await text(`dist/service/${resource.id}/index.html`);
  const next = html.match(/<nav class="service-next-steps"[\s\S]*?<\/nav>/)?.[0] || "";
  if (resource.phone) assert.match(next, /class="is-call"[^>]+href="tel:/);
  assert.match(next, /class="is-map is-directions"[^>]+google\.com\/maps\/dir\/\?api=1&amp;destination=/);
  assert.doesNotMatch(next, /maps\.apple\.com\/\?daddr=/);
  assert.match(next, /class="is-primary"[^>]*>[\s\S]*?<strong>Official source<\/strong>/);
  assert.match(next, /href="\/#resource=/);
});

test("resource-finder service pages do not promise directions and explain their non-walk-in status", async () => {
  const resource = resources.find((item) => item.kind === "locator" || item.kind === "network");
  assert.ok(resource);
  const html = await text(`dist/service/${resource.id}/index.html`);
  const next = html.match(/<nav class="service-next-steps"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.doesNotMatch(next, /Get directions/);
  assert.doesNotMatch(next, /class="is-map is-directions"/);
  assert.match(next, /not a walk-in location/);
  assert.match(next, /Official source/);
});

test("whole-directory search index carries only the fields needed for immediate actions", async () => {
  const payload = JSON.parse(await text("dist/data/search-index.json"));
  assert.equal(payload.schemaVersion, SEARCH_CATALOG_SCHEMA);
  const direct = payload.records.find((record) => record.kind === "direct");
  assert.ok(direct);
  assert.ok(Object.hasOwn(direct, "phone"));
  assert.ok(Object.hasOwn(direct, "lat"));
  assert.ok(Object.hasOwn(direct, "lng"));
});

test("advanced directory downloads and broad browse links stay available without leading the task flow", async () => {
  const html = await text("dist/directory/index.html");
  assert.match(html, /<details class="directory-advanced"><summary>Download directory data<\/summary>/);
  assert.match(html, /<details class="directory-browse-more"><summary>Browse by location or type of help<\/summary>/);
  assert.match(html, /Download CSV/);
  assert.match(html, /Browse by country/);
});
