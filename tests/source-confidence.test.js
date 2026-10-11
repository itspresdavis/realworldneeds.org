import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { resources } from "../src/data/resources.js";
import { freeAccessModels } from "../src/data/free-access.js";
import { sourceCheckRange } from "../scripts/source-check-range.mjs";

const read = path => readFile(path, "utf8");
const escape = text => String(text ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const byId = new Map(resources.map(resource => [resource.id, resource]));

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

test("source-check summaries describe the full date range without freshening older records", () => {
  assert.equal(sourceCheckRange(["2026-10-10", "2026-08-04", "2026-08-14"]), "2026-08-04 to 2026-10-10");
  assert.equal(sourceCheckRange(["2026-08-04", "2026-08-04"]), "2026-08-04");
  assert.equal(sourceCheckRange([null, undefined, ""]), "Date not recorded");
});

test("all static directory entry paths identify source checks and distinguish service networks", async () => {
  let localCards = 0;
  let networks = 0;
  for (const path of await htmlFiles("dist/directory")) {
    const html = await read(path);
    assert.doesNotMatch(html, />Checked (?:through )?\d{4}-/);
    for (const match of html.matchAll(/<article class="directory-record"[\s\S]*?<\/article>/g)) {
      const card = match[0];
      const resource = byId.get(card.match(/href="\/service\/([^"]+)"/)?.[1]);
      assert.ok(resource, path);
      assert.ok(card.includes(`Source checked ${resource.lastChecked}`), `${path}: ${resource.id}`);
      if (resource.kind === "network") {
        assert.match(card, /<p>Service network<\/p>/);
        networks++;
      }
      if (path.includes("/local/")) localCards++;
    }
  }
  assert.ok(localCards > 0 && networks > 0);
});

test("service pages explain the review boundary and reuse existing location and finder cost evidence", async () => {
  for (const resource of resources) {
    const html = await read(`dist/service/${resource.id}/index.html`);
    const hero = html.match(/<section class="legal-hero">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(hero.includes(`Source checked ${resource.lastChecked}`), resource.id);
    assert.match(html, /class="service-source-review"/);
    assert.match(html, /This date records a review of the linked source, not a confirmation of current service availability\./);
    assert.doesNotMatch(html, />Checked \d{4}-/);
    if (resource.coordinateNote) assert.ok(html.includes(`<p class="service-coordinate-note">${escape(resource.coordinateNote)}</p>`), resource.id);
    else assert.doesNotMatch(html, /class="service-coordinate-note"/);
    const costScope = html.match(/<p class="service-cost-scope">([\s\S]*?)<\/p>/)?.[1];
    assert.equal(costScope, resource.costModel === "free-navigation" ? escape(freeAccessModels[resource.costModel].description) : undefined, resource.id);
  }
});

test("local and source groups show source-check ranges and explain that listing dates differ", async () => {
  const index = JSON.parse(await read("dist/data/resources/local-index.json"));
  for (const city of index.cities) {
    for (const scope of [city.path, ...(city.categories || []).map(category => category.path)]) {
      const html = await read(`dist${scope}/index.html`);
      const dates = [...html.matchAll(/<article class="directory-record"[\s\S]*?<\/article>/g)]
        .map(match => byId.get(match[0].match(/href="\/service\/([^"]+)"/)?.[1])?.lastChecked);
      assert.ok(dates.length > 0 && dates.every(Boolean), scope);
      assert.ok(html.includes(`Source checks ${sourceCheckRange(dates)}`), scope);
    }
  }
  const ledger = await read("dist/sources/index.html");
  assert.doesNotMatch(ledger, /Checked through/);
  assert.ok(ledger.includes(`Listing source checks ${sourceCheckRange(resources.map(resource => resource.lastChecked))}`));
  assert.match(ledger, /Individual listing dates can differ/);
  assert.match(ledger, /do not confirm current service availability/);
});
