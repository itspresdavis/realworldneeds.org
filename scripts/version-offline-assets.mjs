import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

// A query alone cannot escape an installed worker that strips cache queries.
export const requiredOfflineAssets = Object.freeze(["/language-preference.js", "/legal.css", "/page-menu.js", "/directory-enhancements.css", "/professional-pages.css", "/navigation-actions.css", "/directory-geography.js", "/directory.js", "/directory-startup.js", "/saved-services.js", "/saved-services.css", "/offline-status.js", "/saved-loader.js", "/language.js", "/task-controls.css", "/directory-suggestions.css"]);
export const offlineModuleEntries = Object.freeze(["/src/utils/search-intent-entry.js"]);
export const optionalOfflineData = Object.freeze(["/data/postal-areas.json"]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex").slice(0, 12);
const versioned = (path, bytes) => path.replace(/\.(css|js|json)$/, `.${digest(bytes)}.$1`);
const modulePath = /^\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/;

export function moduleDependencies(source, parent, { allowVersioned = false } = {}) {
  const references = [];
  const patterns = [/(?:\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?)(["'])([^"'\r\n]+)\1/g, /\bimport\s*\(\s*(["'])([^"'\r\n]+)\1\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const specifier = match[2];
    if (!specifier.startsWith(".") && !specifier.startsWith("/src/")) throw new Error(`Offline module cannot import external/bare path: ${parent}`);
    if (specifier.includes("\\") || specifier.includes("%")) throw new Error(`Unsafe offline module path: ${parent}`);
    const url = new URL(specifier, `https://rwn.invalid${parent}`);
    if (url.origin !== "https://rwn.invalid" || !((allowVersioned ? /^\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[a-f0-9]{12})?\.js$/ : modulePath).test(url.pathname)) || url.hash) throw new Error(`Offline module dependency escaped public src: ${parent}`);
    references.push({ specifier, canonical: url.pathname, suffix: url.search, dynamic: pattern === patterns[1], start: match.index + match[0].indexOf(match[1] + specifier) + 1, length: specifier.length });
  }
  // Fail closed if an entry adopts a computed dynamic import we cannot identify.
  const dynamic = [...source.matchAll(/\bimport\s*\(/g)].length;
  const literals = [...source.matchAll(patterns[1])].length;
  if (dynamic !== literals) throw new Error(`Computed dynamic import is not supported offline: ${parent}`);
  return references.sort((a, b) => a.start - b.start);
}

export async function versionOfflineAssets(root = "dist") {
  const releasePath = join(root, "data/release.json");
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  const previous = new Map(Object.entries(release.offlineAssets || {}).map(([canonical, path]) => [path, canonical]));
  const assets = {}, optional = {};
  for (const path of optionalOfflineData) {
    const bytes = await readFile(join(root, path));
    optional[path] = versioned(path, bytes);
    await writeFile(join(root, optional[path]), bytes);
  }
  for (const path of requiredOfflineAssets) {
    let bytes = await readFile(join(root, path));
    if (path === "/saved-loader.js" || path === "/directory.js") {
      const source = bytes.toString("utf8");
      const child = path === "/directory.js" ? "/directory-geography.js" : "/saved-services.js";
      const dependency = `.${child}?v=`;
      if (!source.includes(dependency)) throw new Error(`Lazy import for ${child} was not found.`);
      bytes = Buffer.from(source.replace(dependency, `.${assets[child]}?v=`));
    }
    assets[path] = versioned(path, bytes);
    await writeFile(join(root, assets[path]), bytes);
  }
  const visiting = new Set(), dependenciesByModule = new Map();
  async function module(canonical) {
    if (assets[canonical]) return;
    if (visiting.has(canonical)) throw new Error(`Cyclic offline module dependency: ${canonical}`);
    if (!modulePath.test(canonical)) throw new Error(`Unsupported offline module: ${canonical}`);
    if (Object.keys(assets).length + visiting.size >= 46) throw new Error("Offline module graph exceeds its bounded scope.");
    visiting.add(canonical);
    let source = await readFile(join(root, canonical), "utf8");
    const dependencies = moduleDependencies(source, canonical);
    dependenciesByModule.set(canonical, dependencies);
    for (const child of dependencies) await module(child.canonical);
    for (const child of dependencies.toReversed()) {
      let relative = posix.relative(posix.dirname(canonical), assets[child.canonical]);
      if (!relative.startsWith(".")) relative = `./${relative}`;
      source = source.slice(0, child.start) + relative + child.suffix + source.slice(child.start + child.length);
    }
    if (canonical === "/src/utils/search-intent.js") {
      const path = optionalOfflineData[0];
      if (!source.includes(path)) throw new Error("Postal reference literal is missing from the optional intent module.");
      source = source.replaceAll(path, optional[path]);
    }
    const bytes = Buffer.from(source);
    assets[canonical] = versioned(canonical, bytes);
    await writeFile(join(root, assets[canonical]), bytes);
    visiting.delete(canonical);
  }
  for (const entry of offlineModuleEntries) await module(entry);
  // The required intent graph otherwise takes four sequential network discovery
  // waves. Preload the exact static import URLs in parallel, only on pages that
  // execute this entry. Dynamic imports and postal data retain their demand gate.
  const preloadsFor = entry => {
    const urls = new Set();
    const visit = canonical => {
      for (const child of dependenciesByModule.get(canonical) || []) {
        if (child.dynamic) continue;
        const url = assets[child.canonical] + child.suffix;
        if (urls.has(url)) continue;
        urls.add(url); visit(child.canonical);
      }
    };
    visit(entry);
    return [...urls];
  };
  const manifestId = digest(JSON.stringify({ required: assets, optional }));
  async function rewriteHtml(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await rewriteHtml(path);
      else if (entry.name.endsWith(".html")) {
        const original = await readFile(path, "utf8");
        let html = original.replace(/((?:src|href)=(["']))(\/[^"'?]+)(?=[?"'])/g,
          (match, prefix, _quote, asset) => { const target = assets[asset] || assets[previous.get(asset)]; return target ? `${prefix}${target}` : match; })
          .replace(/<link rel="modulepreload" href="[^"]+" data-rwn-search-preload \/>\n?/g, "")
          .replace(/<meta name="rwn-offline-assets" content="[a-f0-9]{12}"\s*\/?>\s*/g, "")
          .replace("</head>", `<meta name="rwn-offline-assets" content="${manifestId}" />\n</head>`);
        const preloads = new Set(offlineModuleEntries.filter(entry => html.includes(`src="${assets[entry]}?`) || html.includes(`src="${assets[entry]}"`)).flatMap(preloadsFor));
        const links = [...preloads].map(url => `<link rel="modulepreload" href="${url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" data-rwn-search-preload />\n`).join('');
        html = html.replace("</head>", links + "</head>");
        if (html !== original) await writeFile(path, html);
      }
    }
  }
  await rewriteHtml(root);
  release.offlineAssets = assets;
  release.offlineOptionalAssets = optional;
  release.offlineAssetRelease = manifestId;
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
  return { assets, optional, manifestId };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await versionOfflineAssets();
