import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { freeAccessLabel } from "../src/data/free-access.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const SITE_ORIGIN = "https://www.realworldneeds.org";
const MIN_CITY_LISTINGS = 3;

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

const aidTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];
const aidLabels = (resource) => aidTypes(resource).map((type) => categories[type]?.label || type);
const directCount = (items) => items.filter((resource) => resource.kind === "direct").length;

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;
}

function cityKey(resource) {
  const city = String(resource.city || "").trim();
  const country = String(resource.country || "").trim();
  if (!city || !country || country === "Global") return null;
  return `${city}\u0000${country}`;
}

function resourceCard(resource) {
  return `<article class="directory-record">
    <header><div><p>${escapeHtml(resource.kind === "direct" ? "Service location" : "Resource finder")}</p><h2><a href="/service/${encodeURIComponent(resource.id)}">${escapeHtml(resource.name)}</a></h2><span>${escapeHtml(formatResourcePlace(resource))}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Checked ${escapeHtml(resource.lastChecked)}</time></header>
    <p>${escapeHtml(resource.summary)}</p>
    <ul class="directory-aid" aria-label="Help categories">${aidLabels(resource).map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
    <dl><div><dt>Access</dt><dd>${escapeHtml(resource.accessType)}</dd></div><div><dt>Cost</dt><dd><strong>${escapeHtml(freeAccessLabel(resource))}.</strong> ${escapeHtml(resource.costNote)}</dd></div><div><dt>${resource.kind === "direct" ? "Address" : "Coverage"}</dt><dd>${escapeHtml(resource.address)}</dd></div>${resource.hours ? `<div><dt>Hours</dt><dd>${escapeHtml(resource.hours)}</dd></div>` : ""}</dl>
    <div class="directory-links"><a href="/service/${encodeURIComponent(resource.id)}">Full listing details</a><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Visit original source</a></div>
  </article>`;
}

function cityPage(city, country, items) {
  const countrySlug = slugify(country);
  const citySlug = slugify(city);
  const canonicalPath = `/directory/local/${countrySlug}/${citySlug}`;
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  const categoriesPresent = [...new Set(items.flatMap(aidTypes))].filter((type) => categories[type]);
  const categoryText = categoriesPresent.slice(0, 5).map((type) => categories[type].label.toLowerCase()).join(", ");
  const description = `Find free essential services in ${city}, ${country}, including ${categoryText}. Browse ${items.length} reviewed listings connected to their original sources.`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: `Free essential services in ${city}, ${country}`,
        description,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        about: { "@type": "Place", name: `${city}, ${country}` },
        mainEntity: { "@id": `${canonical}#list` }
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#list`,
        numberOfItems: items.length,
        itemListElement: items.slice(0, 50).map((resource, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: resource.name,
          url: `${SITE_ORIGIN}/service/${encodeURIComponent(resource.id)}`
        }))
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Directory", item: `${SITE_ORIGIN}/directory` },
          { "@type": "ListItem", position: 3, name: country, item: `${SITE_ORIGIN}/directory/${countrySlug}` },
          { "@type": "ListItem", position: 4, name: city }
        ]
      }
    ]
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta name="theme-color" content="#071926" />
  <link rel="canonical" href="${canonical}" />
  <link rel="stylesheet" href="/legal.css" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Real World Needs" />
  <meta property="og:title" content="Free Essential Services in ${escapeHtml(city)}, ${escapeHtml(country)} | Real World Needs" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  ${jsonLd(schema)}
  <title>Free Essential Services in ${escapeHtml(city)}, ${escapeHtml(country)} | Real World Needs</title>
</head>
<body>
  <a class="skip-link" href="#directory">Skip to local services</a>
  <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="/accessibility">Accessibility</a></nav></header>
  <main id="directory">
    <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Local directory</p><h1>Free essential services in ${escapeHtml(city)}, ${escapeHtml(country)}.</h1><p class="legal-hero__lede">${escapeHtml(description)}</p><div class="legal-meta"><span>${items.length} reviewed listings</span><span>${directCount(items)} service locations</span><span>Original sources linked</span></div></div></section>
    <div class="directory-shell">
      <nav class="directory-downloads" aria-label="Breadcrumb"><a href="/">Home</a><a href="/directory">Directory</a><a href="/directory/${countrySlug}">${escapeHtml(country)}</a><span aria-current="page">${escapeHtml(city)}</span></nav>
      <div class="policy-note"><p><strong>Services can change.</strong> Check the original source or contact the organization before you travel. RWN shows where information came from and when it was last reviewed.</p></div>
      <div class="directory-downloads"><strong>Browse this area</strong>${categoriesPresent.map((type) => `<a href="/directory/help/${slugify(type)}">${escapeHtml(categories[type].label)}</a>`).join("")}<a href="/directory/${countrySlug}">All services in ${escapeHtml(country)}</a><a href="/directory">Full directory</a></div>
      <div class="directory-records">${items.map(resourceCard).join("\n")}</div>
    </div>
  </main>
  <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
</body>
</html>`;
}

const groups = new Map();
for (const resource of resources) {
  const key = cityKey(resource);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(resource);
}

const eligible = [...groups.entries()]
  .map(([key, items]) => ({ key, items }))
  .filter(({ items }) => items.length >= MIN_CITY_LISTINGS)
  .sort((a, b) => a.key.localeCompare(b.key));

const paths = [];
const manifest = [];
for (const { key, items } of eligible) {
  const [city, country] = key.split("\u0000");
  const countrySlug = slugify(country);
  const citySlug = slugify(city);
  const output = join("dist/directory/local", countrySlug, citySlug);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "index.html"), cityPage(city, country, items));
  const path = `/directory/local/${countrySlug}/${citySlug}`;
  paths.push(path);
  manifest.push({ city, country, count: items.length, path });
}

await mkdir("dist/data/resources", { recursive: true });
await writeFile("dist/data/resources/local-index.json", `${JSON.stringify({ schemaVersion: "1.0", minimumListings: MIN_CITY_LISTINGS, pageCount: manifest.length, cities: manifest }, null, 2)}\n`);

const sitemapPath = "dist/sitemap.xml";
let sitemap = await readFile(sitemapPath, "utf8");
const lastmod = [...resources].map((resource) => resource.lastChecked).sort().at(-1) || new Date().toISOString().slice(0, 10);
const additions = paths.map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n");
sitemap = sitemap.replace("</urlset>", `${additions ? `${additions}\n` : ""}</urlset>`);
await writeFile(sitemapPath, sitemap);
