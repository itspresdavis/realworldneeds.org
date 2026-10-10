import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const inputs = [
  "public/sw.js",
  "public/directory.js",
  "public/directory-results.js",
  "public/offline-status.js",
  "public/directory-enhancements.css",
  "public/professional-pages.css",
  "public/legal.css",
  "public/site.webmanifest",
  "scripts/build.mjs",
  "src/utils/source-status.js",
  "scripts/build-local-seo.mjs",
  "scripts/enhance-generated-pages.mjs",
  "scripts/inject-directory-resilience.mjs",
  "scripts/professional-seo.mjs",
  "dist/data/search-index.json"
];

const hash = createHash("sha256");
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
await writeFile(workerPath, worker);

const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
releaseInfo.offlineRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
