import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const css = await readFile("public/navigation-actions.css", "utf8");
const hash = createHash("sha256").update(css).digest("hex").slice(0, 12);
const path = "/navigation-actions." + hash + ".css";
const source = (await readFile("public/sw.js", "utf8"))
  .replace("/* __RWN_RUNTIME_ASSETS__ */ {}", JSON.stringify({ "/navigation-actions.css": path }));

async function fixture(corrupt = false) {
  const handlers = new Map(), stored = new Map();
  let offline = false, activated = false, removed = false, fetches = 0;
  const cache = {
    async put(key, response) { stored.set(key.url, response.clone()); },
    async match(key) { return stored.get(key.url)?.clone(); },
  };
  vm.runInNewContext(source, {
    URL, Request, Response, Uint8Array, crypto: webcrypto,
    self: {
      location: { origin: "https://rwn.test" },
      addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() { activated = true; },
    },
    caches: {
      async open() { return cache; },
      async delete() { removed = true; stored.clear(); },
    },
    async fetch(url) {
      fetches++;
      if (offline) throw Error("Offline");
      return new Response(url === path ? corrupt ? "wrong release" : css : "core fixture");
    },
  });
  return {
    stored,
    state: () => ({ activated, removed, fetches }),
    offline: () => { offline = true; },
    install() {
      let pending;
      handlers.get("install")({ waitUntil(value) { pending = value; } });
      return pending;
    },
    request() {
      let pending;
      handlers.get("fetch")({
        request: new Request("https://rwn.test" + path),
        respondWith(value) { pending = value; },
      });
      assert.ok(pending, "the worker must intercept the immutable navigation stylesheet");
      return pending;
    },
  };
}

test("mobile navigation stylesheet is verified at install and served byte-for-byte offline", async () => {
  const worker = await fixture();
  await worker.install();
  assert.equal(worker.state().activated, true);
  assert.ok(worker.stored.has("https://rwn.test/navigation-actions.css"), "legacy canonical stylesheet remains supported");
  worker.offline();
  const before = worker.state().fetches, response = await worker.request();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), css);
  assert.equal(worker.state().fetches, before, "immutable cached CSS never needs an offline network attempt");
});

test("corrupted navigation stylesheet blocks candidate activation and removes its partial cache", async () => {
  const worker = await fixture(true);
  await assert.rejects(worker.install(), /required offline asset/);
  assert.equal(worker.state().activated, false);
  assert.equal(worker.state().removed, true);
  assert.equal(worker.stored.size, 0);
});
