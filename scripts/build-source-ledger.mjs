import { mkdir, readFile, writeFile } from "node:fs/promises";
import { categories, resources } from "../src/data/resources.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { sourceCheckRange } from "./source-check-range.mjs";

const SITE_ORIGIN = "https://www.realworldneeds.org";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const latest = (values) => values.filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 10);
const registeredIds = new Set(sourceRegistry.map((source) => source.id));
const structuredLatest = latest(sourceRegistry.flatMap((source) => [source.auditedAt, source.sourceUpdatedAt]));
const directoryLatest = latest(resources.map((resource) => resource.lastChecked));
const pageLastmod = [structuredLatest, directoryLatest].sort().at(-1);

const modeLabel = (mode) => ({
  "live-nearby-query": "Live official query",
  "reviewed-snapshot": "Reviewed official snapshot",
  "reviewed-open-data-snapshot": "Reviewed open-data snapshot",
  "reviewed-official-network-snapshot": "Reviewed official-network snapshot"
}[mode] || String(mode || "Reviewed source").replaceAll("-", " "));

const sourceRecordCount = (source) => resources.filter((resource) => resource.datasetId === source.id).length;

function metric(label, value) {
  return `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function fieldRow(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(Array.isArray(value) ? value.join(", ") : value)}</dd></div>`;
}

function structuredCard(source) {
  const published = sourceRecordCount(source);
  const auditCount = source.activeRecordsAtAudit || source.recordCount || 0;
  const countLabel = source.mode === "live-nearby-query"
    ? `${Number(source.activeRecordsAtAudit || 0).toLocaleString()} active records at audit; loaded live only after a location search`
    : `${published.toLocaleString()} records currently published by RWN${source.recordCount && source.recordCount !== published ? ` · registry snapshot count ${Number(source.recordCount).toLocaleString()}` : ""}`;

  return `<article class="directory-record source-ledger-card">
    <header><div><p>${escapeHtml(modeLabel(source.mode))}</p><h2>${escapeHtml(source.title)}</h2><span>${escapeHtml(source.owner)}</span></div><time datetime="${escapeHtml(source.auditedAt || source.sourceUpdatedAt || pageLastmod)}">Audited ${escapeHtml(source.auditedAt || source.sourceUpdatedAt || pageLastmod)}</time></header>
    <p>${escapeHtml(countLabel)}</p>
    <dl>
      ${fieldRow("Refresh model", source.updateFrequency)}
      ${fieldRow("Publication standard", source.accessStandard)}
      ${fieldRow("Source updated", source.sourceUpdatedAt)}
      ${fieldRow("Fields used", source.fields)}
      ${fieldRow("Location privacy", source.locationPrivacy)}
      ${fieldRow("Reuse basis", source.reuseBasis)}
      ${source.sourceReportedRecordsAtAudit ? fieldRow("Source records at audit", Number(source.sourceReportedRecordsAtAudit).toLocaleString()) : ""}
      ${source.sourceParsedRecordsAtAudit ? fieldRow("Parsed at audit", Number(source.sourceParsedRecordsAtAudit).toLocaleString()) : ""}
      ${source.excludedForPublicationAtAudit ? fieldRow("Excluded by RWN checks", Number(source.excludedForPublicationAtAudit).toLocaleString()) : ""}
      ${auditCount && source.mode !== "live-nearby-query" ? fieldRow("Registry record count", Number(auditCount).toLocaleString()) : ""}
    </dl>
    <div class="directory-links"><a href="${escapeHtml(source.sourceUrl)}" rel="noopener noreferrer">Open original publisher</a>${source.dataUrl ? `<a href="${escapeHtml(source.dataUrl)}" rel="noopener noreferrer">Open public data endpoint</a>` : ""}</div>
  </article>`;
}

const recordGroups = new Map();
for (const resource of resources) {
  if (resource.datasetId && registeredIds.has(resource.datasetId)) continue;
  const key = resource.sourceName || "Original source";
  const group = recordGroups.get(key) || {
    name: key,
    kind: resource.sourceKind || "Reviewed original source",
    sourceUrl: resource.sourceUrl,
    sourceDetail: resource.sourceDetail || "",
    count: 0,
    dates: [],
    categories: new Set()
  };
  group.count += 1;
  group.dates.push(resource.lastChecked);
  group.categories.add(categories[resource.category]?.label || resource.category);
  if (!group.sourceUrl && resource.sourceUrl) group.sourceUrl = resource.sourceUrl;
  recordGroups.set(key, group);
}

const otherSources = [...recordGroups.values()]
  .map((group) => ({ ...group, lastChecked: latest(group.dates), categories: [...group.categories].sort() }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

function recordSourceCard(group) {
  return `<article class="directory-record source-ledger-card">
    <header><div><p>Record-level original source</p><h2>${escapeHtml(group.name)}</h2><span>${escapeHtml(group.kind)}</span></div><span class="source-check-range">Source checks ${escapeHtml(sourceCheckRange(group.dates))}</span></header>
    <p>${escapeHtml(group.sourceDetail || "RWN reviews the cited public source at the record level and keeps the original source connected to each published listing.")}</p>
    <dl>${fieldRow("RWN records", group.count.toLocaleString())}${fieldRow("Help represented", group.categories)}</dl>
    ${group.sourceUrl ? `<div class="directory-links"><a href="${escapeHtml(group.sourceUrl)}" rel="noopener noreferrer">Open original source</a></div>` : ""}
  </article>`;
}

const itemList = [
  ...sourceRegistry.map((source) => ({ name: source.title, url: source.sourceUrl })),
  ...otherSources.map((source) => ({ name: source.name, url: source.sourceUrl })).filter((source) => source.url)
].slice(0, 100).map((source, index) => ({
  "@type": "ListItem",
  position: index + 1,
  name: source.name,
  url: source.url
}));

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_ORIGIN}/sources#page`,
      url: `${SITE_ORIGIN}/sources`,
      name: "Data Sources & Provenance | Real World Needs",
      description: "Human-readable provenance ledger for the public source feeds, snapshots, and original sources represented in the Real World Needs essential-services directory.",
      isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
      about: { "@id": `${SITE_ORIGIN}/data/resources.json#dataset` },
      mainEntity: { "@id": `${SITE_ORIGIN}/sources#list` }
    },
    {
      "@type": "ItemList",
      "@id": `${SITE_ORIGIN}/sources#list`,
      numberOfItems: sourceRegistry.length + otherSources.length,
      itemListElement: itemList
    }
  ]
};

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Inspect the public source feeds, reviewed snapshots, original publishers, audit dates, and provenance rules behind the Real World Needs essential-services directory." />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta name="theme-color" content="#071926" />
  <link rel="canonical" href="${SITE_ORIGIN}/sources" />
  <link rel="stylesheet" href="/legal.css" />
  <link rel="stylesheet" href="/directory-enhancements.css" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Real World Needs" />
  <meta property="og:title" content="Data Sources & Provenance | Real World Needs" />
  <meta property="og:description" content="See where RWN directory records come from, how structured source snapshots are refreshed, and when source families were audited." />
  <meta property="og:url" content="${SITE_ORIGIN}/sources" />
  <script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>
  <title>Data Sources &amp; Provenance | Real World Needs</title>
</head>
<body>
  <a class="skip-link" href="#content">Skip to source ledger</a>
  <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Source navigation"><a class="home-link" href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a aria-current="page" href="/sources">Sources</a><a href="/editorial-policy">How listings are checked</a></nav></header>
  <main id="content">
    <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Source ledger</p><h1>See where RWN’s directory information comes from.</h1><p class="legal-hero__lede">Structured public feeds, reviewed snapshots, and record-level original sources stay attributable. This page describes what RWN actually uses and how it was checked; inclusion does not imply sponsorship, endorsement, or a partnership with RWN.</p><div class="legal-meta"><span>${sourceRegistry.length} structured source families</span><span>${otherSources.length} additional original-source groups</span><span>${resources.length.toLocaleString()} reviewed directory records</span><span>Listing source checks ${escapeHtml(sourceCheckRange(resources.map(resource => resource.lastChecked)))}</span></div></div></section>
    <div class="directory-shell">
      <nav class="directory-downloads" aria-label="Breadcrumb"><a href="/">Home</a><a href="/transparency">Transparency</a><span aria-current="page">Sources</span></nav>
      <div class="transparency-metrics">${metric("structured feeds and snapshots", sourceRegistry.length)}${metric("additional original-source groups", otherSources.length)}${metric("reviewed directory records", resources.length.toLocaleString())}</div>
      <div class="policy-note"><p><strong>What these labels mean:</strong> a structured source family has a documented refresh/audit model in RWN’s registry. “Record-level original source” means the listing keeps a cited publisher or provider source but is not represented as one of RWN’s structured feed/snapshot pipelines. Neither label means the source organization endorses or partners with RWN.</p></div>
      <p class="source-review-note">Source checks record when RWN reviewed the linked information. Individual listing dates can differ. Audit dates and publisher updates describe the source data; they do not confirm current service availability.</p>
      <section aria-labelledby="structured-sources"><h2 id="structured-sources">Structured feeds and reviewed snapshots</h2><div class="directory-records">${sourceRegistry.map(structuredCard).join("")}</div></section>
      <section aria-labelledby="record-sources"><h2 id="record-sources">Other original-source groups</h2><p>These records are still source-connected and reviewed under the same publication rules, but they are not represented as a single automated or snapshot data pipeline.</p><div class="directory-records">${otherSources.map(recordSourceCard).join("")}</div></section>
      <div class="open-data-actions"><a href="/transparency">Transparency Center</a><a href="/editorial-policy">Review standard</a><a href="/data/sources.json">Machine-readable source registry</a><a href="/data/resources.json">Full resource JSON</a></div>
    </div>
  </main>
  <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/transparency">Transparency</a><a href="/sources">Sources</a><a href="/privacy">Privacy</a><a href="/accessibility">Accessibility</a></nav></footer>
</body>
</html>`;

await mkdir("dist/sources", { recursive: true });
await writeFile("dist/sources/index.html", html);

const transparencyPath = "dist/transparency.html";
let transparency = await readFile(transparencyPath, "utf8");
if (!transparency.includes('href="/sources"')) {
  transparency = transparency
    .replace(
      '<a href="/data/sources.json">View data sources</a>',
      '<a href="/sources">Browse source ledger</a><a href="/data/sources.json">Raw source registry</a>'
    )
    .replace(
      '<a href="/data/sources.json">Source registry</a>',
      '<a href="/sources">Human source ledger</a><a href="/data/sources.json">Source registry JSON</a>'
    )
    .replace(
      '<a href="/privacy">Privacy</a>',
      '<a href="/sources">Sources</a><a href="/privacy">Privacy</a>'
    );
  await writeFile(transparencyPath, transparency);
}

const sitemapPath = "dist/sitemap.xml";
let sitemap = await readFile(sitemapPath, "utf8");
if (!sitemap.includes(`<loc>${SITE_ORIGIN}/sources</loc>`)) {
  sitemap = sitemap.replace("</urlset>", `<url><loc>${SITE_ORIGIN}/sources</loc><lastmod>${pageLastmod}</lastmod></url></urlset>`);
  await writeFile(sitemapPath, sitemap);
}

const releasePath = "dist/data/release.json";
const release = JSON.parse(await readFile(releasePath, "utf8"));
release.sourceLedger = {
  structuredSourceFamilies: sourceRegistry.length,
  originalSourceGroups: otherSources.length,
  totalSourceGroups: sourceRegistry.length + otherSources.length,
  lastmod: pageLastmod
};
await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
