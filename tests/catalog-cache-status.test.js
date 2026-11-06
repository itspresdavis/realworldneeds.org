import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = (await readFile(new URL("../public/catalog-request.js", import.meta.url), "utf8")).replace("export ", "");
const response = cached => new Response(JSON.stringify({ records: [{ id: "fixture" }], scopes: {} }), { headers: cached ? { "X-RWN-Catalog-Cache": "stale" } : {} });
function fixture(fetch) {
  const events = [], document = { documentElement: { dataset: {} } };
  const window = { dispatchEvent(event) { events.push(event.detail); } };
  const context = vm.createContext({ fetch, document, window, AbortController, setTimeout, clearTimeout, CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } } });
  vm.runInContext(source, context);
  return { create: () => context.createCatalogLoader("/data/search-index.json", true), events, document };
}
test("a cached loader retries on recovery while fresh results remain reusable", async () => {
  let requests = 0;
  const f = fixture(async () => response(++requests === 1)), load = f.create();
  await load();
  assert.equal(f.document.documentElement.dataset.rwnCatalogCached, "true");
  load.retry(); await load();
  assert.equal(requests, 2);
  assert.equal(f.document.documentElement.dataset.rwnCatalogCached, "false");
  load.retry(); await load();
  assert.equal(requests, 2);
});
test("one fresh consumer cannot hide another displayed consumer's cached-index warning", async () => {
  let requests = 0;
  const f = fixture(async () => response(++requests === 1)), directory = f.create(), saved = f.create();
  await directory(); await saved();
  assert.equal(f.document.documentElement.dataset.rwnCatalogCached, "true");
  directory.retry(); await directory();
  assert.equal(f.document.documentElement.dataset.rwnCatalogCached, "false");
});
test("an interrupted request cannot later clear a newer stale warning", async () => {
  let resolve, requests = 0;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture(() => ++requests === 1 ? pending : response(true)), load = f.create();
  const old = load(); old.catch(() => {});
  load.retry(); await load();
  resolve(response(false)); await new Promise(setImmediate);
  await assert.rejects(old);
  assert.equal(f.document.documentElement.dataset.rwnCatalogCached, "true");
});
