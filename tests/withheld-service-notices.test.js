import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { resources } from "../src/data/resources.js";

const notices = [
  {
    id: "breakthrough-daytime-support",
    source: "https://breakthrough.org/programs/daytime-support-center/",
    phones: ["+17733461785", "+18724448255"],
    oldLocation: /3219\s+W\.?\s+Carroll|FamilyPlex|41\.8871403|-87\.7072571/i
  },
  {
    id: "father-joes-day-center",
    source: "https://my.neighbor.org/get-help/",
    phones: ["+16192338500"],
    oldLocation: /299\s+17th|32\.7117|-117\.1486|(?:619\D*)?230\D*7390/i
  }
];

const text = (path) => readFile(path, "utf8");

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else files.push(path);
  }
  return files;
}

function assertSafeNotice(html, notice, label) {
  assert.match(html, /<meta name="robots" content="noindex, follow"\s*\/>/, `${label}: the notice must remain noindex`);
  assert.match(html, /<h1\b[^>]*>Location details under review<\/h1>/, `${label}: clearly explain the review`);
  assert.ok(html.includes(`data-rwn-service-notice="${notice.id}"`), `${label}: keep the reviewed notice marker`);
  assert.ok(html.includes(`href="https://www.realworldneeds.org/service/${notice.id}"`), `${label}: retain the old service route as the self-canonical`);
  assert.ok(html.includes(`href="${notice.source}"`), `${label}: keep the official access link`);
  for (const phone of notice.phones) assert.ok(html.includes(`href="tel:${phone}"`), `${label}: retain the provider phone ${phone}`);
  assert.match(html, /temporarily removed the map pin and directions/, `${label}: explain why directions are withheld`);
  assert.doesNotMatch(html, notice.oldLocation, `${label}: never repeat the misleading address, coordinates, or old contact`);
  assert.doesNotMatch(html, /<iframe\b|<button\b|<form\b|service-next-steps|data-service-id|data-service-save|data-service-utility/i, `${label}: no interactive listing controls or service-action activation hooks`);
  const scripts = [...html.matchAll(/<script\b[\s\S]*?<\/script>/gi)].map((match) => match[0]);
  if (label.startsWith("public/")) assert.deepEqual(scripts, [], `${label}: do not add bespoke JavaScript`);
  for (const script of scripts) {
    assert.match(script, /^<script type="module" src="\/(?:service-actions\.js|page-menu(?:\.[a-f0-9]{12})?\.js)\?v=[a-f0-9]{12}"><\/script>$/, `${label}: only existing shared build scripts are allowed`);
  }
  assert.doesNotMatch(html, /"@type"\s*:\s*"Service"|GeoCoordinates|PostalAddress/i, `${label}: no active service or location schema`);
  assert.doesNotMatch(html, /(?:google\.com\/maps|maps\.google\.|maps\.apple\.|openstreetmap\.|#resource=|data-save-resource|data-rwn-actions)/i, `${label}: no map, directions, or save actions`);
  assert.doesNotMatch(html, /permanently closed|service (?:is |has )?closed|fully verified|exact location|walk[- ]in/i, `${label}: avoid unsupported closure, verification, or access claims`);
  assert.match(html, /href="#content"/, `${label}: keep a skip link`);
  assert.match(html, /<main id="content"/, `${label}: keep a main landmark`);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/, `${label}: support mobile layout and zoom`);
  assert.match(html, /href="\/legal(?:\.[a-f0-9]{12})?\.css(?:\?[^"\s]*)?"/, `${label}: reuse the responsive site styles`);
}

for (const root of ["public", "dist"]) {
  for (const notice of notices) {
    test(`${root} notice for ${notice.id} keeps a safe, noindex provider route`, async () => {
      const path = `${root}/service/${notice.id}/index.html`;
      const html = await text(path);
      assertSafeNotice(html, notice, path);
      if (notice.id === "breakthrough-daytime-support") {
        assert.match(html, /two separate centres/);
        assert.match(html, /Men's Center: <a href="tel:\+17733461785">773-346-1785<\/a>/);
        assert.match(html, /Women's Center: <a href="tel:\+18724448255">872-444-8255<\/a>/);
      } else {
        assert.match(html, /Day Center visitor instructions and client-mail FAQ give different addresses/);
        assert.doesNotMatch(html, /mailing information previously used by RWN/);
        assert.match(html, /Day Center: <a href="tel:\+16192338500">619-233-8500<\/a>/);
      }
    });
  }
}

test("shared service actions remain inert on withheld notices", async () => {
  const source = await text("dist/service-actions.js");
  let queries = 0;
  vm.runInNewContext(source, {
    document: {
      querySelector(selector) {
        assert.equal(selector, ".service-next-steps");
        queries += 1;
        return null;
      },
      createElement() {
        assert.fail("A withheld notice must not acquire listing action controls");
      }
    }
  }, { timeout: 1_000 });
  assert.equal(queries, 1);
});

test("withheld notice IDs are absent from public resources, search, maps, shards and sitemap", async () => {
  const ids = new Set(notices.map((notice) => notice.id));
  assert.deepEqual(resources.filter((resource) => ids.has(resource.id)), [], "withheld locations must not enter the exported catalog");

  const files = [
    "dist/data/resources.json",
    "dist/data/search-index.json",
    "dist/data/map-index.json",
    "dist/directory.csv",
    "dist/sitemap.xml",
    ...await walkFiles("dist/data/resources"),
    ...await walkFiles("dist/directory")
  ];
  for (const path of files) {
    const content = await text(path);
    for (const id of ids) assert.ok(!content.includes(id), `${path}: ${id} must stay out of browseable catalog surfaces`);
  }
});
