import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { selectDirectoryNeed } from "../scripts/qa-directory-need.mjs";

const read = path => readFile(path, "utf8");
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
async function pages(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await pages(join(dir, entry.name)));
    else if (entry.name === "index.html") result.push(join(dir, entry.name));
  }
  return result;
}

test("every generated directory exposes exactly its full scoped needs before search loads", async () => {
  const index = JSON.parse(await read("dist/data/search-index.json"));
  let checked = 0;
  for (const path of await pages("dist/directory")) {
    const html = await read(path);
    if (!html.includes("data-directory-search")) continue;
    const scope = path.replace(/^dist/, "").replace(/\/index\.html$/, "").replace(/\/page\/\d+$/, "");
    const records = scope === "/directory" ? index.records : index.scopes[scope].map(i => index.records[i]);
    const labels = [...new Set(records.flatMap(record => record.categoryLabels))].sort((a, b) => a.localeCompare(b));
    const select = html.match(/<label class="directory-need-field"><span>Type of help<\/span><select data-directory-need disabled>([\s\S]*?)<\/select><\/label>/);
    assert.ok(select, `${path}: labeled select is disabled until runtime owns it`);
    assert.deepEqual([...select[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(match => match.slice(1)), [["", "All help"], ...labels.map(label => [escapeHtml(label), escapeHtml(label)])], path);
    assert.equal((html.match(/data-directory-clear /g) || []).length, 1, path);
    assert.match(html, /class="directory-search-tools__meta">[\s\S]*?data-directory-clear/, path);
    checked++;
  }
  assert.equal(checked, 142, "Pagination, need, country, region and local pages must all be covered");
});

test("country local navigation is collapsed, alphabetical and preserves every published place link", async () => {
  const { cities } = JSON.parse(await read("dist/data/resources/local-index.json"));
  const groups = new Map();
  for (const entry of cities) { if (!groups.has(entry.country)) groups.set(entry.country, []); groups.get(entry.country).push(entry); }
  for (const [country, entries] of groups) {
    // Local routes contain country after /directory/local/; use the exact
    // published slug instead of recreating slug normalization in this test.
    const countrySlug = entries[0].path.split("/")[3];
    const html = await read(`dist/directory/${countrySlug}/index.html`);
    const section = html.match(/<section class="directory-local-browse">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(section, country);
    assert.match(section, /^<details><summary><strong>Browse local directories<\/strong>/);
    assert.ok(section.includes(`<span>${entries.length} ${entries.length === 1 ? "place" : "places"}</span>`), country);
    assert.match(section, /<\/details>\s*<p>City pages are published only where RWN has at least three reviewed listings\.<\/p>/);
    const links = [...section.matchAll(/<a href="([^"]+)">([^<]+) <span>(\d+)<\/span><\/a>/g)].map(match => match.slice(1));
    const expected = [...entries].sort((a, b) => a.city.localeCompare(b.city) || (a.administrativeArea || "").localeCompare(b.administrativeArea || "")).map(entry => [escapeHtml(entry.path), escapeHtml([entry.city, entry.administrativeArea].filter(Boolean).join(", ")), String(entry.count)]);
    assert.deepEqual(links, expected, `${country}: links, labels and counts remain intact`);
  }
});

test("native need QA exercises trusted keys, checks both controls and cleans up", async () => {
  const calls = [], scripts = [];
  const context = { client: { call: async (...args) => calls.push(args) }, click: () => assert.fail("Hidden chips must not receive activation"), evaluate: async (_, script) => {
    scripts.push(script);
    if (script.includes("return { index")) return { index: 2, before: "" };
    if (script.includes("active:")) return { value: "Food", active: "Food", events: [{ trusted: true }] };
  } };
  await selectDirectoryNeed(context, "Food");
  assert.deepEqual(calls.map(([, event]) => [event.type, event.key]), [["rawKeyDown", "Home"], ["keyUp", "Home"], ["rawKeyDown", "ArrowDown"], ["keyUp", "ArrowDown"], ["rawKeyDown", "ArrowDown"], ["keyUp", "ArrowDown"]]);
  assert.equal(scripts.at(-1), "globalThis.__rwnNeedQA?.stop()");
});

test("native need QA rejects mismatched or synthetic selection and desktop uses visible chips", async () => {
  const clicked = [];
  await selectDirectoryNeed({ client: {}, evaluate: async () => null, click: selector => clicked.push(selector) }, "Food");
  assert.deepEqual(clicked, ['[data-directory-category="Food"]']);
  for (const evidence of [{ value: "Water", active: "Food", events: [{ trusted: true }] }, { value: "Food", active: "Food", events: [{ trusted: false }] }, { value: "Food", active: "Food", events: [] }]) {
    let cleaned = false;
    await assert.rejects(selectDirectoryNeed({ client: { call: async () => {} }, evaluate: async (_, script) => {
      if (script.includes("return { index")) return { index: 1, before: "" };
      if (script.includes("active:")) return evidence;
      cleaned = true;
    } }, "Food"), /did not synchronize/);
    assert.equal(cleaned, true);
  }
});
