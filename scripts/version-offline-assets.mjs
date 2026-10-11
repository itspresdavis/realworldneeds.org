import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// A query alone cannot escape an already-installed worker which deliberately
// removes queries from cache keys. Put byte identities in the pathname instead.
const paths = ["/legal.css", "/directory-enhancements.css", "/professional-pages.css", "/directory.js", "/directory-startup.js", "/saved-services.js", "/saved-services.css", "/offline-status.js", "/saved-loader.js"];
const assets = {};
for (const path of paths) {
  let bytes = await readFile(`dist${path}`);
  if (path === "/saved-loader.js") {
    const source = bytes.toString("utf8");
    const dependency = "./saved-services.js?v=";
    if (!source.includes(dependency)) throw new Error("Saved-services lazy import was not found.");
    bytes = Buffer.from(source.replace(dependency, `.${assets["/saved-services.js"]}?v=`));
  }
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  assets[path] = path.replace(/\.(css|js)$/, `.${hash}.$1`);
  await writeFile(`dist${assets[path]}`, bytes);
}
const manifestId = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 12);

async function rewriteHtml(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await rewriteHtml(path);
    else if (entry.name.endsWith(".html")) {
      const original = await readFile(path, "utf8");
      const html = original.replace(/((?:src|href)=(["']))(\/[^"'?]+)(?=[?"'])/g,
        (match, prefix, _quote, asset) => assets[asset] ? `${prefix}${assets[asset]}` : match)
        .replace("</head>", `<meta name="rwn-offline-assets" content="${manifestId}" />\n</head>`);
      if (html !== original) await writeFile(path, html);
    }
  }
}
await rewriteHtml("dist");
const releasePath = "dist/data/release.json";
const release = JSON.parse(await readFile(releasePath, "utf8"));
release.offlineAssets = assets;
release.offlineAssetRelease = manifestId;
await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
