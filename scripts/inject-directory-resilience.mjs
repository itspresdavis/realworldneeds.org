import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Keep the fallback self-contained for cached pages while sharing the loader's
// exact schema guard and bounded request/retry behavior with directory and Saved.
const helper = (await readFile("public/catalog-request.js", "utf8")).replaceAll("export ", "");
const entry = (await readFile("public/offline-status.js", "utf8")).replace('import { createCatalogLoader } from "./catalog-request.js";', "");
const source = `${helper}\n${entry}`;
await writeFile("dist/offline-status.js", source);
const release = createHash("sha256").update(source).digest("hex").slice(0, 12);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && entry.name === "index.html") files.push(path);
  }
  return files;
}

for (const path of await walk("dist/directory")) {
  let html = await readFile(path, "utf8");
  if (!html.includes("/offline-status.js")) {
    html = html.replace(
      "</head>",
      `  <script type="module" src="/offline-status.js?v=${release}"></script>\n</head>`
    );
  }
  await writeFile(path, html);
}

const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
releaseInfo.directoryResilienceRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
