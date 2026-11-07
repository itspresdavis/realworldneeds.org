import { renderDirectoryRow } from "./helpers/directory-renderer.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/directory.js", import.meta.url), "utf8");
function bodyBetween(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const catalogSource = bodyBetween("const loadCatalog=", "const clearGlobalResults=");
const paginationSource = bodyBetween("const renderNext=", "listen(more,");
const catalog = { records: [], scopes: {} };
const applySource = bodyBetween("const apply=", "const reset=");

function pageFixture(total) {
  const appended = [];
  const f = vm.createContext({ place: { value: "" },
    activeMatches: Array.from({ length: total }, (_, id) => ({ id })), visibleCount: 0,
    format: value => value.toLocaleString(), BATCH: 60, scopedCount: 2019, resultRow: (record) => record,
    resultList: { append: (...rows) => appended.push(...rows) }, more: {}, resultSummary: {}
  });
  vm.runInContext(`${paginationSource}\nglobalThis.next = renderNext;`, f);
  return { f, appended };
}

for (const total of [0, 1, 60, 61, 120, 302]) {
  test(`${total} matches can all be reached in ordered batches without duplicates`, () => {
    const { f, appended } = pageFixture(total);
    do {
      const previous = appended.length;
      const first = f.next();
      assert.ok(appended.length - previous <= 60);
      if (previous < total) assert.equal(first.id, previous);
      assert.equal(f.more.hidden, appended.length === total);
    } while (!f.more.hidden);
    assert.equal(appended.length, total);
    assert.deepEqual(appended.map((row) => row.id), Array.from({ length: total }, (_, id) => id));
    assert.equal(f.resultSummary.textContent, `${total} of ${total} matches · 2,019 listings`);
  });
}

test("an older pending search cannot replace newer input or reset state", async () => {
  let resolve;
  let renderCalls = 0;
  const pending = new Promise((done) => { resolve = done; });
  const f = vm.createContext({ place: { value: "" },
    input: { value: "New York" }, activeCategory: "", generation: 0, composing: false, document: {}, retry: {}, showRetry() {},
    queryTokens: (value) => value.split(" "), clear: {}, root: { classList: { toggle() {} } },
    count: {}, announce: text => { f.count.textContent = text; }, loadCatalog: () => pending,
    syncCategoryLabels: () => { renderCalls += 1; }
  });
  vm.runInContext(`${applySource}\nglobalThis.search = apply;`, f);
  const running = f.search();
  f.input.value = "Bowery";
  f.generation += 1;
  resolve(catalog);
  await running;
  assert.equal(f.input.value, "Bowery");
  assert.equal(renderCalls, 0);
});

test("shipped directory entry stays self-contained for existing offline workers", async () => {
  const client = await readFile("dist/directory.js", "utf8");
  const { directoryRelease, offlineAssets } = JSON.parse(await readFile("dist/data/release.json", "utf8"));
  const row = renderDirectoryRow(client, { id: "fixture", name: "Reviewed site", place: "Example", kind: "locator", categoryLabels: ["Food"], checked: "2026-11-06" });
  assert.equal(row.className, "directory-global-result-wrap");
  assert.equal(row.children[0].href, "/service/fixture");
  assert.doesNotMatch(client, /from[\s]*["\'].*search\.js/);
  assert.doesNotMatch(client, /\bimport(?!\s*\.)[^;]*directory-results/);
  assert.ok(Buffer.byteLength(client) <= 17_000, "bundled entry must stay inside the documented directory client budget");
  const page = await readFile("dist/directory/index.html", "utf8");
  assert.ok(page.includes(`${offlineAssets["/directory.js"]}?v=${directoryRelease}`));
  const worker = await readFile("dist/sw.js", "utf8");
  assert.doesNotMatch(worker, /"\/directory-results\.js"/);
  const template = page.match(/<template data-directory-results>([\s\S]*?)<\/template>/)?.[1];
  assert.ok(template, "generated results template must be available to the entry");
  assert.match(template, /aria-controls="directory-global-list"/);
  assert.match(template, /id="directory-global-list"/);
  assert.match(source, /renderNext\(\)\?\.querySelector\("a"\)\?\.focus\(\)/);
});


test("a failed older search cannot clear newer results after input changes or reset", async () => {
  let reject;
  let clearCalls = 0;
  const pending = new Promise((_, fail) => { reject = fail; });
  const f = vm.createContext({ place: { value: "" },
    input: { value: "New York" }, activeCategory: "", generation: 0, composing: false, document: {}, retry: {}, showRetry() {},
    queryTokens: (value) => value.split(" "), clear: {}, root: { classList: { toggle() {} } },
    count: {}, announce: text => { f.count.textContent = text; }, loadCatalog: () => pending, clearGlobalResults: () => { clearCalls += 1; }
  });
  vm.runInContext(`${applySource}\nglobalThis.search = apply;`, f);
  const running = f.search();
  f.generation += 1;
  f.input.value = "";
  f.count.textContent = "60 listings on this page";
  reject(new Error("Old request failed"));
  await running;
  assert.equal(clearCalls, 0);
  assert.equal(f.count.textContent, "60 listings on this page");
});

test("self-contained bundle guard rejects helper imports without mistaking import.meta for one", () => {
  const dependency = /\bimport(?!\s*\.)[^;]*directory-results/;
  for (const text of ["import { row } from './directory-results.js'", "import{row}from'./directory-results.js'", "const row=import('./directory-results.js')"]) assert.match(text, dependency);
  assert.doesNotMatch('const release=new URL(import.meta.url);if(location.hash==="#directory-results")restore()', dependency);
  assert.doesNotMatch('const release=new URL(import.meta.url),target="#directory-results"', dependency);
});
