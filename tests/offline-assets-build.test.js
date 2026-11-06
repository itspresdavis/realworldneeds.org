import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
  assert.equal(Object.keys(release.offlineAssets || {}).length, 12);
  const worker = await read("dist/sw.js");
  assert.match(release.offlineAssetRelease, /^[a-f0-9]{12}$/);
  assert.ok(worker.includes(`const RUNTIME_ID = "${release.offlineAssetRelease}"`));
  assert.ok((await read("dist/directory/index.html")).includes(`<meta name="rwn-offline-assets" content="${release.offlineAssetRelease}"`));
  for (const [canonical, path] of Object.entries(release.offlineAssets)) {
    const bytes = await readFile(`dist${path}`);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert.equal(path, canonical.replace(/\.(css|js)$/, `.${hash}.$1`));
    assert.ok(worker.includes(JSON.stringify(path)), path);
  }
  const directory = await read(`dist${release.offlineAssets["/directory.js"]}`);
  assert.ok(directory.includes(`.${release.offlineAssets["/directory-geography.js"]}?v=`));
  assert.ok(Buffer.byteLength(directory) <= 16_000, "actual served directory entry includes its hashed lazy-import path within the budget");
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
  assert.ok(Buffer.byteLength(await read(`dist${asset}`)) <= 1_000, "early capture stays below 1 KB");
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
