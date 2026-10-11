import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { resources } from "../src/data/resources.js";

const read = path => readFile(path, "utf8");
const idsOnPage = html => [...html.matchAll(/<article class="directory-record"[\s\S]*?<\/article>/g)]
  .map(([card]) => decodeURIComponent(card.match(/href="\/service\/([^"]+)"/)?.[1] || ""));

async function localPagePaths(directory = "dist/directory/local") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await localPagePaths(path));
    else if (entry.name === "index.html") paths.push(directory.slice(4));
  }
  return paths.sort();
}

test("every generated local city and need page has exactly the same searchable listings", async () => {
  const index = JSON.parse(await read("dist/data/search-index.json"));
  const manifest = JSON.parse(await read("dist/data/resources/local-index.json"));
  const scopes = manifest.cities.flatMap(city => [city.path, ...city.categories.map(category => category.path)]).sort();
  assert.deepEqual(await localPagePaths(), scopes, "the parity sweep must cover every generated local page");
  assert.deepEqual(Object.keys(index.scopes).filter(path => path.startsWith("/directory/local/")).sort(), scopes,
    "local search must neither omit a page nor invent an additional local scope");
  const mismatches = [];
  for (const path of scopes) {
    const listed = idsOnPage(await read(`dist${path}/index.html`));
    const searchable = index.scopes[path].map(position => index.records[position]?.id);
    assert.ok(listed.length > 0 && listed.every(Boolean), path);
    assert.equal(new Set(listed).size, listed.length, `${path}: duplicate static listing`);
    assert.equal(new Set(searchable).size, searchable.length, `${path}: duplicate search listing`);
    if (JSON.stringify([...listed].sort()) !== JSON.stringify([...searchable].sort())) {
      mismatches.push({ path, missing: listed.filter(id => !searchable.includes(id)), extra: searchable.filter(id => !listed.includes(id)) });
    }
  }
  assert.deepEqual(mismatches, []);
});

test("New York city and referral search keep the existing library and WIC listings", async () => {
  const index = JSON.parse(await read("dist/data/search-index.json"));
  const cityPath = "/directory/local/united-states/new-york";
  const cityIds = resources.filter(item => item.city === "New York" && item.country === "United States").map(item => item.id);
  const referralIds = resources.filter(item => cityIds.includes(item.id) && [item.category, ...(item.secondaryCategories || [])].includes("referral")).map(item => item.id);
  for (const [path, ids] of [[cityPath, cityIds], [`${cityPath}/help/referral`, referralIds]]) {
    assert.deepEqual((index.scopes[path] || []).map(position => index.records[position].id).sort(), [...ids].sort(), path);
    assert.ok(ids.includes("new-york-public-library-access"), path);
    assert.ok(ids.includes("ny-wic-312-01"), path);
  }
});

test("country, region and global need scopes retain their complete source-defined membership", async () => {
  const index = JSON.parse(await read("dist/data/search-index.json"));
  const slug = value => String(value || "unknown").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  const expected = new Map();
  for (const item of resources) {
    const paths = [`/directory/${slug(item.country)}`, ...[item.category, ...(item.secondaryCategories || [])].map(type => `/directory/help/${slug(type)}`)];
    if (item.region) paths.push(`/directory/region/${slug(item.region)}`);
    for (const path of new Set(paths)) {
      if (!expected.has(path)) expected.set(path, []);
      expected.get(path).push(item.id);
    }
  }
  assert.deepEqual(Object.keys(index.scopes).filter(path => !path.startsWith("/directory/local/")).sort(), [...expected.keys()].sort());
  for (const [path, ids] of expected) {
    assert.deepEqual(index.scopes[path].map(position => index.records[position].id), ids, path);
  }
});
