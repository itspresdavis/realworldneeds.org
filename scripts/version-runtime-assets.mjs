import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const runtimeInputs = [
  "src/app.js", "src/bootstrap.js", "src/accessibility.js", "src/refinement.js", "src/professional.js", "src/result-actions.js", "src/telemetry.js",
  "src/globe-points.js", "src/utils/globe-clustering.js", "src/utils/globe-zoom.js", "src/utils/geo.js",
  "src/data/resources.js", "src/data/free-access.js", "src/data/live-sources.js", "src/data/platform.js", "src/data/resource-expansion.js", "src/data/verified-expansion.js",
  "src/styles.css", "src/clarity.css"
];

const hash = createHash("sha256");
for (const path of runtimeInputs) {
  hash.update(path);
  hash.update(await readFile(path));
}
const release = hash.digest("hex").slice(0, 12);
const version = `?v=${release}`;

const addVersionToRelativeModuleImports = (source) => source
  .replace(/(from\s+["'])(\.[^"']+\.js)(["'])/g, `$1$2${version}$3`)
  .replace(/(import\(\s*["'])(\.[^"']+\.js)(["']\s*\))/g, `$1$2${version}$3`);

for (const path of runtimeInputs.filter((path) => path.endsWith(".js"))) {
  const distPath = `dist/${path}`;
  const source = await readFile(distPath, "utf8");
  await writeFile(distPath, addVersionToRelativeModuleImports(source));
}

const indexPath = "dist/index.html";
let index = await readFile(indexPath, "utf8");
index = index
  .replace('href="/src/styles.css"', `href="/src/styles.css${version}"`)
  .replace('href="/src/app.js"', `href="/src/app.js${version}"`)
  .replace('src="/src/bootstrap.js"', `src="/src/bootstrap.js${version}"`);
await writeFile(indexPath, index);

const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
releaseInfo.runtimeAssetRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
