import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { requiredOfflineAssets, offlineModuleEntries, optionalOfflineData, moduleDependencies } from "../scripts/version-offline-assets.mjs";

const read = (path) => readFile(path, "utf8");
const release = JSON.parse(await read("dist/data/release.json"));
const legacy = await read("tests/fixtures/legacy-query-worker.txt");

test("new HTML cannot request the canonical paths intercepted by the legacy worker", async () => {
  const page = await read("dist/directory/index.html");
  const urls = [...page.matchAll(/(?:src|href)="(\/(?:directory(?:-enhancements|-startup)?|professional-pages|navigation-actions|page-menu|legal|saved-loader|saved-services|offline-status)[^" ]*\.(?:js|css)(?:\?[^" ]*)?)"/g)].map(match => match[1]);
  assert.ok(urls.length >= 7);
  const handlers = new Map();
  vm.runInNewContext(legacy, { URL, Request, self: { location: { origin: "https://rwn.test" }, addEventListener: (name, fn) => handlers.set(name, fn) } });
  for (const url of urls) {
    assert.match(url, /\.[a-f0-9]{12}\.(css|js)(?:\?|$)/, url);
    let intercepted = false;
    handlers.get("fetch")({ request: new Request(`https://rwn.test${url}`), respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, `legacy worker intercepted ${url}`);
  }
});

test("offline manifest and lazy saved entry reference actual byte-addressed artifacts", async () => {
  const expected = new Set(requiredOfflineAssets);
  async function collect(path) {
    if (expected.has(path)) return;
    expected.add(path);
    for (const child of moduleDependencies(await read(`dist${path}`), path)) await collect(child.canonical);
  }
  for (const entry of offlineModuleEntries) await collect(entry);
  assert.deepEqual(Object.keys(release.offlineAssets || {}).sort(), [...expected].sort());
  assert.deepEqual(Object.keys(release.offlineOptionalAssets || {}).sort(), [...optionalOfflineData].sort());
  const worker = await read("dist/sw.js");
  assert.match(release.offlineAssetRelease, /^[a-f0-9]{12}$/);
  assert.ok(worker.includes(`const RUNTIME_ID = "${release.offlineAssetRelease}"`));
  assert.ok((await read("dist/directory/index.html")).includes(`<meta name="rwn-offline-assets" content="${release.offlineAssetRelease}"`));
  for (const [canonical, path] of Object.entries({ ...release.offlineAssets, ...release.offlineOptionalAssets })) {
    const bytes = await readFile(`dist${path}`);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert.equal(path, canonical.replace(/\.(css|js|json)$/, `.${hash}.$1`));
    assert.ok(worker.includes(JSON.stringify(path)), path);
  }
  const directory = await read(`dist${release.offlineAssets["/directory.js"]}`);
  assert.ok(directory.includes(`.${release.offlineAssets["/directory-geography.js"]}?v=`));
  // Required food/time matching and validated contact actions are documented in
  // docs/PERFORMANCE_2026-11-07.md; the aggregate guard prevents moving bytes away.
  assert.ok(Buffer.byteLength(directory) <= 17_000, "actual served directory entry includes its hashed lazy-import path within the budget");
  assert.ok(gzipSync(directory, { level: 9 }).length <= 7_750, "served core has a separate compressed transfer ceiling");
  const requiredBytes = await Promise.all(Object.values(release.offlineAssets).map(path => readFile(`dist${path}`)));
  assert.ok(requiredBytes.reduce((sum, bytes) => sum + bytes.length, 0) <= 200_000, "complete required public runtime graph stays bounded, including helpers, locale, Saved and styles");
  assert.ok(requiredBytes.reduce((sum, bytes) => sum + gzipSync(bytes, { level: 9 }).length, 0) <= 64_000, "complete required public runtime graph stays under its compressed transfer ceiling");
  assert.ok(Buffer.byteLength(await read(`dist${release.offlineAssets["/directory-geography.js"]}`)) <= 1_500, "optional geographic guidance has a separate explicit transfer budget");
  const loader = await read(`dist${release.offlineAssets["/saved-loader.js"]}`);
  assert.ok(loader.includes(`.${release.offlineAssets["/saved-services.js"]}?v=`));
  assert.ok(loader.includes("&attempt=${attempt++}"));
  assert.ok((await read("dist/directory/index.html")).includes(`${release.offlineAssets["/directory.js"]}?v=${release.directoryRelease}`));
});


test("startup capture is tiny, hash-versioned and runs before editable directory markup", async () => {
  const page = await read("dist/directory/index.html");
  const asset = release.offlineAssets["/directory-startup.js"];
  const script = `<script src="${asset}?v=${release.directoryRelease}"></script>`;
  assert.ok(page.includes(script), "capture is a classic parser-blocking script, never deferred or async");
  assert.ok(page.indexOf(script) < page.indexOf("data-directory-query"));
  assert.ok(page.indexOf(script) < page.indexOf(`<script type="module" src="${release.offlineAssets["/directory.js"]}`));
  const startup = await read(`dist${asset}`);
  // Both pending motion and delayed restoration can obscure an early edit;
  // the measured safety cost is documented in PERFORMANCE_2026-11-07.md.
  assert.ok(Buffer.byteLength(startup) <= 1_375, "served early-edit safety capture stays within its reviewed raw budget");
  assert.ok(gzipSync(startup, { level: 9 }).length <= 810, "served early-edit safety capture has a separate compressed transfer ceiling");
});

test("every local stylesheet on the offline directory belongs to its atomic release manifest", async () => {
  const page = await read("dist/directory/index.html");
  const styles = [...page.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(styles.length >= 5, "the rendered directory has its expected stylesheet links");
  for (const href of styles) {
    const url = new URL(href, "https://rwn.test");
    if (url.origin !== "https://rwn.test") continue;
    assert.ok(Object.values(release.offlineAssets).includes(url.pathname), "Offline stylesheet absent from manifest: " + url.pathname);
  }
  assert.ok(styles.some(href => href.startsWith(release.offlineAssets["/navigation-actions.css"] + "?")));
});
