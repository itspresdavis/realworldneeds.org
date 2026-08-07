import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { freeAccessLabel } from "../src/data/free-access.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const DIRECTORY_PAGE_SIZE = 80;
const SITE_ORIGIN = "https://www.realworldneeds.org";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const slugify = (value) => String(value || "unknown")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "unknown";
const kindLabel = (resource) => resource.kind === "direct"
  ? "Service location"
  : resource.kind === "locator" ? "Resource finder" : "Service network";
const aidLabels = (resource) => [resource.category, ...(resource.secondaryCategories || [])]
  .map((type) => categories[type].label);
const directCount = resources.filter((resource) => resource.kind === "direct").length;
const coverageCount = new Set(resources.map((resource) => resource.country)).size;
const latestReview = [...resources].sort((a, b) => b.lastChecked.localeCompare(a.lastChecked))[0]?.lastChecked || "";
const auditedLiveCount = sourceRegistry.reduce((sum, source) => sum + (source.activeRecordsAtAudit || 0), 0);

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else files.push(path);
  }
  return files.sort();
}

async function releaseHash() {
  const hash = createHash("sha256");
  const files = ["index.html", ...await walkFiles("src")];
  for (const path of files) {
    hash.update(path);
    hash.update(await readFile(path));
  }
  return hash.digest("hex").slice(0, 12);
}

function versionIndexAssets(html, hash) {
  return html.replace(/\/src\/([^"'?]+\.(?:css|js))(?:\?[^"']*)?/g, `/src/$1?v=${hash}`);
}

function versionModuleImports(source, hash) {
  return source.replace(/(["'])(\.{1,2}\/[^"'?]+\.js)(?:\?[^"']*)?\1/g, (_match, quote, path) => `${quote}${path}?v=${hash}${quote}`);
}

function stripClusterCountMarkup(source) {
  const marker = "<span><b>${cluster.members.length}</b></span>";
  if (!source.includes(marker)) throw new Error("Production cluster-count transform could not find the expected marker markup.");
  return source.replace(marker, "<span aria-hidden=\"true\"></span>");
}

function resourceRecord(resource) {
  const place = formatResourcePlace(resource);
  const coordinate = `${resource.lat},${resource.lng}`;
  const phone = resource.phone
    ? `<div><dt>Phone</dt><dd><a href="tel:${escapeHtml(resource.phone.replace(/[^+\d]/g, ""))}">${escapeHtml(resource.phone)}</a></dd></div>`
    : "";
  const maps = resource.kind === "direct"
    ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(resource.name)}&amp;ll=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Apple Maps</a><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Google Maps</a>`
    : "";
  return `<article class="directory-record" id="${escapeHtml(resource.id)}">
    <header><div><p>${escapeHtml(kindLabel(resource))}</p><h2>${escapeHtml(resource.name)}</h2><span>${escapeHtml(place)}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Checked ${escapeHtml(resource.lastChecked)}</time></header>
    <p>${escapeHtml(resource.summary)}</p>
    <ul class="directory-aid" aria-label="Aid categories">${aidLabels(resource).map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
    <dl><div><dt>Access</dt><dd>${escapeHtml(resource.accessType)}</dd></div><div><dt>Cost</dt><dd><strong>${escapeHtml(freeAccessLabel(resource))}.</strong> ${escapeHtml(resource.costNote)}</dd></div><div><dt>${resource.kind === "direct" ? "Address" : "Coverage"}</dt><dd>${escapeHtml(resource.address)}</dd></div>${resource.hours ? `<div><dt>Hours</dt><dd>${escapeHtml(resource.hours)}</dd></div>` : ""}${phone}</dl>
    <p class="directory-caution"><strong>Check before you go.</strong> ${escapeHtml(resource.availabilityNote)}</p>
    <div class="directory-links"><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Visit original source</a>${maps}<a href="/#resource=${encodeURIComponent(resource.id)}">Show on the globe</a></div>
  </article>`;
}

function pageHref(basePath, page) {
  return page === 1 ? basePath : `${basePath}/page/${page}`;
}

function pagination(basePath, page, totalPages) {
  if (totalPages <= 1) return "";
  const links = [];
  if (page > 1) links.push(`<a href="${pageHref(basePath, page - 1)}">Previous</a>`);
  links.push(`<span>Page ${page} of ${totalPages}</span>`);
  if (page < totalPages) links.push(`<a href="${pageHref(basePath, page + 1)}">Next</a>`);
  return `<nav class="directory-downloads" aria-label="Directory pages"><strong>Browse pages</strong>${links.join("")}</nav>`;
}

function directoryPage({ title, heading, lede, canonicalPath, items, page, totalPages, browseMarkup = "" }) {
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(lede)}" />
    <meta name="theme-color" content="#071926" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" type="application/json" href="/data/resources.json" title="RWN resource data" />
    <link rel="alternate" type="text/csv" href="/directory.csv" title="RWN resource directory CSV" />
    <link rel="stylesheet" href="/legal.css" />
    <title>${escapeHtml(title)} | Real World Needs</title>
  </head>
  <body>
    <a class="skip-link" href="#directory">Skip to directory</a>
    <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="/accessibility">Accessibility</a></nav></header>
    <main id="directory">
      <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Text directory</p><h1>${escapeHtml(heading)}</h1><p class="legal-hero__lede">${escapeHtml(lede)}</p><div class="legal-meta"><span>${resources.length} listings checked</span><span>${directCount} service locations</span><span>${auditedLiveCount.toLocaleString()} active USDA sites in the latest review</span><span>Sources last checked through ${escapeHtml(latestReview)}</span></div></div></section>
      <div class="directory-shell">
        <div class="policy-note"><p><strong>Services can change.</strong> Check the original source or contact the organization before you travel. Seasonal USDA meal sites are shown only for their published dates and are counted separately from the reviewed directory.</p></div>
        <div class="directory-downloads"><strong>Directory tools</strong><a href="/directory.csv" download>Download CSV</a><a href="/data/resources.json">Full JSON</a><a href="/data/map-index.json">Compact map index</a><a href="/data/sources.json">Data sources</a></div>
        ${browseMarkup}
        ${pagination(canonicalPath.replace(/\/page\/\d+$/, ""), page, totalPages)}
        <div class="directory-records">${items.map(resourceRecord).join("\n")}</div>
        ${pagination(canonicalPath.replace(/\/page\/\d+$/, ""), page, totalPages)}
      </div>
    </main>
    <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
  </body>
</html>`;
}

async function writePagedDirectory(baseDirectory, basePath, groupResources, metadata) {
  const totalPages = Math.max(1, Math.ceil(groupResources.length / DIRECTORY_PAGE_SIZE));
  const urls = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const items = groupResources.slice((page - 1) * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE);
    const outputDirectory = page === 1 ? baseDirectory : join(baseDirectory, "page", String(page));
    const canonicalPath = pageHref(basePath, page);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "index.html"), directoryPage({
      ...metadata,
      canonicalPath,
      items,
      page,
      totalPages
    }));
    urls.push(canonicalPath);
  }
  return urls;
}

const release = await releaseHash();

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });

let builtIndex = await readFile("dist/index.html", "utf8");
builtIndex = versionIndexAssets(builtIndex, release);
await writeFile("dist/index.html", builtIndex);

const builtJsFiles = (await walkFiles("dist/src")).filter((path) => extname(path) === ".js");
for (const path of builtJsFiles) {
  let source = await readFile(path, "utf8");
  if (path.endsWith(join("src", "app.js"))) source = stripClusterCountMarkup(source);
  await writeFile(path, versionModuleImports(source, release));
}

const transparencyTemplate = await readFile("public/transparency.html", "utf8");
const transparencyHtml = transparencyTemplate
  .replaceAll("{{RESOURCE_COUNT}}", String(resources.length))
  .replaceAll("{{DIRECT_COUNT}}", String(directCount))
  .replaceAll("{{COVERAGE_COUNT}}", String(coverageCount))
  .replaceAll("{{LATEST_REVIEW}}", latestReview);
await writeFile("dist/transparency.html", transparencyHtml);

const countries = [...new Set(resources.map((resource) => resource.country))].sort((a, b) => a.localeCompare(b));
const regions = [...new Set(resources.map((resource) => resource.region).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const countryLinks = countries.map((country) => {
  const count = resources.filter((resource) => resource.country === country).length;
  return `<a href="/directory/${slugify(country)}">${escapeHtml(country)} (${count})</a>`;
}).join("");
const regionLinks = regions.map((region) => {
  const count = resources.filter((resource) => resource.region === region).length;
  return `<a href="/directory/region/${slugify(region)}">${escapeHtml(region)} (${count})</a>`;
}).join("");
const browseMarkup = `<nav class="directory-downloads" aria-label="Browse directory by region"><strong>Browse by region</strong>${regionLinks}</nav><nav class="directory-downloads" aria-label="Browse directory by country"><strong>Browse by country</strong>${countryLinks}</nav>`;

const sitemapPaths = ["/", "/directory", "/transparency", "/editorial-policy", "/privacy", "/terms", "/accessibility"];
sitemapPaths.push(...await writePagedDirectory("dist/directory", "/directory", resources, {
  title: "Service Directory",
  heading: "Find services without using the globe.",
  lede: "Browse the reviewed Real World Needs catalog in lightweight pages. Cost, eligibility, contact details, and the original source are included.",
  browseMarkup
}));

for (const region of regions) {
  const items = resources.filter((resource) => resource.region === region);
  const slug = slugify(region);
  sitemapPaths.push(...await writePagedDirectory(join("dist/directory/region", slug), `/directory/region/${slug}`, items, {
    title: `${region} Service Directory`,
    heading: `Free essential services in ${region}.`,
    lede: `Browse ${items.length} reviewed Real World Needs listings connected to original sources across ${region}.`,
    browseMarkup: `<div class="directory-downloads"><strong>Browse</strong><a href="/directory">All countries and regions</a></div>`
  }));
}

const countryManifest = [];
for (const country of countries) {
  const items = resources.filter((resource) => resource.country === country);
  const slug = slugify(country);
  sitemapPaths.push(...await writePagedDirectory(join("dist/directory", slug), `/directory/${slug}`, items, {
    title: `${country} Service Directory`,
    heading: `Free essential services in ${country}.`,
    lede: `Browse ${items.length} reviewed Real World Needs listings connected to original sources in ${country}.`,
    browseMarkup: `<div class="directory-downloads"><strong>Browse</strong><a href="/directory">All countries and regions</a></div>`
  }));
  countryManifest.push({ country, slug, count: items.length, path: `/data/resources/by-country/${slug}.json` });
}

const csvFields = ["ID", "Name", "Place", "Country", "Latitude", "Longitude", "Type", "Aid", "Access", "Free access model", "Cost details", "Address or coverage", "Hours", "Phone", "Eligibility", "Active from", "Active through", "Dataset", "Reviewed", "Official source"];
const csvRows = resources.map((resource) => [
  resource.id,
  resource.name,
  formatResourcePlace(resource),
  resource.country,
  resource.lat,
  resource.lng,
  kindLabel(resource),
  aidLabels(resource).join("; "),
  resource.accessType,
  resource.costModel,
  resource.costNote,
  resource.address,
  resource.hours || "",
  resource.phone || "",
  resource.eligibility || "",
  resource.validFrom || "",
  resource.validThrough || "",
  resource.datasetId || "curated-provider-record",
  resource.lastChecked,
  resource.sourceUrl
]);
const directoryCsv = [csvFields, ...csvRows].map((row) => row.map(escapeCsv).join(",")).join("\n");
await writeFile("dist/directory.csv", `${directoryCsv}\n`);

await mkdir("dist/data/resources/by-country", { recursive: true });
await writeFile("dist/data/resources.json", `${JSON.stringify({
  schemaVersion: "1.3",
  license: "Public service facts with source attribution; see https://www.realworldneeds.org/editorial-policy",
  resourceCount: resources.length,
  resources
}, null, 2)}\n`);
await writeFile("dist/data/map-index.json", `${JSON.stringify({
  schemaVersion: "1.0",
  resourceCount: resources.length,
  fields: ["id", "lat", "lng", "category", "kind", "country", "region"],
  resources: resources.map(({ id, lat, lng, category, kind, country, region }) => ({ id, lat, lng, category, kind, country, region }))
})}\n`);
await writeFile("dist/data/resources/index.json", `${JSON.stringify({ schemaVersion: "1.0", resourceCount: resources.length, countries: countryManifest }, null, 2)}\n`);
for (const entry of countryManifest) {
  const items = resources.filter((resource) => resource.country === entry.country);
  await writeFile(`dist${entry.path}`, `${JSON.stringify({ schemaVersion: "1.0", country: entry.country, resourceCount: items.length, resources: items })}\n`);
}
await writeFile("dist/data/sources.json", `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  note: "Counts show records available on the review date, not the number of people helped. The finder loads only nearby current records from live sources.",
  sources: sourceRegistry
}, null, 2)}\n`);
await writeFile("dist/data/release.json", `${JSON.stringify({ release, resourceCount: resources.length, directoryPageSize: DIRECTORY_PAGE_SIZE })}\n`);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(sitemapPaths)].map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`).join("\n")}\n</urlset>\n`;
await writeFile("dist/sitemap.xml", sitemap);

await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/three/build/three.module.min.js", "dist/vendor/three.module.js");
await cp("node_modules/three/build/three.core.min.js", "dist/vendor/three.core.min.js");
