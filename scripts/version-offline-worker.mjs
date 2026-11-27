import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { requiredOfflineAssets, offlineModuleEntries, optionalOfflineData, moduleDependencies } from "./version-offline-assets.mjs";

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
  "public/navigation-actions.css",
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
const optional = releaseInfo.offlineOptionalAssets;
const expected = new Set(requiredOfflineAssets);
async function collect(path) {
  if (expected.has(path)) return;
  expected.add(path);
  for (const dependency of moduleDependencies(await readFile(`dist${path}`, "utf8"), path)) await collect(dependency.canonical);
}
for (const path of offlineModuleEntries) await collect(path);
if (!assets || Object.keys(assets).length !== expected.size || Object.keys(assets).some(path => !expected.has(path))) throw new Error("Offline runtime asset manifest does not match the required dependency graph.");
if (!optional || Object.keys(optional).length !== optionalOfflineData.length || Object.keys(optional).some(path => !optionalOfflineData.includes(path))) throw new Error("Offline optional data manifest is invalid.");
for (const [canonical, path] of Object.entries({ ...assets, ...optional })) {
  const bytes = await readFile(`dist${path}`);
  const identity = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  if (path !== canonical.replace(/\.(css|js|json)$/, `.${identity}.$1`)) throw new Error(`Offline asset bytes do not match their path: ${canonical}`);
}
const manifestIdentity = createHash("sha256").update(JSON.stringify({ required: assets, optional })).digest("hex").slice(0, 12);
if (releaseInfo.offlineAssetRelease !== manifestIdentity) throw new Error("Offline manifest identity does not match its assets.");
if (!/^[a-f0-9]{12}$/.test(releaseInfo.offlineAssetRelease || "")) throw new Error("Offline runtime manifest identity is missing.");
const hash = createHash("sha256");
hash.update(JSON.stringify({ required: assets, optional }));
for (const path of Object.values({ ...assets, ...optional })) {
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
const optionalMarker = "/* __RWN_OPTIONAL_ASSETS__ */ {}";
if (!worker.includes(optionalMarker)) throw new Error("Offline optional manifest placeholder is missing.");
worker = worker.replace(optionalMarker, JSON.stringify(optional));
const identityMarker = "/* __RWN_RUNTIME_ID__ */ \"\"";
if (!worker.includes(identityMarker)) throw new Error("Offline runtime identity placeholder is missing.");
worker = worker.replace(identityMarker, JSON.stringify(releaseInfo.offlineAssetRelease));
await writeFile(workerPath, worker);

releaseInfo.offlineRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
