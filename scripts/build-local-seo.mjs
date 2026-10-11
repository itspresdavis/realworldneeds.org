import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { freeAccessLabel } from "../src/data/free-access.js";
import { formatResourcePlace } from "../src/utils/geo.js";
import { sourceCheckRange } from "./source-check-range.mjs";

const SITE_ORIGIN = "https://www.realworldneeds.org";
const MIN_CITY_LISTINGS = 3;
const MIN_LOCAL_CATEGORY_LISTINGS = 3;

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
const latestReview = (items) => items.map((resource) => resource.lastChecked).filter(Boolean).sort().at(-1);

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;
}

function administrativeArea(resource) {
  const address = String(resource.address || "");
  if (resource.country === "United States") {
    return address.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/)?.[1] || "";
  }
  if (resource.country === "Canada") {
    return address.match(/,\s*([A-Z]{2})\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i)?.[1]?.toUpperCase() || "";
  }
  return "";
}

function locality(resource) {
  const city = String(resource.city || "").trim();
  const country = String(resource.country || "").trim();
  if (!city || !country || country === "Global") return null;
  return { city, country, administrativeArea: administrativeArea(resource) };
}

function displayLocation({ city, country, administrativeArea }) {
  return [city, administrativeArea, country].filter(Boolean).join(", ");
}

function placeSchema({ city, country, administrativeArea }) {
  return {
    "@type": "Place",
    name: displayLocation({ city, country, administrativeArea }),
    address: {
      "@type": "PostalAddress",
      addressLocality: city,
      addressCountry: country,
      ...(administrativeArea ? { addressRegion: administrativeArea } : {})
    }
  };
}

function resourceCard(resource) {
  return `<article class="directory-record">
    <header><div><p>${escapeHtml(resource.kind === "direct" ? "Service location" : resource.kind === "locator" ? "Help finder or referral" : "Service network")}</p><h2><a href="/service/${encodeURIComponent(resource.id)}">${escapeHtml(resource.name)}</a></h2><span>${escapeHtml(formatResourcePlace(resource))}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Source checked ${escapeHtml(resource.lastChecked)}</time></header>
    <p>${escapeHtml(resource.summary)}</p>
    <ul class="directory-aid" aria-label="Help categories">${aidLabels(resource).map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
    <dl><div><dt>Access</dt><dd>${escapeHtml(resource.accessType)}</dd></div><div><dt>Cost</dt><dd><strong>${escapeHtml(freeAccessLabel(resource))}.</strong> ${escapeHtml(resource.costNote)}</dd></div><div><dt>${resource.kind === "direct" ? "Address" : "Coverage"}</dt><dd>${escapeHtml(resource.address)}</dd></div>${resource.hours ? `<div><dt>Hours</dt><dd>${escapeHtml(resource.hours)}</dd></div>` : ""}</dl>
    <div class="directory-links"><a href="/service/${encodeURIComponent(resource.id)}">Full listing details</a><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Visit original source</a></div>
  </article>`;
}

function localityPath({ city, country, administrativeArea }, ambiguousBase) {
  const countrySlug = slugify(country);
  const citySlug = slugify(city);
  if (ambiguousBase && administrativeArea) return `/directory/local/${countrySlug}/${slugify(administrativeArea)}/${citySlug}`;
  return `/directory/local/${countrySlug}/${citySlug}`;
}

function localitySignature({ city, country, administrativeArea }) {
  return `${country}\u0000${administrativeArea || ""}\u0000${city}`;
}

function allocateLocalityPath(info, ambiguousBase, usedPaths) {
  const signature = localitySignature(info);
  const initial = localityPath(info, ambiguousBase);
  if (!usedPaths.has(initial)) {
    usedPaths.set(initial, signature);
    return initial;
  }

  const countrySlug = slugify(info.country);
  const citySlug = slugify(info.city);
  if (info.administrativeArea) {
    const qualified = `/directory/local/${countrySlug}/${slugify(info.administrativeArea)}/${citySlug}`;
    if (!usedPaths.has(qualified)) {
      usedPaths.set(qualified, signature);
      return qualified;
    }
  }

  const suffix = createHash("sha256").update(signature).digest("hex").slice(0, 8);
  let candidate = `/directory/local/${countrySlug}/${citySlug}-${suffix}`;
  let attempt = 1;
  while (usedPaths.has(candidate)) {
    candidate = `/directory/local/${countrySlug}/${citySlug}-${suffix}-${attempt}`;
    attempt += 1;
  }
  usedPaths.set(candidate, signature);
  return candidate;
}

function collectionSchema({ canonical, name, description, info, items, breadcrumbs }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name,
        description,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        about: placeSchema(info),
        mainEntity: { "@id": `${canonical}#list` },
        dateModified: latestReview(items)
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
        itemListElement: breadcrumbs.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          ...(item.item ? { item: item.item } : {})
        }))
      }
    ]
  };
}

function localCategoryGroups(items, localityCanonicalPath) {
  return Object.keys(categories)
    .map((type) => {
      const matching = items.filter((resource) => aidTypes(resource).includes(type));
      return {
        type,
        label: categories[type].label,
        items: matching,
        count: matching.length,
        lastmod: latestReview(matching),
        path: `${localityCanonicalPath}/help/${slugify(type)}`
      };
    })
    .filter((entry) => entry.count >= MIN_LOCAL_CATEGORY_LISTINGS)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function localBrowseMarkup(info, parentPath, localCategories, allTypesPresent) {
  const localTypes = new Set(localCategories.map((entry) => entry.type));
  const localLinks = localCategories.map((entry) => `<a href="${escapeHtml(entry.path)}">${escapeHtml(entry.label)} in ${escapeHtml(info.city)} (${entry.count})</a>`).join("");
  const broaderLinks = allTypesPresent
    .filter((type) => !localTypes.has(type))
    .map((type) => `<a href="/directory/help/${slugify(type)}">${escapeHtml(categories[type].label)} directory</a>`)
    .join("");
  return `<div class="directory-downloads"><strong>Browse this area</strong>${localLinks}${broaderLinks}<a href="${escapeHtml(parentPath)}">All help in ${escapeHtml(displayLocation(info))}</a><a href="/directory/${slugify(info.country)}">All services in ${escapeHtml(info.country)}</a><a href="/directory">Full directory</a></div>`;
}

function cityPage(info, items, canonicalPath, localCategories) {
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  const countrySlug = slugify(info.country);
  const display = displayLocation(info);
  const typesPresent = [...new Set(items.flatMap(aidTypes))].filter((type) => categories[type]);
  const categoryText = typesPresent.slice(0, 5).map((type) => categories[type].label.toLowerCase()).join(", ") || "essential help";
  const description = `Find free essential services in ${display}, including ${categoryText}. Browse ${items.length} reviewed listings connected to their original sources.`;
  const schema = collectionSchema({
    canonical,
    name: `Free essential services in ${display}`,
    description,
    info,
    items,
    breadcrumbs: [
      { name: "Home", item: `${SITE_ORIGIN}/` },
      { name: "Directory", item: `${SITE_ORIGIN}/directory` },
      { name: info.country, item: `${SITE_ORIGIN}/directory/${countrySlug}` },
      { name: display }
    ]
  });

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
  <meta property="og:title" content="Free Essential Services in ${escapeHtml(display)} | Real World Needs" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  ${jsonLd(schema)}
  <title>Free Essential Services in ${escapeHtml(display)} | Real World Needs</title>
</head>
<body>
  <a class="skip-link" href="#directory">Skip to local services</a>
  <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="/accessibility">Accessibility</a></nav></header>
  <main id="directory">
    <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Local directory</p><h1>Free essential services in ${escapeHtml(display)}.</h1><p class="legal-hero__lede">${escapeHtml(description)}</p><div class="legal-meta"><span>${items.length} reviewed listings</span><span>${directCount(items)} service locations</span><span>Original sources linked</span><span>Source checks ${escapeHtml(sourceCheckRange(items.map(resource => resource.lastChecked)))}</span></div></div></section>
    <div class="directory-shell">
      <nav class="directory-downloads" aria-label="Breadcrumb"><a href="/">Home</a><a href="/directory">Directory</a><a href="/directory/${countrySlug}">${escapeHtml(info.country)}</a><span aria-current="page">${escapeHtml(display)}</span></nav>
      <div class="policy-note"><p><strong>Services can change.</strong> Check the original source or contact the organization before you travel. RWN shows where information came from and when it was last reviewed.</p></div>
      ${localBrowseMarkup(info, canonicalPath, localCategories, typesPresent)}
      <div class="directory-records">${items.map(resourceCard).join("\n")}</div>
    </div>
  </main>
  <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
</body>
</html>`;
}

function cityCategoryPage(info, items, type, canonicalPath, parentPath, siblingCategories) {
  const category = categories[type];
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  const parentCanonical = `${SITE_ORIGIN}${parentPath}`;
  const countrySlug = slugify(info.country);
  const display = displayLocation(info);
  const labelLower = category.label.toLowerCase();
  const description = `${category.description} Browse ${items.length} reviewed ${labelLower} listings in ${display}, with original sources, access details, and review dates.`;
  const pageName = `${category.label} assistance in ${display}`;
  const schema = collectionSchema({
    canonical,
    name: pageName,
    description,
    info,
    items,
    breadcrumbs: [
      { name: "Home", item: `${SITE_ORIGIN}/` },
      { name: "Directory", item: `${SITE_ORIGIN}/directory` },
      { name: info.country, item: `${SITE_ORIGIN}/directory/${countrySlug}` },
      { name: display, item: parentCanonical },
      { name: category.label }
    ]
  });
  const siblingLinks = siblingCategories
    .filter((entry) => entry.type !== type)
    .map((entry) => `<a href="${escapeHtml(entry.path)}">${escapeHtml(entry.label)} (${entry.count})</a>`)
    .join("");

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
  <meta property="og:title" content="${escapeHtml(category.label)} Help in ${escapeHtml(display)} | Real World Needs" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  ${jsonLd(schema)}
  <title>${escapeHtml(category.label)} Help in ${escapeHtml(display)} | Real World Needs</title>
</head>
<body>
  <a class="skip-link" href="#directory">Skip to ${escapeHtml(labelLower)} services</a>
  <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="/accessibility">Accessibility</a></nav></header>
  <main id="directory">
    <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Local ${escapeHtml(labelLower)} directory</p><h1>Find free ${escapeHtml(labelLower)} help in ${escapeHtml(display)}.</h1><p class="legal-hero__lede">${escapeHtml(description)}</p><div class="legal-meta"><span>${items.length} reviewed listings</span><span>${directCount(items)} service locations</span><span>Original sources linked</span><span>Source checks ${escapeHtml(sourceCheckRange(items.map(resource => resource.lastChecked)))}</span></div></div></section>
    <div class="directory-shell">
      <nav class="directory-downloads" aria-label="Breadcrumb"><a href="/">Home</a><a href="/directory">Directory</a><a href="/directory/${countrySlug}">${escapeHtml(info.country)}</a><a href="${escapeHtml(parentPath)}">${escapeHtml(display)}</a><span aria-current="page">${escapeHtml(category.label)}</span></nav>
      <div class="policy-note"><p><strong>Services can change.</strong> Check the original source or contact the organization before you travel. RWN shows where information came from and when it was last reviewed.</p></div>
      <div class="directory-downloads"><strong>Browse nearby needs</strong><a href="${escapeHtml(parentPath)}">All help in ${escapeHtml(display)}</a>${siblingLinks}<a href="/directory/help/${slugify(type)}">Global ${escapeHtml(labelLower)} directory</a></div>
      <div class="directory-records">${items.map(resourceCard).join("\n")}</div>
    </div>
  </main>
  <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
</body>
</html>`;
}

const baseGroups = new Map();
for (const resource of resources) {
  const info = locality(resource);
  if (!info) continue;
  const baseKey = `${info.city}\u0000${info.country}`;
  if (!baseGroups.has(baseKey)) baseGroups.set(baseKey, []);
  baseGroups.get(baseKey).push({ resource, info });
}

const groups = [];
for (const [baseKey, entries] of baseGroups) {
  const knownAreas = [...new Set(entries.map(({ info }) => info.administrativeArea).filter(Boolean))];
  const ambiguousBase = knownAreas.length > 1;
  const byArea = new Map();

  for (const entry of entries) {
    const key = ambiguousBase ? entry.info.administrativeArea : "";
    if (ambiguousBase && !key) continue;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(entry);
  }

  for (const [, areaEntries] of byArea) {
    const info = { ...areaEntries[0].info };
    if (!ambiguousBase) info.administrativeArea = knownAreas.length === 1 ? knownAreas[0] : info.administrativeArea;
    groups.push({ baseKey, ambiguousBase, info, items: areaEntries.map(({ resource }) => resource) });
  }
}

const eligible = groups
  .filter(({ items }) => items.length >= MIN_CITY_LISTINGS)
  .sort((a, b) => `${a.info.country}\u0000${a.info.administrativeArea}\u0000${a.info.city}`.localeCompare(`${b.info.country}\u0000${b.info.administrativeArea}\u0000${b.info.city}`));

const sitemapEntries = [];
const manifest = [];
const usedPaths = new Map();
for (const { info, items, ambiguousBase } of eligible) {
  const path = allocateLocalityPath(info, ambiguousBase, usedPaths);
  const localCategories = localCategoryGroups(items, path);
  const output = join("dist", path);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "index.html"), cityPage(info, items, path, localCategories));
  sitemapEntries.push({ path, lastmod: latestReview(items) });

  for (const entry of localCategories) {
    const categoryOutput = join("dist", entry.path);
    await mkdir(categoryOutput, { recursive: true });
    await writeFile(join(categoryOutput, "index.html"), cityCategoryPage(info, entry.items, entry.type, entry.path, path, localCategories));
    sitemapEntries.push({ path: entry.path, lastmod: entry.lastmod });
  }

  manifest.push({
    city: info.city,
    country: info.country,
    administrativeArea: info.administrativeArea || null,
    count: items.length,
    lastmod: latestReview(items),
    path,
    categories: localCategories.map(({ type, label, count, lastmod, path: categoryPath }) => ({
      type,
      label,
      count,
      lastmod,
      path: categoryPath
    }))
  });
}

await mkdir("dist/data/resources", { recursive: true });
await writeFile("dist/data/resources/local-index.json", `${JSON.stringify({
  schemaVersion: "1.2",
  minimumListings: MIN_CITY_LISTINGS,
  minimumCategoryListings: MIN_LOCAL_CATEGORY_LISTINGS,
  pageCount: manifest.length,
  categoryPageCount: manifest.reduce((sum, entry) => sum + entry.categories.length, 0),
  cities: manifest
}, null, 2)}\n`);

const sitemapPath = "dist/sitemap.xml";
let sitemap = await readFile(sitemapPath, "utf8");
const additions = sitemapEntries.map(({ path, lastmod }) => `  <url><loc>${SITE_ORIGIN}${path}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n");
sitemap = sitemap.replace("</urlset>", `${additions ? `${additions}\n` : ""}</urlset>`);
await writeFile(sitemapPath, sitemap);
