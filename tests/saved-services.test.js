import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { SAVED_RESOURCES_KEY, readSavedResources, setResourceSaved, clearSavedResources } from "../src/utils/privacy.js";

function storage(initial) {
  const values = new Map([["unrelated", "keep"]]);
  if (initial !== undefined) values.set(SAVED_RESOURCES_KEY, initial);
  let writes = 0;
  return {
    values, get writes() { return writes; },
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { writes += 1; values.set(key, value); },
    removeItem(key) { writes += 1; values.delete(key); }
  };
}

test("saved IDs retain the original format and reading never writes or migrates", () => {
  const existing = '["bowery-mission","missing-service","bowery-mission"]';
  const f = storage(existing);
  assert.deepEqual([...readSavedResources(f)], ["bowery-mission", "missing-service"]);
  assert.equal(f.writes, 0);
  assert.equal(f.getItem(SAVED_RESOURCES_KEY), existing);
});

test("malformed or hostile saved values are safe and never interpreted as HTML or URLs", () => {
  for (const initial of [undefined, "null", "{\"id\":\"x\"}", "not JSON", "12"]) {
    const f = storage(initial);
    assert.deepEqual([...readSavedResources(f)], []);
    assert.equal(f.writes, 0);
  }
  assert.deepEqual([...readSavedResources(storage(JSON.stringify([null, {}, 12, "<img src=x>", "../test", "https://example.org", "safe-id"])))], ["safe-id"]);
  assert.throws(() => setResourceSaved("../bad", true, storage()), /Invalid service identifier/);
});

test("only explicit changes persist and they preserve other saved IDs and unrelated storage", () => {
  const f = storage('["older-record"]');
  setResourceSaved("bowery-mission", true, f);
  setResourceSaved("bowery-mission", true, f);
  assert.deepEqual(JSON.parse(f.getItem(SAVED_RESOURCES_KEY)), ["older-record", "bowery-mission"]);
  setResourceSaved("bowery-mission", false, f);
  assert.deepEqual([...readSavedResources(f)], ["older-record"]);
  setResourceSaved("older-record", false, f);
  assert.equal(f.getItem(SAVED_RESOURCES_KEY), null);
  setResourceSaved("bowery-mission", true, f);
  clearSavedResources(f);
  assert.equal(f.getItem(SAVED_RESOURCES_KEY), null);
  assert.equal(f.getItem("unrelated"), "keep");
});

test("storage denial and quota failure propagate rather than reporting a successful save", () => {
  const denied = { getItem() { throw new Error("denied"); } };
  assert.throws(() => readSavedResources(denied), /denied/);
  assert.throws(() => setResourceSaved("bowery-mission", true, denied), /denied/);
  const full = storage('["older-record"]');
  full.setItem = () => { throw new Error("quota"); };
  assert.throws(() => setResourceSaved("bowery-mission", true, full), /quota/);
  assert.deepEqual([...readSavedResources(full)], ["older-record"]);
  full.removeItem = () => { throw new Error("blocked"); };
  assert.throws(() => clearSavedResources(full), /blocked/);
});

test("saved actions read the latest browser list before changing an ID", () => {
  const f = storage('["first-tab"]');
  readSavedResources(f);
  f.values.set(SAVED_RESOURCES_KEY, '["first-tab","other-tab"]');
  setResourceSaved("new-service", true, f);
  assert.deepEqual([...readSavedResources(f)], ["first-tab", "other-tab", "new-service"]);
});

test("all public routes expose text-only Saved navigation and service controls are explicit", async () => {
  for (const path of ["dist/directory/index.html", "dist/directory/help/food/index.html", "dist/service/bowery-mission/index.html"]) {
    const html = await readFile(path, "utf8");
    assert.match(html, /href="\/directory#saved"[^>]*>Saved/);
  }
  const directory = await readFile("dist/directory/index.html", "utf8");
  assert.match(directory, /id="saved"[^>]+data-saved-services/);
  assert.match(directory, /Anyone using this browser can see your list/);
  assert.match(directory, /data-saved-clear[^>]+hidden/);
  assert.match(directory, /data-saved-confirmation hidden/);
  const servicePage = await readFile("dist/service/bowery-mission/index.html", "utf8");
  assert.match(servicePage, /<main id="service" data-service-id="bowery-mission">/);
  const service = await readFile("public/service-actions.js", "utf8");
  assert.match(service, /document\.querySelector\("#service"\)\?\.dataset\.serviceId/);
  assert.match(service, /data-service-save aria-pressed="false" aria-describedby="service-save-privacy"/);
  assert.match(service, /saveButton\.addEventListener\("click"/);
  assert.match(service, /Saved only in this browser on this device/);
  assert.doesNotMatch(service, /fetch\(|sendBeacon|XMLHttpRequest/);
});

test("shipped saved and service entries inline the same storage helper without transitive dependencies", async () => {
  for (const path of ["dist/saved-services.js", "dist/service-actions.js"]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /function readSavedResources\(/);
    assert.match(source, /function setResourceSaved\(/);
    assert.doesNotMatch(source, /import .+from ["'][^"']*(?:saved-services|privacy)\.js/);
  }
  const version = await readFile("scripts/version-offline-worker.mjs", "utf8");
  assert.match(version, /public\/saved-services\.js/);
  assert.match(version, /src\/utils\/privacy\.js/);
});

test("Saved uses local filtering, safe text, and refreshed history and cross-tab state", async () => {
  const source = await readFile("public/saved-services.js", "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|sendBeacon|XMLHttpRequest|history\.(?:pushState|replaceState)/);
  assert.match(source, /location\.hash === "#saved"/);
  assert.match(source, /createCatalogLoader\(`\/data\/search-index\.json/);
  assert.match(source, /readSavedResources\(\)/);
  assert.match(source, /current !== generation \|\| !active\(\)/);
  for (const event of ["hashchange", "pageshow", "storage"]) assert.ok(source.includes(`addEventListener("${event}"`));
  assert.match(source, /no longer in the current directory/);
  assert.match(source, /could not load\. Reconnect and try again/);
  const app = await readFile("src/app.js", "utf8");
  assert.match(app, /setResourceSaved\(id, !saved\)/);
  assert.match(app, /window\.addEventListener\("pageshow", refreshSavedResources\)/);
});

test("Saved is lazy, independently bounded, and included in complete offline releases", async () => {
  const loader = await readFile("public/saved-loader.js", "utf8");
  assert.match(loader, /location\.hash !== "#saved"/);
  assert.match(loader, /pending = import\(`/);
  assert.doesNotMatch(loader, /localStorage|readSavedResources|fetch\(/);
  const directory = await readFile("dist/directory.js", "utf8");
  assert.doesNotMatch(directory, /readSavedResources|initSavedServices/);
  for (const [path, max] of [["dist/saved-services.js", 14_000], ["public/saved-loader.js", 1_200], ["public/saved-services.css", 3_000]]) {
    assert.ok((await stat(path)).size <= max, `${path} exceeds its separate feature budget`);
  }
  const offline = await readFile("public/offline-status.js", "utf8");
  assert.ok(offline.includes('.directory-global-result, .directory-global-result-actions .is-details'));
  const css = await readFile("public/saved-services.css", "utf8");
  assert.match(css, /\.directory-global-result-actions \[hidden\] \{ display: none !important; \}/);
  assert.match(offline, /observer\.observe\(savedList, \{ childList: true, subtree: true \}\)/);
});

test("Saved's index version changes with catalog data and every lazy feature dependency", async () => {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  for (const path of ["dist/saved-loader.js", "dist/saved-services.js", "dist/saved-services.css", "dist/data/search-index.json"]) {
    hash.update(path); hash.update(await readFile(path));
  }
  const release = JSON.parse(await readFile("dist/data/release.json", "utf8"));
  assert.equal(release.savedServicesRelease, hash.digest("hex").slice(0, 12));
  const page = await readFile("dist/directory/index.html", "utf8");
  assert.ok(page.includes(`${release.offlineAssets["/saved-loader.js"]}?v=${release.savedServicesRelease}`));
  assert.ok(page.includes(`${release.offlineAssets["/saved-services.css"]}?v=${release.savedServicesRelease}`));
});
