import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Inline the small shared storage helper so service actions have no extra
// runtime dependency and share the exact finder storage format.
const actionSource = await readFile("dist/service-actions.js", "utf8");
const privacySource = (await readFile("src/utils/privacy.js", "utf8")).replaceAll("export ", "");
if (!actionSource.startsWith("import { SAVED_RESOURCES_KEY,")) throw new Error("Service storage import was not found.");
await writeFile("dist/service-actions.js", `${privacySource}\n${actionSource.replace(/^import[^\n]+\n/, "")}`);

const hash = createHash("sha256");
for (const path of ["dist/service-actions.js", "dist/service-actions.css"]) {
  hash.update(path);
  hash.update(await readFile(path));
}
const release = hash.digest("hex").slice(0, 12);

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

for (const path of await walk("dist/service")) {
  let html = await readFile(path, "utf8");
  if (!html.includes("/service-actions.css")) {
    html = html.replace(
      "</head>",
      `  <link rel="stylesheet" href="/service-actions.css?v=${release}" />\n  <script type="module" src="/service-actions.js?v=${release}"></script>\n</head>`
    );
  }
  await writeFile(path, html);
}

const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
releaseInfo.serviceActionRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
