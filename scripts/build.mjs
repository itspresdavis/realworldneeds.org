import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const kindLabel = (resource) => resource.kind === "direct"
  ? "Direct service site"
  : resource.kind === "locator" ? "Official locator" : "Partner network";
const aidLabels = (resource) => [resource.category, ...(resource.secondaryCategories || [])]
  .map((type) => categories[type].label);
const directCount = resources.filter((resource) => resource.kind === "direct").length;
const coverageCount = new Set(resources.map((resource) => resource.country)).size;
const latestReview = [...resources].sort((a, b) => b.lastChecked.localeCompare(a.lastChecked))[0]?.lastChecked || "";

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
    <header><div><p>${escapeHtml(kindLabel(resource))}</p><h2>${escapeHtml(resource.name)}</h2><span>${escapeHtml(place)}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Reviewed ${escapeHtml(resource.lastChecked)}</time></header>
    <p>${escapeHtml(resource.summary)}</p>
    <ul class="directory-aid" aria-label="Aid categories">${aidLabels(resource).map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
    <dl><div><dt>Access</dt><dd>${escapeHtml(resource.accessType)}</dd></div><div><dt>Cost</dt><dd>${escapeHtml(resource.costNote)}</dd></div><div><dt>${resource.kind === "direct" ? "Address" : "Coverage"}</dt><dd>${escapeHtml(resource.address)}</dd></div>${resource.hours ? `<div><dt>Hours</dt><dd>${escapeHtml(resource.hours)}</dd></div>` : ""}${phone}</dl>
    <p class="directory-caution"><strong>Confirm before travel.</strong> ${escapeHtml(resource.availabilityNote)}</p>
    <div class="directory-links"><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Official source</a>${maps}<a href="/#resource=${encodeURIComponent(resource.id)}">Open on interactive globe</a></div>
  </article>`;
}

const directoryHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Complete text-only Real World Needs directory of source-backed essential services." />
    <meta name="theme-color" content="#071926" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://www.realworldneeds.org/directory" />
    <link rel="alternate" type="application/json" href="/data/resources.json" title="RWN resource data" />
    <link rel="alternate" type="text/csv" href="/directory.csv" title="RWN resource directory CSV" />
    <link rel="stylesheet" href="/legal.css" />
    <title>Text Directory | Real World Needs</title>
  </head>
  <body>
    <a class="skip-link" href="#directory">Skip to directory</a>
    <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Humanitarian service directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Interactive finder</a><a href="/transparency">Transparency</a><a href="/editorial-policy">Editorial policy</a><a href="/accessibility">Accessibility</a></nav></header>
    <main id="directory">
      <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Resilient text directory</p><h1>Every listing, without the globe.</h1><p class="legal-hero__lede">A complete, lightweight route to the same source-backed services. It works without the interactive application and keeps official sources, practical access details, review dates, and map links visible.</p><div class="legal-meta"><span>${resources.length} records</span><span>${directCount} physical service sites</span><span>${coverageCount} countries and global networks</span><span>Latest source review ${escapeHtml(latestReview)}</span></div></div></section>
      <div class="directory-shell">
        <div class="policy-note"><p><strong>Availability can change.</strong> Contact the provider or check the official source before travelling. RWN is not emergency dispatch and does not decide eligibility.</p></div>
        <div class="directory-downloads"><strong>Open data</strong><a href="/directory.csv" download>Download CSV</a><a href="/data/resources.json">View JSON</a><a href="/editorial-policy">Read the data standard</a></div>
        <div class="directory-records">${resources.map(resourceRecord).join("\n")}</div>
      </div>
    </main>
    <footer class="legal-footer"><p>Real World Needs · Public humanitarian service directory</p><nav aria-label="Footer policies"><a href="/">Interactive finder</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
  </body>
</html>`;

const csvFields = ["ID", "Name", "Place", "Country", "Latitude", "Longitude", "Type", "Aid", "Access", "Cost", "Address or coverage", "Hours", "Phone", "Reviewed", "Official source"];
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
  resource.costNote,
  resource.address,
  resource.hours || "",
  resource.phone || "",
  resource.lastChecked,
  resource.sourceUrl
]);
const directoryCsv = [csvFields, ...csvRows].map((row) => row.map(escapeCsv).join(",")).join("\n");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });

const transparencyTemplate = await readFile("public/transparency.html", "utf8");
const transparencyHtml = transparencyTemplate
  .replaceAll("{{RESOURCE_COUNT}}", String(resources.length))
  .replaceAll("{{DIRECT_COUNT}}", String(directCount))
  .replaceAll("{{COVERAGE_COUNT}}", String(coverageCount))
  .replaceAll("{{LATEST_REVIEW}}", latestReview);

await writeFile("dist/transparency.html", transparencyHtml);
await writeFile("dist/directory.html", directoryHtml);
await writeFile("dist/directory.csv", `${directoryCsv}\n`);
await writeFile("dist/data/resources.json", `${JSON.stringify({
  schemaVersion: "1.0",
  license: "Public service facts with source attribution; see https://www.realworldneeds.org/editorial-policy",
  resourceCount: resources.length,
  resources
}, null, 2)}\n`);

await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/three/build/three.module.min.js", "dist/vendor/three.module.js");
await cp("node_modules/three/build/three.core.min.js", "dist/vendor/three.core.min.js");
