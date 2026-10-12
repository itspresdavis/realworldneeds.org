import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resources } from "../src/data/resources.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";
import { relatedResources } from "../scripts/related-resources.mjs";
import { formatResourcePlace, isExactServiceSite } from "../src/utils/geo.js";

const byId = new Map(resources.map((resource) => [resource.id, resource]));
const types = (resource) => [resource.category, ...(resource.secondaryCategories || [])];
const escaped = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const readRelated = async (resource) => {
  const html = await readFile(new URL(`../dist/service/${resource.id}/index.html`, import.meta.url), "utf8");
  const section = html.match(/<section class="related-services"[\s\S]*?<\/section>/)?.[0] || "";
  const ids = [...section.matchAll(/href="\/service\/([^"?]+)"/g)].map((match) => decodeURIComponent(match[1]));
  return { section, ids };
};

for (const id of ["capuchin-day-centre", "third-space-brisbane"]) {
  test(`${id} recommends only listings in its declared country`, async () => {
    const resource = byId.get(id);
    const { section, ids } = await readRelated(resource);
    assert.ok(ids.length > 0);
    assert.doesNotMatch(section, /Other help near/);
    assert.ok(ids.every((id) => byId.get(id)?.country === resource.country), `${id}: ${ids.join(", ")}`);
  });
}

test("every generated service page keeps related-card geography and scope truthful", async () => {
  const violations = [];
  for (const resource of resources) {
    const { section, ids } = await readRelated(resource);
    assert.ok(section, `${resource.id}: related help or browse fallback exists`);
    assert.deepEqual(ids, relatedResources(resource, resources).map(({ candidate }) => candidate.id), resource.id);
    assert.doesNotMatch(section, /\bkm away\b|\bDirections\b|maps\.google|maps\.apple/, resource.id);
    assert.equal(section.includes('class="related-services__grid"'), ids.length > 0, `${resource.id}: no empty grid`);
    assert.match(section, /eligibility/, resource.id);
    if (ids.length < 6) {
      assert.match(section, /Other places and wider coverage/, resource.id);
      assert.match(section, /href="\/directory">Browse the full directory/, resource.id);
      assert.match(section, /Listings may cover different places/, resource.id);
    } else assert.doesNotMatch(section, /related-services__broader/, resource.id);
    if (!ids.length) assert.match(section, /Explore more help/, resource.id);
    else if (resource.country === "Global") assert.match(section, /Related networks and finders/, resource.id);
    else assert.ok(section.includes(`Related help in ${resource.country.replaceAll("&", "&amp;").replaceAll("'", "&#39;")}`), resource.id);
    if (/Other help near/.test(section)) violations.push(`${resource.id}: unsupported nearby heading`);
    if (ids.length > 6 || new Set(ids).size !== ids.length || ids.includes(resource.id)) violations.push(`${resource.id}: invalid card set`);
    for (const id of ids) {
      const candidate = byId.get(id);
      const card = section.match(new RegExp(`<a href="/service/${encodeURIComponent(id)}">[\\s\\S]*?</a>`))?.[0];
      const place = candidate.kind === "direct" && isExactServiceSite(candidate)
        ? formatResourcePlace(candidate)
        : candidate.country === "Global" ? "Check provider coverage" : candidate.country;
      assert.ok(card?.includes(`<span>${escaped(place)}</span>`), `${resource.id}: truthful card place for ${id}`);
      if (!candidate || candidate.country !== resource.country || sourceClosureNotice(candidate)
        || !types(candidate).some((type) => types(resource).includes(type))) violations.push(`${resource.id}: out-of-scope ${id}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("sparse, no-match and Global pages expose honest useful browse paths", async () => {
  const capuchin = await readRelated(byId.get("capuchin-day-centre"));
  assert.deepEqual(capuchin.ids, ["unhcr-help-ireland"]);
  assert.match(capuchin.section, /Resource finder/);
  assert.match(capuchin.section, /<span>Ireland<\/span>/);
  assert.doesNotMatch(capuchin.section, /Dublin/);
  const noMatch = await readRelated(byId.get("unhcr-help-austria"));
  assert.deepEqual(noMatch.ids, []);
  assert.match(noMatch.section, /A missing listing does not mean help is unavailable/);
  const global = await readRelated(byId.get("global-foodbanking-network"));
  assert.ok(global.ids.length > 0);
  assert.doesNotMatch(global.section, /Related help in Global|near |km away/);
  assert.ok(global.ids.every((id) => ["network", "locator"].includes(byId.get(id).kind)));
});
