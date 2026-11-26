import { serviceContactMarkup } from "./service-contact.mjs";
import { relatedResources } from "./related-resources.mjs";
import { resourceScope } from "../src/utils/resource-scope.js";
import { serviceBeforeYouGoMarkup } from "./service-before-you-go.mjs";
import { isContactOnly } from "../src/utils/resource-location.js";
import { minify } from "terser";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace, isExactServiceSite } from "../src/utils/geo.js";
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
  for (const path of ["dist/directory.js", "dist/directory-startup.js", "dist/directory-geography.js", "dist/directory-results.js", "dist/directory-enhancements.css", "dist/legal.css", "dist/data/search-index.json"]) {
    hash.update(path);
    hash.update(await readFile(path));
  }
  return hash.digest("hex").slice(0, 12);
}

function relatedMarkup(resource) {
  const related = relatedResources(resource, resources);
  const country = String(resource.country || "").trim();
  const isCountry = Boolean(country && country !== "Global");
  const heading = related.length
    ? isCountry ? "Related help and wider finders" : "Related networks and finders"
    : "Explore more help";
  const countryHref = isCountry ? `/directory/${slugify(country)}` : "/directory/global";
  const note = related.length
    ? "Service areas and eligibility vary. Check details with each provider."
    : "RWN has limited listings for this area. A missing listing does not mean help is unavailable.";
  const broader = related.length < 6
    ? `<p class="directory-caution related-services__broader"><strong>Other places and wider coverage</strong><br /><a href="/directory">Browse the full directory</a>. Listings may cover different places; check coverage and eligibility with the provider.</p>`
    : "";

  return `<section class="related-services" aria-labelledby="related-services-title">
    <div class="related-services__heading"><h2 id="related-services-title">${escapeHtml(heading)}</h2>${related.length ? `<a href="${countryHref}">Browse more services</a>` : ""}</div>
    <p class="directory-caution related-services__note">${escapeHtml(note)}</p>
    ${related.length ? `<div class="related-services__grid">${related.map(({ candidate }) => {
      const kind = isContactOnly(candidate) ? "Phone or online help" : candidate.kind === "locator" ? "Resource finder" : candidate.kind === "network" ? "Service network" : "";
      const label = [kind, categories[candidate.category]?.label || "Essential help"].filter(Boolean).join(" · ");
      const place = candidate.kind === "direct" && isExactServiceSite(candidate)
        ? formatResourcePlace(candidate)
        : resourceScope(candidate).label;
      return `<a href="/service/${encodeURIComponent(candidate.id)}"><strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(place)}</span><small>${escapeHtml(label)}</small></a>`;
    }).join("")}</div>` : ""}
    ${broader}
  </section>`;
}

function accessibilityMarkup(resource) {
  if (!resource.accessibilityNote) return "";
  return `<aside class="service-accessibility" aria-label="Accessibility information"><strong>Accessibility</strong><p>${escapeHtml(resource.accessibilityNote)}</p></aside>`;
}

function assetLinks(release, includeScript) {
  return `<link rel="stylesheet" href="/directory-enhancements.css?v=${release}" />${includeScript ? `\n    <script src="/directory-startup.js?v=${release}"></script>\n    <script type="module" src="/directory.js?v=${release}"></script><script type="module" src="/src/utils/search-intent-entry.js?v=${releaseInfo.release}"></script>` : ""}`;
}

function directorySearchMarkup(scope) {
  const records = scope === "/directory" ? searchIndex.records : (searchIndex.scopes[scope] || []).map(index => searchIndex.records[index]);
  const countries = [...new Set(records.map(record => record.country))].sort((a, b) => a.localeCompare(b));
  const needs = [...new Set(records.flatMap(record => record.categoryLabels || []))].sort((a, b) => a.localeCompare(b));
  const countryControl = countries.length > 1 ? `<label class="directory-country-field"><span>Country or area</span><select data-directory-country disabled aria-describedby="directory-coverage-note"><option value="">All locations</option>${countries.map(country => `<option value="${escapeHtml(country)}">${escapeHtml(country === "Global" ? "Global resources (check coverage)" : country)}</option>`).join("")}</select></label>` : "";
  return `<section id="saved" class="saved-services" data-saved-services aria-labelledby="saved-services-heading">
    <div class="saved-services__heading"><div><h2 id="saved-services-heading" tabindex="-1">Saved services</h2><p>Useful contacts, ready for your next step.</p></div><a href="#directory-results">Browse directory <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></a></div>
    <p class="saved-services__privacy">Only in this browser, on this device. Anyone using this browser can see your list. Saving does not reserve a service or confirm availability.</p>
    <noscript><p>Turn on JavaScript to view or change saved services. You can still browse the directory below.</p></noscript>
    <p data-saved-summary role="status" aria-live="polite"></p>
    <div class="saved-services__empty" data-saved-empty hidden><svg class="saved-services__bookmark" viewBox="0 0 40 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h22v37l-11-7-11 7z" /><path d="M15 16h10m-10 6h7" /></svg><div><h3>Keep useful help close.</h3><p>Save a listing while you browse. Come back here for its contact details and source when you need them.</p><a href="#directory-results">Find services to save <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></a></div></div>
    <div class="saved-services__tools"><button type="button" data-saved-clear aria-expanded="false" aria-controls="saved-clear-confirmation" hidden>Clear saved list</button><button type="button" data-saved-retry hidden>Try again</button></div>
    <div id="saved-clear-confirmation" data-saved-confirmation hidden><p>Remove every saved service from this browser?</p><button type="button" data-saved-cancel>Keep list</button><button type="button" data-saved-confirm>Remove all saved services</button></div>
    <div data-saved-list></div><button type="button" data-saved-more hidden>Show more saved services</button>
    <p data-saved-status role="status" aria-live="polite"></p>
  </section><section class="directory-search-tools" data-directory-search aria-label="Search this directory">
    <div class="directory-search-tools__top">
      <label class="directory-search-control"><span>What do you need?</span><span class="directory-search-field"><span aria-hidden="true">⌕</span><input type="search" data-directory-query aria-label="What do you need?" placeholder="Food, a clinic, an organization…" autocomplete="off" enterkeyhint="search" aria-keyshortcuts="Alt+/ Escape" /></span></label>
      <label class="directory-place-field"><span>City or postal code</span><input type="search" data-directory-place aria-label="City or postal code" autocomplete="off" enterkeyhint="search" /></label>
    </div>
    ${countryControl ? `<details class="directory-location-filter"><summary>Filter by country or area</summary>${countryControl}</details>` : ""}
    <label class="directory-need-field"><span>Type of help</span><select data-directory-need disabled><option value="">All help</option>${needs.map(need => `<option value="${escapeHtml(need)}">${escapeHtml(need)}</option>`).join("")}</select></label>
    <div class="directory-category-chips" data-directory-categories role="group" aria-label="Filter by type of help"></div>
    <p id="directory-coverage-note" class="directory-coverage-note">Confirm hours and eligibility with the provider before you go. <a href="/editorial-policy">How we check listings</a>.</p>
    <div class="directory-search-tools__meta"><span data-directory-count role="status" aria-live="polite"></span><button class="directory-search-tools__clear" type="button" data-directory-clear hidden>Clear filters</button><button class="directory-search-tools__clear" type="button" data-directory-retry aria-disabled="false" hidden>Retry search</button></div>
    <template data-directory-notice><div class="policy-note warning-note"><p><strong>Offline mode.</strong> Search the saved directory; current availability and service-detail pages require a connection. Reconnect before traveling or relying on a listing.</p></div></template>
    <template data-directory-results><section><div class="directory-global-results__heading"><strong>Search results</strong><span data-global-summary></span></div><div class="directory-global-results__list" id="directory-global-list" data-global-list></div><button type="button" class="directory-search-tools__clear" data-directory-more aria-controls="directory-global-list" hidden>Show more listings</button></section></template>
    <template data-directory-empty><div class="directory-global-empty"><h2>No matching listings.</h2><p>A missing result does not mean help is unavailable.</p><div class="directory-empty-actions"><button type="button" data-fewer-words>Try without search words</button><button type="button" data-clear-all>Clear all filters</button></div><p>Or ${scope !== "/directory/global" ? '<a href="/directory/global">browse global resource finders</a>' : ""}${scope !== "/directory" ? `${scope !== "/directory/global" ? " or " : ""}<a href="/directory">browse the full directory</a>` : ""}.</p></div></template>
  </section>`;
}

function suggestionsMarkup() {
  return `<details class="directory-suggestions" data-directory-suggestions hidden>
    <summary>Get resource suggestions</summary>
    <p><a href="/account">Optional account</a> · No account needed. Choose topics to find listings in a city or ZIP, or resource finders and networks with wider coverage. These choices stay in your browser.</p>
    <form autocomplete="off" aria-label="Resource suggestions">
      <fieldset><legend>What kind of help are you looking for?</legend><div>
        ${Object.entries(categories).map(([id, { label }]) => `<label><input type="checkbox" data-suggestion-topic value="${escapeHtml(id)}" /> ${escapeHtml(label)}</label>`).join("")}
      </div></fieldset>
      <div><label class="suggestion-area-label" for="suggestion-area">City or U.S. ZIP (optional)</label>
        <input id="suggestion-area" data-suggestion-area type="text" maxlength="80" autocomplete="off" spellcheck="false" aria-describedby="suggestion-area-hint suggestion-area-error" />
        <small id="suggestion-area-hint">Use the exact city name or listed ZIP, not a street address. If cities share a name, enter city and country separated by a comma.</small>
        <p id="suggestion-area-error" data-suggestion-error role="status"></p>
      </div>
      <div><label><input type="checkbox" data-suggestion-remember aria-describedby="suggestion-remember-hint" /> Remember topics on this device</label>
        <small id="suggestion-remember-hint">Only Food, Water, Hygiene and Clothing can be saved. Never your location. Anyone using this browser can see saved topics.</small>
      </div>
      <div class="suggestion-actions"><button type="submit" class="directory-search-tools__clear">Find suggestions</button><button type="button" class="directory-search-tools__clear" data-suggestion-reset>Reset suggestions</button></div>
    </form>
    <p data-suggestion-status role="status" aria-live="polite"></p>
    <ul data-suggestion-results aria-label="Suggested listings"></ul>
    <p>Listings may offer free services, free options, or free ways to find help. Check cost, coverage, eligibility, hours and availability with the provider before relying on a suggestion.</p>
  </details>`;
}

function localLinksMarkup(country, entries) {
  if (!entries.length) return "";
  return `<section class="directory-local-browse"><details><summary><strong>Browse local directories</strong><span>${entries.length} ${entries.length === 1 ? "place" : "places"}</span></summary>
    <nav class="directory-local-links" aria-label="Local directories in ${escapeHtml(country)}"><div>${entries
      .sort((a, b) => a.city.localeCompare(b.city) || (a.administrativeArea || "").localeCompare(b.administrativeArea || ""))
      .map((entry) => `<a href="${escapeHtml(entry.path)}">${escapeHtml([entry.city, entry.administrativeArea].filter(Boolean).join(", "))} <span>${entry.count}</span></a>`)
      .join("")}</div></nav></details>
    <p>City pages are published only where RWN has at least three reviewed listings.</p>
  </section>`;
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
    const nextSteps = serviceContactMarkup(resource);
    html = html.replace('<div class="policy-note">', `${nextSteps}\n${serviceBeforeYouGoMarkup(resource)}\n      <div class="policy-note">`);
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
const catalogSource = (await readFile("public/catalog-request.js", "utf8")).replaceAll("export ", "");
const catalogImport = 'import { createCatalogLoader } from "./catalog-request.js";';
const { code: geographyCode } = await minify(await readFile("dist/directory-geography.js", "utf8"), { module: true });
await writeFile("dist/directory-geography.js", `${geographyCode}\n`);
const directoryEntry = await readFile("dist/directory.js", "utf8");
if (!directoryEntry.includes(catalogImport)) throw new Error("Directory catalog import was not found.");
const resultRenderer = await readFile("dist/directory-results.js", "utf8");
const stateSource = (await readFile("public/directory-state.js", "utf8")).replaceAll("export ", "");
const stateImport = 'import { readDirectoryState, writeDirectoryState, restoreDirectoryView } from "./directory-state.js";';
if (!directoryEntry.includes(stateImport)) throw new Error("Directory history import was not found.");
const rendererImport = 'import { createResultRow } from "./directory-results.js";';
if (!directoryEntry.includes(rendererImport)) throw new Error("Directory renderer import was not found.");
const searchImport = 'import { normalizeSearch as normalize, querySearchTokens as queryTokens, createIndexedSearchMatcher } from "../src/utils/search.js";';
if (!directoryEntry.includes(searchImport)) throw new Error("Directory search import was not found.");
const searchSource = (await readFile("src/utils/search.js", "utf8")).replaceAll("export ", "");
const directoryBundle = `${catalogSource}\n${searchSource}\nconst normalize=normalizeSearch,queryTokens=querySearchTokens;\n${resultRenderer.replace("export const createResultRow", "const createResultRow")}\n${stateSource}\n{\n${directoryEntry.replace(catalogImport, "").replace(rendererImport, "").replace(searchImport, "").replace(stateImport, "")}\n}`;
// Keep one complete offline entry, without another runtime request. A lexical
// wrapper lets the compiler shorten repeated references to stable browser objects;
// their mutable properties (history state, online status) are still read live.
// Fetch and timers remain global so transport recovery/testing can replace them.
// Terser keeps its safe transforms; real rendered/upgrade tests exercise this output.
const scopedDirectoryBundle = `((document,window,navigator,history)=>{${directoryBundle}})(document,window,navigator,history);`;
const { code: directoryCode } = await minify(scopedDirectoryBundle, { module: true, compress: { reduce_funcs: false }, mangle: { reserved: ["createResultRow"] } });
await writeFile("dist/directory.js", `${directoryCode}\n`);
// Load saved-list code only on an explicit #saved visit. Its compiled module
// embeds the same storage helper and result renderer, keeping directory search
// self-contained during upgrades from older offline workers.
const privacySource = (await readFile("src/utils/privacy.js", "utf8")).replaceAll("export ", "");
const savedSource = (await readFile("public/saved-services.js", "utf8")).replace(/^import[^\n]+\n/gm, "");
const savedBundle = `${catalogSource}\n${privacySource}\n${resultRenderer.replace("export const createResultRow", "const createResultRow")}\n${savedSource}`;
// Apply the same safe compiler settings to the lazy feature rather than grow its budget.
const { code: savedCode } = await minify(savedBundle, { module: true, compress: { reduce_funcs: false }, mangle: { reserved: ["initSavedServices", "createResultRow", "readSavedResources", "setResourceSaved"] } });
await writeFile("dist/saved-services.js", `${savedCode}\n`);
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

const suggestionEntry = (await readFile("public/directory-suggestions.js", "utf8")).replace(/^import[^;]+;\s*/gm, "").replaceAll("export ", "");
const { code: suggestionCode } = await minify(`${catalogSource}\n${privacySource}\n${suggestionEntry}`, { module: true });
const suggestionAssets = {};
for (const [type, content] of [["js", `${suggestionCode}\n`], ["css", await readFile("public/directory-suggestions.css")]]) {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const path = `/directory-suggestions.${hash}.${type}`;
  await writeFile(`dist${path}`, content);
  suggestionAssets[type] = path;
}

const searchIndex = JSON.parse(await readFile("dist/data/search-index.json", "utf8"));
for (const path of await walkHtml("dist/directory")) {
  const html = await readFile(path, "utf8");
  let enhanced = enhanceCollectionPage(html, directoryRelease, path.replace(/^dist/, "").replace(/\/index\.html$/, "").replace(/\/page\/\d+$/, ""));
  if (path === "dist/directory/index.html") {
    enhanced = enhanced.replace('<div class="directory-browse-tools">', `${suggestionsMarkup()}<div class="directory-browse-tools">`)
      .replace("</head>", `<link rel="stylesheet" href="${suggestionAssets.css}" /><script type="module" src="${suggestionAssets.js}?v=${directoryRelease}"></script>\n</head>`);
  }
  await writeFile(path, enhanced);
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
