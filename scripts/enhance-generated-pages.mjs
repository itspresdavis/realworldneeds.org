import { minify } from "terser";
import { phoneLinks } from "../src/utils/phone.js";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace } from "../src/utils/geo.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

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

async function directoryAssetRelease() {
  const hash = createHash("sha256");
  for (const path of ["dist/directory.js", "dist/directory-results.js", "dist/directory-enhancements.css", "dist/legal.css", "dist/data/search-index.json"]) {
    hash.update(path);
    hash.update(await readFile(path));
  }
  return hash.digest("hex").slice(0, 12);
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
    .filter((candidate) => candidate.id !== resource.id && !sourceClosureNotice(candidate))
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

function accessibilityMarkup(resource) {
  if (!resource.accessibilityNote) return "";
  return `<aside class="service-accessibility" aria-label="Accessibility information"><strong>Accessibility</strong><p>${escapeHtml(resource.accessibilityNote)}</p></aside>`;
}

function serviceNextStepMarkup(resource) {
  const links = [`<a class="is-primary" href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer"><strong>Official source</strong><span>Verify current details</span></a>`];
  const phones = phoneLinks(resource.phone);
  const phoneContext = resource.phone && (phones.length !== 1 || phones[0].label !== resource.phone)
    ? `<span class="service-next-steps__context" data-phone-context>Phone: ${escapeHtml(resource.phone)}</span>`
    : "";
  for (const { label, href } of phones) {
    links.push(`<a href="${href}"><strong>Call</strong><span>${escapeHtml(label)}</span></a>`);
  }
  if (resource.kind === "direct" && Number.isFinite(resource.lat) && Number.isFinite(resource.lng)) {
    const coordinate = `${resource.lat},${resource.lng}`;
    links.push(`<a href="https://maps.apple.com/?q=${encodeURIComponent(resource.name)}&amp;ll=${encodeURIComponent(coordinate)}" rel="noopener noreferrer"><strong>Directions</strong><span>Open Apple Maps</span></a>`);
    links.push(`<a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(coordinate)}" rel="noopener noreferrer"><strong>Google Maps</strong><span>Open location</span></a>`);
  }
  links.push(`<a href="/#resource=${encodeURIComponent(resource.id)}"><strong>Interactive map</strong><span>Show this listing on RWN</span></a>`);
  return `<nav class="service-next-steps" aria-label="Next steps for this service"><div><span>Next step</span><strong>Contact or verify the service</strong>${phoneContext}</div><div>${links.join("")}</div></nav>`;
}

function assetLinks(release, includeScript) {
  return `<link rel="stylesheet" href="/directory-enhancements.css?v=${release}" />${includeScript ? `\n    <script type="module" src="/directory.js?v=${release}"></script>` : ""}`;
}

function directorySearchMarkup(scope) {
  const records = scope === "/directory" ? searchIndex.records : (searchIndex.scopes[scope] || []).map(index => searchIndex.records[index]);
  const countries = [...new Set(records.map(record => record.country))].sort((a, b) => a.localeCompare(b));
  const countryControl = countries.length > 1 ? `<label class="directory-country-field"><span>Country or area listed</span><select data-directory-country disabled aria-describedby="directory-coverage-note"><option value="">All listed countries and areas</option>${countries.map(country => `<option value="${escapeHtml(country)}">${escapeHtml(country === "Global" ? "Global resources (check coverage)" : country)}</option>`).join("")}</select></label>` : "";
  return `<section id="saved" class="saved-services" data-saved-services aria-labelledby="saved-services-heading">
    <div class="saved-services__heading"><h2 id="saved-services-heading" tabindex="-1">Saved services</h2><a href="#directory-results">Browse directory</a></div>
    <p class="saved-services__privacy">Only in this browser, on this device. Anyone using this browser can see your list. Saving does not reserve a service or confirm availability.</p>
    <noscript><p>Turn on JavaScript to view or change saved services. You can still browse the directory below.</p></noscript>
    <p data-saved-summary role="status" aria-live="polite"></p>
    <div class="saved-services__tools"><button type="button" data-saved-clear aria-expanded="false" aria-controls="saved-clear-confirmation" hidden>Clear saved list</button><button type="button" data-saved-retry hidden>Try again</button></div>
    <div id="saved-clear-confirmation" data-saved-confirmation hidden><p>Remove every saved service from this browser?</p><button type="button" data-saved-cancel>Keep list</button><button type="button" data-saved-confirm>Remove all saved services</button></div>
    <div data-saved-list></div><button type="button" data-saved-more hidden>Show more saved services</button>
    <p data-saved-status role="status" aria-live="polite"></p>
  </section><section class="directory-search-tools" data-directory-search aria-label="Search this directory">
    <div class="directory-search-tools__top">
      <label class="directory-search-control"><span>Search this directory</span><span class="directory-search-field"><span aria-hidden="true">⌕</span><input type="search" data-directory-query aria-label="Search this directory" placeholder="Search services, organizations, cities, or addresses" autocomplete="off" enterkeyhint="search" aria-keyshortcuts="/ Escape" /></span></label>
      ${countryControl}
      <button class="directory-search-tools__clear" type="button" data-directory-clear hidden>Clear filters</button>
    </div>
    <p id="directory-coverage-note" class="directory-coverage-note">RWN does not list every service or place. Finders and networks cover broader areas. Services can change: check coverage, access and current details with the provider before travel.</p>
    <div class="directory-search-tools__meta"><span data-directory-count role="status" aria-live="polite"></span><span><kbd>/</kbd><span> focuses search · Escape clears</span></span></div>
    <div class="directory-category-chips" data-directory-categories role="group" aria-label="Filter by type of help"></div>
  </section>`;
}

function localLinksMarkup(country, entries) {
  if (!entries.length) return "";
  return `<nav class="directory-local-links" aria-label="Local directories in ${escapeHtml(country)}"><div><strong>Browse local directories</strong><span>City pages are published only where RWN has at least three reviewed listings.</span></div><div>${entries
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
    .map((entry) => `<a href="${escapeHtml(entry.path)}">${escapeHtml([entry.city, entry.administrativeArea].filter(Boolean).join(", "))} <span>${entry.count}</span></a>`)
    .join("")}</div></nav>`;
}

function enhanceCollectionPage(html, release, scope) {
  if (!html.includes('<div class="directory-records">')) return html;
  if (!html.includes("directory-enhancements.css")) {
    html = html.replace('<link rel="stylesheet" href="/legal.css" />', `<link rel="stylesheet" href="/legal.css" />\n    ${assetLinks(release, true)}`);
  }
  if (!html.includes("data-directory-search")) {
    const searchMarkup = directorySearchMarkup(scope);
    html = html.replace("</head>", `<link rel="stylesheet" href="/saved-services.css?v=${savedRelease}" /><script type="module" src="/saved-loader.js?v=${savedRelease}"></script>\n</head>`);
    const breadcrumb = /(<nav class="directory-downloads" aria-label="Breadcrumb">[\s\S]*?<\/nav>)/;
    html = breadcrumb.test(html)
      ? html.replace(breadcrumb, `$1\n        ${searchMarkup}`)
      : html.replace('<div class="directory-records">', `${searchMarkup}\n        <div class="directory-records">`);
  }
  // Keep the coverage and travel caution with the search controls, including
  // filtered results, instead of repeating it below the form.
  html = html.replace(/<div class="policy-note"><p><strong>Services can change\.<\/strong>[\s\S]*?<\/p><\/div>/, "<!-- directory-browse-extras -->");
  return html;
}

function enhanceServicePage(html, resource, release) {
  if (!html.includes("directory-enhancements.css")) {
    html = html.replace('<link rel="stylesheet" href="/legal.css" />', `<link rel="stylesheet" href="/legal.css" />\n  ${assetLinks(release, false)}`);
  }
  if (!html.includes("service-next-steps")) {
    const nextSteps = serviceNextStepMarkup(resource);
    html = html.replace('<div class="policy-note">', `${nextSteps}\n      <div class="policy-note">`);
  }
  const accessibility = accessibilityMarkup(resource);
  if (accessibility && !html.includes("service-accessibility")) {
    html = html.replace("        <h3>Services offered</h3>", `        ${accessibility}\n        <h3>Services offered</h3>`);
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
// Keep the shipped entry self-contained: an older offline worker can refresh
// directory.js before it successfully installs a new complete offline release.
const directoryEntry = await readFile("dist/directory.js", "utf8");
const resultRenderer = await readFile("dist/directory-results.js", "utf8");
const stateSource = (await readFile("public/directory-state.js", "utf8")).replaceAll("export ", "");
const stateImport = 'import { readDirectoryState, writeDirectoryState } from "./directory-state.js";';
if (!directoryEntry.includes(stateImport)) throw new Error("Directory history import was not found.");
const rendererImport = 'import { createResultRow } from "./directory-results.js";';
if (!directoryEntry.includes(rendererImport)) throw new Error("Directory renderer import was not found.");
const searchImport = 'import { normalizeSearch as normalize, querySearchTokens as queryTokens, resourceSearchScore as scoreRecord } from "../src/utils/search.js";';
if (!directoryEntry.includes(searchImport)) throw new Error("Directory search import was not found.");
const searchSource = (await readFile("src/utils/search.js", "utf8")).replaceAll("export ", "");
const directoryBundle = `${searchSource}\nconst normalize=normalizeSearch,queryTokens=querySearchTokens,scoreRecord=resourceSearchScore;\n${resultRenderer.replace("export const createResultRow", "const createResultRow")}\n${stateSource}\n${directoryEntry.replace(rendererImport, "").replace(searchImport, "").replace(stateImport, "")}`;
// Keep the complete offline entry under its existing 14 KB ceiling, without
// another runtime request. Conservative constant/boolean simplifications and
// local name/whitespace minification preserve the self-contained entry.
const { code: directoryCode } = await minify(directoryBundle, { module: true, compress: { defaults: false, booleans: true, conditionals: true, evaluate: true, sequences: true }, mangle: { reserved: ["createResultRow", "root"] } });
await writeFile("dist/directory.js", `${directoryCode}\n`);
// Load saved-list code only on an explicit #saved visit. Its compiled module
// embeds the same storage helper and result renderer, keeping directory search
// self-contained during upgrades from older offline workers.
const privacySource = (await readFile("src/utils/privacy.js", "utf8")).replaceAll("export ", "");
const savedSource = (await readFile("public/saved-services.js", "utf8")).replace(/^import[^\n]+\n/gm, "");
await writeFile("dist/saved-services.js", `${privacySource}\n${resultRenderer.replace("export const createResultRow", "const createResultRow")}\n${savedSource}`);
const savedHash = createHash("sha256");
for (const path of ["dist/saved-loader.js", "dist/saved-services.js", "dist/saved-services.css", "dist/data/search-index.json"]) {
  savedHash.update(path); savedHash.update(await readFile(path));
}
const savedRelease = savedHash.digest("hex").slice(0, 12);
releaseInfo.savedServicesRelease = savedRelease;
const directoryRelease = await directoryAssetRelease();
releaseInfo.directoryRelease = directoryRelease;
await writeFile("dist/data/release.json", `${JSON.stringify(releaseInfo, null, 2)}\n`);

let localIndex = { cities: [] };
try {
  localIndex = JSON.parse(await readFile("dist/data/resources/local-index.json", "utf8"));
} catch {
  // Local pages are an enhancement; the global directory must still build without them.
}

const searchIndex = JSON.parse(await readFile("dist/data/search-index.json", "utf8"));
for (const path of await walkHtml("dist/directory")) {
  const html = await readFile(path, "utf8");
  await writeFile(path, enhanceCollectionPage(html, directoryRelease, path.replace(/^dist/, "").replace(/\/index\.html$/, "").replace(/\/page\/\d+$/, "")));
}

const localByCountry = new Map();
for (const entry of localIndex.cities || []) {
  if (!localByCountry.has(entry.country)) localByCountry.set(entry.country, []);
  localByCountry.get(entry.country).push(entry);
}
for (const [country, entries] of localByCountry) {
  const path = join("dist/directory", slugify(country), "index.html");
  try {
    let html = await readFile(path, "utf8");
    if (!html.includes("directory-local-links")) {
      const markup = localLinksMarkup(country, entries);
      html = html.replace("<!-- directory-browse-extras -->", markup);
      await writeFile(path, html);
    }
  } catch {
    // Some synthetic/global country labels may not have a country landing page.
  }
}

for (const resource of resources) {
  const path = join("dist/service", resource.id, "index.html");
  const html = await readFile(path, "utf8");
  await writeFile(path, enhanceServicePage(html, resource, directoryRelease));
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

for (const entry of localIndex.cities || []) {
  sitemap = replaceUrlLastmod(sitemap, entry.path, entry.lastmod || null);
  for (const category of entry.categories || []) sitemap = replaceUrlLastmod(sitemap, category.path, category.lastmod || null);
}
await writeFile("dist/sitemap.xml", sitemap);
