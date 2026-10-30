import { isContactOnly, hasMapCoordinates, contactOnlyNotice } from "../src/utils/resource-location.js";
import { phoneLinks, phoneMarkup } from "../src/utils/phone.js";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { freeAccessLabel, freeAccessModels } from "../src/data/free-access.js";
import { sourceClosureMarkup, availabilityInstructions } from "../src/utils/source-status.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { formatResourcePlace } from "../src/utils/geo.js";
import { resourceDescription } from "./resource-description.mjs";
import { createThreeAssets, versionThreeReferences } from "./three-assets.mjs";

// A page of 80 expanded records created a 34,000px scroll. Sixty compact
// records keeps a browse page purposeful while whole-catalog search remains
// available for every listing.
const DIRECTORY_PAGE_SIZE = 60;
const SITE_ORIGIN = "https://www.realworldneeds.org";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

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
  : resource.kind === "locator" ? "Help finder or referral" : "Service network";

const aidTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];
const aidLabels = (resource) => aidTypes(resource).map((type) => categories[type]?.label || type);
const mapResources = resources.filter(hasMapCoordinates);
const hasContactOnlyResources = resources.some(isContactOnly);
const directCount = resources.filter((resource) => resource.kind === "direct").length;
const coverageCount = new Set(resources.map((resource) => resource.country)).size;
const latestReview = [...resources].sort((a, b) => b.lastChecked.localeCompare(a.lastChecked))[0]?.lastChecked || BUILD_DATE;
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

async function releaseHash(vendorRelease) {
  const hash = createHash("sha256");
  hash.update("three-vendor\0").update(vendorRelease);
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

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;
}

function breadcrumbs(items) {
  return `<nav class="directory-downloads" aria-label="Breadcrumb"><a href="/">Home</a>${items.map((item) => item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : `<span aria-current="page">${escapeHtml(item.label)}</span>`).join("")}</nav>`;
}

function directoryRecordActions(resource, coordinate) {
  const links = [];
  for (const { label, href } of phoneLinks(resource.phone)) {
    links.push(`<a class="is-call" href="${href}">Call ${escapeHtml(label)}</a>`);
  }
  if (resource.kind === "direct" && hasMapCoordinates(resource)) {
    links.push(`<a class="is-directions" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Directions</a>`);
  }
  if (isContactOnly(resource) && resource.accessUrl) {
    links.push(`<a href="${escapeHtml(resource.accessUrl)}" rel="noopener noreferrer">Get help online</a>`);
  }
  links.push(`<a class="is-details" href="/service/${encodeURIComponent(resource.id)}">Open listing</a>`);
  return `<nav class="directory-record__actions" data-rwn-actions="${escapeHtml(resource.id)}" aria-label="Actions for ${escapeHtml(resource.name)}">${links.join("")}</nav>`;
}

function resourceRecord(resource) {
  const place = formatResourcePlace(resource);
  const coordinate = `${resource.lat},${resource.lng}`;
  const phone = resource.phone
    ? `<div><dt>Phone</dt><dd>${phoneMarkup(resource.phone)}</dd></div>`
    : "";
  const contactOnly = isContactOnly(resource);
  const maps = resource.kind === "direct" && hasMapCoordinates(resource)
    ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(resource.name)}&amp;ll=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Apple Maps</a>`
    : "";
  const globeLink = hasMapCoordinates(resource) ? `<a href="/#resource=${encodeURIComponent(resource.id)}">Show on the globe</a>` : "";
  const contactFacts = contactOnly ? `<div><dt>Coverage details</dt><dd>${escapeHtml(resource.coverageNote)}</dd></div><div><dt>Eligibility</dt><dd>${escapeHtml(resource.eligibility)}</dd></div>${resource.phone ? `<div><dt>Phone dialing scope</dt><dd>${escapeHtml(resource.phoneAccess)}</dd></div>` : ""}` : "";
  const addressLabel = resource.kind === "direct" ? "Address" : "Coverage";
  return `<article class="directory-record" id="${escapeHtml(resource.id)}">
    <header><div><p>${escapeHtml(kindLabel(resource))}</p><h2><a href="/service/${encodeURIComponent(resource.id)}">${escapeHtml(resource.name)}</a></h2><span>${escapeHtml(place)}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Source checked ${escapeHtml(resource.lastChecked)}</time></header>
    ${sourceClosureMarkup(resource)}
    <p class="directory-record__summary">${escapeHtml(resource.summary)}</p>
    <ul class="directory-aid" aria-label="Aid categories">${aidLabels(resource).map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
    <div class="directory-record__facts" aria-label="Access at a glance"><div><span>Cost</span><strong>${escapeHtml(freeAccessLabel(resource))}.</strong><p>${escapeHtml(resource.costNote)}</p></div><div><span>Access</span><strong>${escapeHtml(resource.accessType)}</strong></div></div>
    ${contactOnly ? `<p class="directory-caution">${escapeHtml(contactOnlyNotice(resource))}</p><p class="directory-caution"><strong>Coverage:</strong> ${escapeHtml(resource.coverageNote)} <strong>Eligibility:</strong> ${escapeHtml(resource.eligibility)}${resource.phone ? ` <strong>Phone dialing scope:</strong> ${escapeHtml(resource.phoneAccess)}` : ""}</p>` : ""}
    ${directoryRecordActions(resource, coordinate)}
    <details class="directory-record__more"><summary>${contactOnly ? "Contact, coverage &amp; source" : "Hours, location &amp; source"}</summary><div class="directory-record__more-body"><dl><div><dt>${addressLabel}</dt><dd>${escapeHtml(resource.address)}</dd></div>${resource.hours ? `<div><dt>Hours</dt><dd>${escapeHtml(resource.hours)}</dd></div>` : ""}${phone}${contactFacts}</dl><p class="directory-caution"><strong>${contactOnly ? "Check before contacting." : "Check before you go."}</strong> ${escapeHtml(contactOnly ? contactOnlyNotice(resource) : availabilityInstructions(resource))}</p><nav class="directory-record__links" aria-label="More information for ${escapeHtml(resource.name)}"><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Official source</a>${maps}${globeLink}</nav></div></details>
  </article>`;
}

function pageHref(basePath, page) {
  return page === 1 ? basePath : `${basePath}/page/${page}`;
}

function pagination(basePath, page, totalPages) {
  if (totalPages <= 1) return "";
  const links = [];
  if (page > 1) links.push(`<a rel="prev" href="${pageHref(basePath, page - 1)}">Previous</a>`);
  links.push(`<span>Page ${page} of ${totalPages}</span>`);
  if (page < totalPages) links.push(`<a rel="next" href="${pageHref(basePath, page + 1)}">Next</a>`);
  // Keep long collections one link away without making visitors scroll past
  // dozens of page buttons. Native details and real anchors work without JS.
  const pages = Array.from({ length: totalPages }, (_, index) => {
    const number = index + 1;
    return number === page
      ? `<li><span aria-current="page" aria-label="Page ${number}, current page">${number}</span></li>`
      : `<li><a href="${pageHref(basePath, number)}" aria-label="Page ${number}">${number}</a></li>`;
  }).join("");
  return `<nav class="directory-downloads directory-pagination" aria-label="Directory pages">${links.join("")}<details class="directory-page-picker"><summary>Choose a page</summary><ol class="directory-page-list">${pages}</ol></details></nav>`;
}

function directoryPage({ title, heading, lede, canonicalPath, items, page, totalPages, browseMarkup = "", breadcrumbItems = [] }) {
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  const pageTitle = page > 1 ? `${title} — Page ${page}` : title;
  const pageDescription = page > 1 ? `${lede} Page ${page} of ${totalPages}.` : lede;
  const itemList = items.slice(0, 50).map((resource, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `${SITE_ORIGIN}/service/${encodeURIComponent(resource.id)}`,
    name: resource.name
  }));
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: pageTitle,
        description: pageDescription,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        about: { "@id": `${SITE_ORIGIN}/#organization` },
        mainEntity: { "@id": `${canonical}#list` }
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#list`,
        numberOfItems: items.length,
        itemListElement: itemList
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
          ...breadcrumbItems.map((item, index) => ({ "@type": "ListItem", position: index + 2, name: item.label, ...(item.href ? { item: `${SITE_ORIGIN}${item.href}` } : {}) }))
        ]
      }
    ]
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(pageDescription)}" />
    <meta name="theme-color" content="#071926" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" type="application/json" href="/data/resources.json" title="RWN resource data" />
    <link rel="alternate" type="text/csv" href="/directory.csv" title="RWN resource directory CSV" />
    <link rel="stylesheet" href="/legal.css" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Real World Needs" />
    <meta property="og:title" content="${escapeHtml(pageTitle)} | Real World Needs" />
    <meta property="og:description" content="${escapeHtml(pageDescription)}" />
    <meta property="og:url" content="${canonical}" />
    ${jsonLd(schema)}
    <title>${escapeHtml(pageTitle)} | Real World Needs</title>
  </head>
  <body>
    <a class="skip-link" href="#directory">Skip to directory</a>
    <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="/accessibility">Accessibility</a></nav></header>
    <main id="directory">
      <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Text directory</p><h1>${escapeHtml(heading)}</h1><p class="legal-hero__lede">${escapeHtml(pageDescription)}</p></div></section>
      <div class="directory-shell">
        ${canonicalPath === "/directory" ? "" : breadcrumbs(breadcrumbItems)}
        <div class="policy-note"><p><strong>Services can change.</strong> Check the original source or contact the organization before you travel. RWN shows where information came from and when it was last reviewed.</p></div>
        <div class="directory-page-tools"><nav aria-label="Directory shortcuts"><a class="directory-results-jump" href="#directory-results">View listings <span aria-hidden="true">↓</span></a><a href="#directory-browse">Browse &amp; downloads</a></nav>${pagination(canonicalPath.replace(/\/page\/\d+$/, ""), page, totalPages)}</div>
        <span class="directory-results-anchor" id="directory-results" tabindex="-1"></span><div class="directory-records">${items.map(resourceRecord).join("\n")}</div>
        ${pagination(canonicalPath.replace(/\/page\/\d+$/, ""), page, totalPages)}
        <div class="directory-browse-tools" id="directory-browse" tabindex="-1">
          <div class="directory-downloads"><strong>Directory tools</strong><a href="/directory.csv" download>Download CSV</a><a href="/data/resources.json">Full JSON</a><a href="/data/map-index.json">Compact map index</a><a href="/data/sources.json">Data sources</a></div>
          ${browseMarkup}
        </div>
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

function resourceSchema(resource, canonical) {
  const place = formatResourcePlace(resource);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: `${resource.name} — ${place}`,
        description: resourceDescription(resource),
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        about: { "@id": `${canonical}#service` },
        dateModified: resource.lastChecked
      },
      {
        "@type": "Service",
        "@id": `${canonical}#service`,
        name: resource.name,
        description: resourceDescription(resource),
        serviceType: aidLabels(resource),
        areaServed: isContactOnly(resource) ? resource.coverageNote : resource.country,
        ...(isContactOnly(resource) ? {
          availableChannel: {
            "@type": "ServiceChannel",
            ...(resource.accessUrl ? { serviceUrl: resource.accessUrl } : {}),
            ...(resource.phone ? { servicePhone: { "@type": "ContactPoint", telephone: resource.phone, description: resource.phoneAccess } } : {})
          }
        } : {}),
        url: canonical,
        sameAs: resource.sourceUrl,
        provider: { "@type": "Organization", name: resource.sourceName, url: resource.sourceUrl }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Directory", item: `${SITE_ORIGIN}/directory` },
          { "@type": "ListItem", position: 3, name: resource.name }
        ]
      }
    ]
  };
}

function resourcePage(resource) {
  const canonicalPath = `/service/${resource.id}`;
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  const place = formatResourcePlace(resource);
  const coordinate = `${resource.lat},${resource.lng}`;
  const contactOnly = isContactOnly(resource);
  const direct = resource.kind === "direct";
  const phone = `<div><dt>Phone</dt><dd>${resource.phone ? phoneMarkup(resource.phone) : "Not listed in this snapshot. Check the official source for contact details."}</dd></div>`;
  const mapLinks = direct && hasMapCoordinates(resource) ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(resource.name)}&amp;ll=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Apple Maps</a><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Google Maps</a>` : "";
  const globeLink = hasMapCoordinates(resource) ? `<a href="/#resource=${encodeURIComponent(resource.id)}">Show on interactive globe</a>` : "";
  const accessLink = contactOnly && resource.accessUrl ? `<a href="${escapeHtml(resource.accessUrl)}" rel="noopener noreferrer">Get help online</a>` : "";
  const categoryLinks = aidTypes(resource).map((type) => `<a href="/directory/help/${slugify(type)}">${escapeHtml(categories[type]?.label || type)}</a>`).join("");
  const title = `${resource.name} — ${place}`;
  const description = resourceDescription(resource, `${resource.summary} ${freeAccessLabel(resource)}. Source checked ${resource.lastChecked}.`);

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
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Real World Needs" />
  <meta property="og:title" content="${escapeHtml(title)} | Real World Needs" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  ${jsonLd(resourceSchema(resource, canonical))}
  <title>${escapeHtml(title)} | Real World Needs</title>
</head>
<body>
  <a class="skip-link" href="#service">Skip to service details</a>
  <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a></nav></header>
  <main id="service" data-service-id="${escapeHtml(resource.id)}"${contactOnly ? ' data-location-precision="contact-only"' : ""}>
    <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">${escapeHtml(kindLabel(resource))}</p><h1>${escapeHtml(resource.name)}</h1><p class="legal-hero__lede">${escapeHtml(resource.summary)}</p><div class="legal-meta"><span>${escapeHtml(place)}</span><span>${escapeHtml(freeAccessLabel(resource))}</span><span>Source checked ${escapeHtml(resource.lastChecked)}</span></div></div></section>
    <div class="directory-shell">
      ${breadcrumbs([{ href: "/directory", label: "Directory" }, { label: resource.name }])}
      ${sourceClosureMarkup(resource)}
      <div class="policy-note"><p><strong>${contactOnly ? "Before you contact" : "Confirm before you go"}.</strong> ${escapeHtml(contactOnly ? contactOnlyNotice(resource) : availabilityInstructions(resource))}</p></div>
      <article class="directory-record" aria-labelledby="service-details-heading">
        <header><div><p>${escapeHtml(kindLabel(resource))}</p><h2 id="service-details-heading" tabindex="-1">Service details</h2><span>${escapeHtml(place)}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Source checked ${escapeHtml(resource.lastChecked)}</time></header>
        <dl class="service-facts">
          <div><dt>${direct ? "Address" : "Coverage"}</dt><dd>${escapeHtml(resource.address)}</dd></div>
          ${contactOnly ? `<div><dt>Coverage details</dt><dd>${escapeHtml(resource.coverageNote)}</dd></div>` : ""}
          ${phone}
          ${contactOnly && resource.phone ? `<div><dt>Phone dialing scope</dt><dd>${escapeHtml(resource.phoneAccess)}</dd></div>` : ""}
          ${contactOnly && resource.accessUrl ? `<div><dt>Online access</dt><dd>${accessLink}</dd></div>` : ""}
          <div><dt>Access</dt><dd>${escapeHtml(resource.accessType)}</dd></div>
          <div><dt>Cost</dt><dd><strong>${escapeHtml(freeAccessLabel(resource))}.</strong> ${escapeHtml(resource.costNote)}${resource.costModel === "free-navigation" ? `<p class="service-cost-scope">${escapeHtml(freeAccessModels[resource.costModel].description)}</p>` : ""}</dd></div>
          ${resource.hours || direct ? `<div><dt>Hours</dt><dd>${resource.hours ? escapeHtml(resource.hours) : "Not listed in this snapshot. Confirm current hours with the provider before travel."}</dd></div>` : ""}
          ${resource.eligibility ? `<div><dt>Eligibility</dt><dd>${escapeHtml(resource.eligibility)}</dd></div>` : ""}
          <div><dt>Help offered</dt><dd>${escapeHtml(aidLabels(resource).join(", "))}</dd></div>
        </dl>
        <h3>Services offered</h3>
        <ul>${resource.services.map((service) => `<li>${escapeHtml(service)}</li>`).join("")}</ul>
        <h3>Source and review</h3>
        <p class="service-source-review">This date records a review of the linked source, not a confirmation of current service availability.</p>
        <p><strong>${escapeHtml(resource.sourceName)}</strong> · ${escapeHtml(resource.sourceKind)}</p>
        <p>${escapeHtml(resource.sourceDetail)}</p>
        ${!contactOnly && resource.coordinateNote ? `<p class="service-coordinate-note">${escapeHtml(resource.coordinateNote)}</p>` : ""}
        <div class="directory-links"><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Visit original source</a>${mapLinks}${accessLink}${globeLink}</div>
      </article>
      <div class="directory-downloads"><strong>Browse related help</strong>${categoryLinks}<a href="/directory/${slugify(resource.country)}">More in ${escapeHtml(resource.country)}</a></div>
    </div>
  </main>
  <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
</body>
</html>`;
}

const three = createThreeAssets(
  await readFile("node_modules/three/build/three.module.min.js"),
  await readFile("node_modules/three/build/three.core.min.js")
);
const release = await releaseHash(three.release);

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });

let builtIndex = await readFile("dist/index.html", "utf8");
builtIndex = versionThreeReferences(versionIndexAssets(builtIndex, release), three);
await writeFile("dist/index.html", builtIndex);

const builtJsFiles = (await walkFiles("dist/src")).filter((path) => extname(path) === ".js");
for (const path of builtJsFiles) {
  let source = await readFile(path, "utf8");
  if (path.endsWith(join("src", "app.js"))) source = stripClusterCountMarkup(source);
  await writeFile(path, versionThreeReferences(versionModuleImports(source, release), three));
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
const categoryTypes = Object.keys(categories);

const countryLinks = countries.map((country) => {
  const count = resources.filter((resource) => resource.country === country).length;
  return `<a href="/directory/${slugify(country)}">${escapeHtml(country)} (${count})</a>`;
}).join("");
const regionLinks = regions.map((region) => {
  const count = resources.filter((resource) => resource.region === region).length;
  return `<a href="/directory/region/${slugify(region)}">${escapeHtml(region)} (${count})</a>`;
}).join("");
const categoryLinks = categoryTypes.map((type) => {
  const count = resources.filter((resource) => aidTypes(resource).includes(type)).length;
  return `<a href="/directory/help/${slugify(type)}">${escapeHtml(categories[type].label)} (${count})</a>`;
}).join("");
const browseMarkup = `<nav class="directory-downloads" aria-label="Browse directory by need"><strong>Browse by need</strong>${categoryLinks}</nav><nav class="directory-downloads" aria-label="Browse directory by region"><strong>Browse by region</strong>${regionLinks}</nav><nav class="directory-downloads" aria-label="Browse directory by country"><strong>Browse by country</strong>${countryLinks}</nav>`;

const sitemapPaths = ["/", "/directory", "/transparency", "/editorial-policy", "/privacy", "/terms", "/accessibility"];
sitemapPaths.push(...await writePagedDirectory("dist/directory", "/directory", resources, {
  title: "Free Essential Services Directory",
  heading: "Find free essential services without using the globe.",
  lede: "Browse food assistance, shelter, health care, hygiene, clothing, drinking water, and local resource finders. Every listing stays connected to its original source.",
  browseMarkup,
  breadcrumbItems: [{ label: "Directory" }]
}));

for (const type of categoryTypes) {
  const items = resources.filter((resource) => aidTypes(resource).includes(type));
  const slug = slugify(type);
  const category = categories[type];
  sitemapPaths.push(...await writePagedDirectory(join("dist/directory/help", slug), `/directory/help/${slug}`, items, {
    title: `${category.label} Assistance Directory`,
    heading: `Find free ${category.label.toLowerCase()} help.`,
    lede: `${category.description} Browse ${items.length} reviewed listings and go directly to the organization or public source for current details.`,
    browseMarkup: `<div class="directory-downloads"><strong>Browse other needs</strong>${categoryLinks}<a href="/directory">Full directory</a></div>`,
    breadcrumbItems: [{ href: "/directory", label: "Directory" }, { label: category.label }]
  }));
}

for (const region of regions) {
  const items = resources.filter((resource) => resource.region === region);
  const slug = slugify(region);
  sitemapPaths.push(...await writePagedDirectory(join("dist/directory/region", slug), `/directory/region/${slug}`, items, {
    title: `${region} Free Essential Services`,
    heading: `Free essential services in ${region}.`,
    lede: `Browse ${items.length} reviewed Real World Needs listings connected to original sources across ${region}.`,
    browseMarkup: `<div class="directory-downloads"><strong>Browse</strong><a href="/directory">All countries and regions</a>${categoryLinks}</div>`,
    breadcrumbItems: [{ href: "/directory", label: "Directory" }, { label: region }]
  }));
}

const countryManifest = [];
for (const country of countries) {
  const items = resources.filter((resource) => resource.country === country);
  const slug = slugify(country);
  sitemapPaths.push(...await writePagedDirectory(join("dist/directory", slug), `/directory/${slug}`, items, {
    title: `${country} Free Essential Services`,
    heading: `Free essential services in ${country}.`,
    lede: `Browse ${items.length} reviewed Real World Needs listings connected to original sources in ${country}.`,
    browseMarkup: `<div class="directory-downloads"><strong>Browse</strong><a href="/directory">All countries and regions</a>${categoryLinks}</div>`,
    breadcrumbItems: [{ href: "/directory", label: "Directory" }, { label: country }]
  }));
  countryManifest.push({ country, slug, count: items.length, path: `/data/resources/by-country/${slug}.json` });
}

await mkdir("dist/service", { recursive: true });
for (const resource of resources) {
  const outputDirectory = join("dist/service", resource.id);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "index.html"), resourcePage(resource));
  sitemapPaths.push(`/service/${resource.id}`);
}

const csvFields = ["ID", "Name", "Place", "Country", "Latitude", "Longitude", "Type", "Aid", "Access", "Free access model", "Cost details", "Address or coverage", "Hours", "Phone", "Eligibility", "Active from", "Active through", "Dataset", "Reviewed", "Official source"];
const csvRows = resources.map((resource) => [
  resource.id,
  resource.name,
  formatResourcePlace(resource),
  resource.country,
  isContactOnly(resource) ? null : resource.lat,
  isContactOnly(resource) ? null : resource.lng,
  kindLabel(resource).replace("Help finder or referral", "Resource finder"),
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
// Preserve the legacy export shape until reviewed contact-only records are
// present, then publish their access scope without discarding existing fields.
if (hasContactOnlyResources) {
  csvFields.push("Location precision", "Coverage details", "Phone dialing scope", "Online access");
  resources.forEach((resource, index) => csvRows[index].push(
    resource.locationPrecision || "", resource.coverageNote || "", resource.phoneAccess || "", resource.accessUrl || ""
  ));
}
const directoryCsv = [csvFields, ...csvRows].map((row) => row.map(escapeCsv).join(",")).join("\n");
await writeFile("dist/directory.csv", `${directoryCsv}\n`);

await mkdir("dist/data/resources/by-country", { recursive: true });
await mkdir("dist/data/resources/by-category", { recursive: true });
await writeFile("dist/data/resources.json", `${JSON.stringify({
  schemaVersion: "1.4",
  license: "Public service facts with source attribution; see https://www.realworldneeds.org/editorial-policy",
  resourceCount: resources.length,
  resources
}, null, 2)}\n`);
await writeFile("dist/data/map-index.json", `${JSON.stringify({
  schemaVersion: "1.0",
  resourceCount: mapResources.length,
  fields: ["id", "lat", "lng", "category", "kind", "country", "region"],
  resources: mapResources.map(({ id, lat, lng, category, kind, country, region }) => ({ id, lat, lng, category, kind, country, region }))
})}\n`);
await writeFile("dist/data/resources/index.json", `${JSON.stringify({
  schemaVersion: "1.1",
  resourceCount: resources.length,
  countries: countryManifest,
  categories: categoryTypes.map((type) => ({ type, label: categories[type].label, count: resources.filter((resource) => aidTypes(resource).includes(type)).length, path: `/data/resources/by-category/${slugify(type)}.json` }))
}, null, 2)}\n`);
for (const entry of countryManifest) {
  const items = resources.filter((resource) => resource.country === entry.country);
  await writeFile(`dist${entry.path}`, `${JSON.stringify({ schemaVersion: "1.0", country: entry.country, resourceCount: items.length, resources: items })}\n`);
}
for (const type of categoryTypes) {
  const items = resources.filter((resource) => aidTypes(resource).includes(type));
  await writeFile(`dist/data/resources/by-category/${slugify(type)}.json`, `${JSON.stringify({ schemaVersion: "1.0", category: type, label: categories[type].label, resourceCount: items.length, resources: items })}\n`);
}
await writeFile("dist/data/sources.json", `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  note: "Counts show records available on the review date, not the number of people helped. The finder loads only nearby current records from live sources.",
  sources: sourceRegistry
}, null, 2)}\n`);
await writeFile("dist/data/release.json", `${JSON.stringify({ release, vendorRelease: three.release, resourceCount: resources.length, directoryPageSize: DIRECTORY_PAGE_SIZE, generatedAt: new Date().toISOString() })}\n`);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(sitemapPaths)].map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc><lastmod>${latestReview}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await writeFile("dist/sitemap.xml", sitemap);

await mkdir("dist/vendor", { recursive: true });
await writeFile(`dist/vendor/${three.moduleName}`, three.moduleSource);
await writeFile(`dist/vendor/${three.coreName}`, three.coreSource);
// Keep the currently public URLs usable for an older cached app during rollout.
// The module alias points at its own hashed core, keeping fresh alias loads paired.
await writeFile("dist/vendor/three.module.js", three.moduleSource);
await writeFile("dist/vendor/three.core.min.js", three.coreSource);
