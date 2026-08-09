import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const SITE_ORIGIN = "https://www.realworldneeds.org";
const STATIC_WITHOUT_DATA_LASTMOD = ["/privacy", "/terms", "/accessibility", "/editorial-policy"];

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const slugify = (value) => String(value || "unknown")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "unknown";

const allTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];
const latestDate = (items) => items.map((item) => item.lastChecked).filter(Boolean).sort().at(-1) || null;

async function walkHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkHtml(path));
    else if (entry.isFile() && entry.name === "index.html") files.push(path);
  }
  return files;
}

function haversineKm(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function relatedResources(resource) {
  const sourceTypes = new Set(allTypes(resource));
  return resources
    .filter((candidate) => candidate.id !== resource.id)
    .map((candidate) => {
      const sameCountry = candidate.country === resource.country;
      const sameCity = sameCountry && candidate.city && resource.city && candidate.city === resource.city;
      const typeOverlap = allTypes(candidate).filter((type) => sourceTypes.has(type)).length;
      const distance = Number.isFinite(resource.lat) && Number.isFinite(resource.lng) && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)
        ? haversineKm(resource, candidate)
        : Number.POSITIVE_INFINITY;
      let score = 0;
      if (sameCountry) score += 70;
      if (sameCity) score += 120;
      score += typeOverlap * 45;
      if (candidate.kind === "direct") score += 8;
      if (distance <= 25) score += 70 - distance;
      else if (distance <= 100) score += 30 - distance * .18;
      else if (distance <= 250) score += 8;
      return { candidate, distance, score };
    })
    .filter(({ candidate, score }) => score >= 55 || candidate.country === "Global")
    .sort((a, b) => b.score - a.score || a.distance - b.distance || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, 6);
}

function relatedMarkup(resource) {
  const related = relatedResources(resource);
  if (!related.length) return "";
  const nearby = related.some(({ distance }) => Number.isFinite(distance) && distance <= 100);
  const heading = nearby && resource.city
    ? `Other help near ${resource.city}`
    : resource.country && resource.country !== "Global" ? `Related help in ${resource.country}` : "Related essential services";
  const countryHref = resource.country && resource.country !== "Global" ? `/directory/${slugify(resource.country)}` : "/directory";

  return `<section class="related-services" aria-labelledby="related-services-title">
    <div class="related-services__heading"><h2 id="related-services-title">${escapeHtml(heading)}</h2><a href="${countryHref}">Browse more services</a></div>
    <div class="related-services__grid">${related.map(({ candidate, distance }) => {
      const label = Number.isFinite(distance) && distance <= 250 && resource.kind === "direct" && candidate.kind === "direct"
        ? `${Math.max(.1, distance).toFixed(distance < 10 ? 1 : 0)} km away`
        : categories[candidate.category]?.label || "Essential help";
      return `<a href="/service/${encodeURIComponent(candidate.id)}"><strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(formatResourcePlace(candidate))}</span><small>${escapeHtml(label)}</small></a>`;
    }).join("")}</div>
  </section>`;
}

function assetLinks(release, includeScript) {
  return `<link rel="stylesheet" href="/directory-enhancements.css?v=${release}" />${includeScript ? `\n    <script type="module" src="/directory.js?v=${release}"></script>` : ""}`;
}

function directorySearchMarkup() {
  return `<section class="directory-search-tools" data-directory-search aria-label="Filter listings on this page">
    <div class="directory-search-tools__top">
      <label class="directory-search-field"><span aria-hidden="true">⌕</span><span class="sr-only">Search listings on this page</span><input type="search" data-directory-query placeholder="Search organization, service, city, address, or help type" autocomplete="off" enterkeyhint="search" aria-keyshortcuts="/ Escape" /></label>
      <button class="directory-search-tools__clear" type="button" data-directory-clear hidden>Clear filters</button>
    </div>
    <div class="directory-search-tools__meta"><span data-directory-count role="status" aria-live="polite"></span><span><kbd>/</kbd><span> focuses search · Escape clears</span></span></div>
    <div class="directory-category-chips" data-directory-categories role="group" aria-label="Filter by type of help"></div>
  </section>`;
}

function enhanceCollectionPage(html, release) {
  if (!html.includes('<div class="directory-records">')) return html;
  if (!html.includes("directory-enhancements.css")) {
    html = html.replace('<link rel="stylesheet" href="/legal.css" />', `<link rel="stylesheet" href="/legal.css" />\n    ${assetLinks(release, true)}`);
  }
  if (!html.includes("data-directory-search")) {
    html = html.replace('<div class="directory-records">', `${directorySearchMarkup()}\n        <div class="directory-records">`);
  }
  return html;
}

function enhanceServicePage(html, resource, release) {
  if (!html.includes("directory-enhancements.css")) {
    html = html.replace('<link rel="stylesheet" href="/legal.css" />', `<link rel="stylesheet" href="/legal.css" />\n  ${assetLinks(release, false)}`);
  }
  if (!html.includes("related-services")) {
    const markup = relatedMarkup(resource);
    if (markup) html = html.replace("    </div>\n  </main>", `      ${markup}\n    </div>\n  </main>`);
  }
  return html;
}

function replaceUrlLastmod(sitemap, path, date) {
  const escapedUrl = `${SITE_ORIGIN}${path}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<url><loc>${escapedUrl}<\\/loc>(?:<lastmod>[^<]+<\\/lastmod>)?<\\/url>`);
  const replacement = `<url><loc>${SITE_ORIGIN}${path}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  return sitemap.replace(pattern, replacement);
}

const releaseInfo = JSON.parse(await readFile("dist/data/release.json", "utf8"));
const release = releaseInfo.release;

for (const path of await walkHtml("dist/directory")) {
  const html = await readFile(path, "utf8");
  await writeFile(path, enhanceCollectionPage(html, release));
}

for (const resource of resources) {
  const path = join("dist/service", resource.id, "index.html");
  const html = await readFile(path, "utf8");
  await writeFile(path, enhanceServicePage(html, resource, release));
}

let sitemap = await readFile("dist/sitemap.xml", "utf8");
const newest = latestDate(resources);
sitemap = replaceUrlLastmod(sitemap, "/", newest);
sitemap = replaceUrlLastmod(sitemap, "/directory", newest);
sitemap = replaceUrlLastmod(sitemap, "/transparency", newest);

for (const path of STATIC_WITHOUT_DATA_LASTMOD) sitemap = replaceUrlLastmod(sitemap, path, null);

for (const resource of resources) sitemap = replaceUrlLastmod(sitemap, `/service/${resource.id}`, resource.lastChecked);

for (const [type] of Object.entries(categories)) {
  const items = resources.filter((resource) => allTypes(resource).includes(type));
  sitemap = replaceUrlLastmod(sitemap, `/directory/help/${slugify(type)}`, latestDate(items));
}

const countries = [...new Set(resources.map((resource) => resource.country))];
for (const country of countries) {
  const items = resources.filter((resource) => resource.country === country);
  sitemap = replaceUrlLastmod(sitemap, `/directory/${slugify(country)}`, latestDate(items));
}

const regions = [...new Set(resources.map((resource) => resource.region).filter(Boolean))];
for (const region of regions) {
  const items = resources.filter((resource) => resource.region === region);
  sitemap = replaceUrlLastmod(sitemap, `/directory/region/${slugify(region)}`, latestDate(items));
}

try {
  const localIndex = JSON.parse(await readFile("dist/data/resources/local-index.json", "utf8"));
  for (const entry of localIndex.cities || []) {
    const items = resources.filter((resource) => resource.city === entry.city && resource.country === entry.country);
    sitemap = replaceUrlLastmod(sitemap, entry.path, latestDate(items));
  }
} catch {
  // Local SEO pages are optional; the core directory remains valid without them.
}

await writeFile("dist/sitemap.xml", sitemap);
