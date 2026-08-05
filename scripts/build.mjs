import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { categories, resources } from "../src/data/resources.js";
import { freeAccessLabel } from "../src/data/free-access.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const kindLabel = (resource) => resource.kind === "direct"
  ? "Service location"
  : resource.kind === "locator" ? "Resource finder" : "Service network";
const aidLabels = (resource) => [resource.category, ...(resource.secondaryCategories || [])]
  .map((type) => categories[type].label);
const directCount = resources.filter((resource) => resource.kind === "direct").length;
const coverageCount = new Set(resources.map((resource) => resource.country)).size;
const latestReview = [...resources].sort((a, b) => b.lastChecked.localeCompare(a.lastChecked))[0]?.lastChecked || "";
const auditedLiveCount = sourceRegistry.reduce((sum, source) => sum + (source.activeRecordsAtAudit || 0), 0);

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

const directoryHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Browse the complete Real World Needs directory of free essential services without using the interactive globe." />
    <meta name="theme-color" content="#071926" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://www.realworldneeds.org/directory" />
    <link rel="alternate" type="application/json" href="/data/resources.json" title="RWN resource data" />
    <link rel="alternate" type="text/csv" href="/directory.csv" title="RWN resource directory CSV" />
    <link rel="stylesheet" href="/legal.css" />
    <title>Service Directory | Real World Needs</title>
  </head>
  <body>
    <a class="skip-link" href="#directory">Skip to directory</a>
    <header class="legal-header"><a class="legal-brand" href="/"><span class="legal-brand__mark">RWN</span><span><strong>Real World Needs</strong><small>Free essential services directory</small></span></a><nav aria-label="Directory navigation"><a class="home-link" href="/">Find help</a><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="/accessibility">Accessibility</a></nav></header>
    <main id="directory">
      <section class="legal-hero"><div class="legal-hero__inner"><p class="eyebrow">Text directory</p><h1>Find services without using the globe.</h1><p class="legal-hero__lede">Browse every listing in a simple text format. Cost, eligibility, contact details, and the original source are included.</p><div class="legal-meta"><span>${resources.length} listings checked</span><span>${directCount} service locations</span><span>${auditedLiveCount.toLocaleString()} active USDA sites in the latest review</span><span>Sources last checked through ${escapeHtml(latestReview)}</span></div></div></section>
      <div class="directory-shell">
        <div class="policy-note"><p><strong>Services can change.</strong> Check the original source or contact the organization before you travel. Seasonal USDA meal sites are shown only for their published dates and are counted separately from the directory below.</p></div>
        <div class="directory-downloads"><strong>Download the directory</strong><a href="/directory.csv" download>CSV</a><a href="/data/resources.json">JSON</a><a href="/data/sources.json">Data sources</a><a href="/editorial-policy">How listings are checked</a></div>
        <div class="directory-records">${resources.map(resourceRecord).join("\n")}</div>
      </div>
    </main>
    <footer class="legal-footer"><p>Real World Needs · Free essential services directory</p><nav aria-label="Footer policies"><a href="/">Find help</a><a href="/transparency">Transparency</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav></footer>
  </body>
</html>`;

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
  schemaVersion: "1.2",
  license: "Public service facts with source attribution; see https://www.realworldneeds.org/editorial-policy",
  resourceCount: resources.length,
  resources
}, null, 2)}\n`);
await writeFile("dist/data/sources.json", `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  note: "Counts show records available on the review date, not the number of people helped. The finder loads only nearby current records from live sources.",
  sources: sourceRegistry
}, null, 2)}\n`);

await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/three/build/three.module.min.js", "dist/vendor/three.module.js");
await cp("node_modules/three/build/three.core.min.js", "dist/vendor/three.core.min.js");
