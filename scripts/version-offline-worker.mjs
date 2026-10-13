import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const inputs = [
  "public/sw.js",
  "scripts/version-offline-worker.mjs",
  "scripts/version-offline-assets.mjs",
  "public/directory.js",
  "public/catalog-request.js",
  "public/directory-startup.js",
  "public/page-menu.js",
  "public/saved-services.js",
  "public/saved-loader.js",
  "public/saved-services.css",
  "src/utils/privacy.js",
  "public/directory-results.js",
  "src/utils/search.js",
  "public/offline-status.js",
  "public/directory-enhancements.css",
  "public/professional-pages.css",
  "public/legal.css",
  "public/site.webmanifest",
  "scripts/build.mjs",
  "src/utils/source-status.js",
  "src/utils/phone.js",
  "scripts/build-search-index.mjs",
  "scripts/build-local-seo.mjs",
  "scripts/enhance-generated-pages.mjs",
  "scripts/inject-directory-resilience.mjs",
  "scripts/professional-seo.mjs",
  "dist/data/search-index.json",
  "dist/directory/index.html"
];

const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
const assets = releaseInfo.offlineAssets;
if (!assets || Object.keys(assets).length !== 10) throw new Error("Offline runtime asset manifest is missing.");
if (!/^[a-f0-9]{12}$/.test(releaseInfo.offlineAssetRelease || "")) throw new Error("Offline runtime manifest identity is missing.");
const hash = createHash("sha256");
hash.update(JSON.stringify(assets));
for (const path of Object.values(assets)) {
  hash.update(path);
  hash.update(await readFile(`dist${path}`));
}
for (const path of inputs) {
  hash.update(path);
  hash.update(await readFile(path));
}
const release = hash.digest("hex").slice(0, 12);

const workerPath = "dist/sw.js";
let worker = await readFile(workerPath, "utf8");
if (!worker.includes("__RWN_OFFLINE_RELEASE__")) {
  throw new Error("Offline service worker release placeholder is missing.");
}
worker = worker.replaceAll("__RWN_OFFLINE_RELEASE__", release);
const manifestMarker = "/* __RWN_RUNTIME_ASSETS__ */ {}";
if (!worker.includes(manifestMarker)) throw new Error("Offline runtime manifest placeholder is missing.");
worker = worker.replace(manifestMarker, JSON.stringify(assets));
const identityMarker = "/* __RWN_RUNTIME_ID__ */ \"\"";
if (!worker.includes(identityMarker)) throw new Error("Offline runtime identity placeholder is missing.");
worker = worker.replace(identityMarker, JSON.stringify(releaseInfo.offlineAssetRelease));
await writeFile(workerPath, worker);

releaseInfo.offlineRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
