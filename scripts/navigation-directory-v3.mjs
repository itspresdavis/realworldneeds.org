import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { categories, resources } from "../src/data/resources.js";
import { freeAccessLabel } from "../src/data/free-access.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const SITE_ORIGIN = "https://www.realworldneeds.org";
const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const aidTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];
const aidLabels = (resource) => aidTypes(resource).map((type) => categories[type]?.label || type);
const kindLabel = (resource) => resource.kind === "direct"
  ? "Service location"
  : resource.kind === "locator" ? "Resource finder" : "Service network";

function appleDirections(resource) {
  const coordinate = `${resource.lat},${resource.lng}`;
  return `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(resource.name)}`;
}

function googleDirections(resource) {
  const coordinate = `${resource.lat},${resource.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`;
}

function phoneHref(resource) {
  return resource.phone ? `tel:${resource.phone.replace(/[^+\d]/g, "")}` : "";
}

function canonicalPath(html, filePath) {
  const fromCanonical = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.realworldneeds\.org([^"#?]*)/i)?.[1];
  if (fromCanonical) return fromCanonical || "/";
  const local = relative("dist", filePath).split(sep).join("/");
  if (local === "index.html") return "/";
  return `/${local.replace(/\/index\.html$/, "").replace(/\.html$/, "")}`;
}

function navCurrent(path, href) {
  if (href === "/") return path === "/";
  if (href === "/directory") return path.startsWith("/directory") || path.startsWith("/service/");
  return path === href || path.startsWith(`${href}/`);
}

function mainNav(path, mobile = false) {
  const items = mobile
    ? [
        ["Find help", "/"],
        ["Browse directory", "/directory"],
        ["How listings are checked", "/editorial-policy"],
        ["Transparency", "/transparency"]
      ]
    : [
        ["Find help", "/"],
        ["How listings are checked", "/editorial-policy"],
        ["Transparency", "/transparency"]
      ];
  return items.map(([label, href]) => `<a href="${href}"${navCurrent(path, href) ? ' aria-current="page"' : ""}>${label}</a>`).join("");
}

function normalizeHeader(html, path) {
  const pattern = /<header class="legal-header(?:[^"]*)">[\s\S]*?<\/header>/i;
  const current = html.match(pattern)?.[0];
  if (!current) return html;
  const brand = current.match(/<a class="legal-brand"[\s\S]*?<\/a>/i)?.[0];
  if (!brand) return html;
  const directoryCurrent = navCurrent(path, "/directory") ? ' aria-current="page"' : "";
  const replacement = `<header class="legal-header rwn-unified-header">
      ${brand}
      <nav class="rwn-primary-nav" aria-label="Main navigation">${mainNav(path)}</nav>
      <a class="rwn-header-action" href="/directory"${directoryCurrent}>Browse directory</a>
      <details class="rwn-site-menu">
        <summary>Menu</summary>
        <nav aria-label="Mobile navigation">${mainNav(path, true)}</nav>
      </details>
    </header>`;
  return html.replace(pattern, replacement);
}

function normalizeFooter(html) {
  const pattern = /<footer class="legal-footer">[\s\S]*?<\/footer>/i;
  if (!pattern.test(html)) return html;
  return html.replace(pattern, `<footer class="legal-footer">
      <p>Real World Needs · Essential services directory</p>
      <nav aria-label="Footer navigation">
        <a href="/">Find help</a>
        <a href="/directory">Directory</a>
        <a href="/editorial-policy">How listings are checked</a>
        <a href="/sources">Sources</a>
        <a href="/transparency">Transparency</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/accessibility">Accessibility</a>
      </nav>
    </footer>`);
}

function directoryRecord(resource) {
  const place = formatResourcePlace(resource);
  const direct = resource.kind === "direct";
  const phone = resource.phone
    ? `<div><dt>Phone</dt><dd><a href="${escapeHtml(phoneHref(resource))}">${escapeHtml(resource.phone)}</a></dd></div>`
    : "";
  const callAction = resource.phone
    ? `<a class="is-call" href="${escapeHtml(phoneHref(resource))}"><strong>Call</strong><span>${escapeHtml(resource.phone)}</span></a>`
    : "";
  const directions = direct
    ? `<a class="is-direction" href="${escapeHtml(appleDirections(resource))}" rel="noopener noreferrer"><strong>Apple Maps</strong><span>Get directions</span></a>
       <a class="is-direction" href="${escapeHtml(googleDirections(resource))}" rel="noopener noreferrer"><strong>Google Maps</strong><span>Get directions</span></a>`
    : "";
  const providerAction = !direct
    ? `<a class="is-direction" href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer"><strong>Find a local service</strong><span>Official provider</span></a>`
    : "";

  return `<article class="directory-record" id="${escapeHtml(resource.id)}">
    <header><div><p>${escapeHtml(kindLabel(resource))}</p><h2><a href="/service/${encodeURIComponent(resource.id)}">${escapeHtml(resource.name)}</a></h2><span>${escapeHtml(place)}</span></div><time datetime="${escapeHtml(resource.lastChecked)}">Checked ${escapeHtml(resource.lastChecked)}</time></header>
    <nav class="directory-quick-actions" aria-label="Actions for ${escapeHtml(resource.name)}">
      ${callAction}${directions}${providerAction}
      <a class="is-details" href="/service/${encodeURIComponent(resource.id)}"><strong>View details</strong><span>Hours, eligibility and source</span></a>
    </nav>
    <p>${escapeHtml(resource.summary)}</p>
    <ul class="directory-aid" aria-label="Types of help">${aidLabels(resource).map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
    <dl><div><dt>Access</dt><dd>${escapeHtml(resource.accessType)}</dd></div><div><dt>Cost</dt><dd><strong>${escapeHtml(freeAccessLabel(resource))}.</strong> ${escapeHtml(resource.costNote)}</dd></div><div><dt>${direct ? "Address" : "Coverage"}</dt><dd>${escapeHtml(resource.address)}</dd></div>${resource.hours ? `<div><dt>Hours</dt><dd>${escapeHtml(resource.hours)}</dd></div>` : ""}${phone}</dl>
    <p class="directory-caution"><strong>Confirm before you go.</strong> ${escapeHtml(resource.availabilityNote)}</p>
    <div class="directory-more-links"><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Official source</a><a href="/#resource=${encodeURIComponent(resource.id)}">Show on RWN map</a></div>
  </article>`;
}

function serviceNextSteps(resource) {
  const direct = resource.kind === "direct";
  const actions = [];
  if (resource.phone) actions.push(`<a class="is-primary" href="${escapeHtml(phoneHref(resource))}"><strong>Call</strong><span>${escapeHtml(resource.phone)}</span></a>`);
  if (direct) {
    actions.push(`<a href="${escapeHtml(appleDirections(resource))}" rel="noopener noreferrer"><strong>Apple Maps</strong><span>Get directions</span></a>`);
    actions.push(`<a href="${escapeHtml(googleDirections(resource))}" rel="noopener noreferrer"><strong>Google Maps</strong><span>Get directions</span></a>`);
  }
  actions.push(`<a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer"><strong>${direct ? "Official website" : "Find a local service"}</strong><span>Check current provider information</span></a>`);
  actions.push(`<a href="/#resource=${encodeURIComponent(resource.id)}"><strong>RWN map</strong><span>Show this listing on the globe</span></a>`);
  return `<nav class="service-next-steps service-next-steps--v3" aria-label="Contact and directions for this service">
    <div><span>Contact and directions</span><strong>Choose what you want to do.</strong>${direct ? "<small>Use Apple Maps or Google Maps for directions.</small>" : ""}</div>
    <div>${actions.join("")}</div>
  </nav>`;
}

function enhanceDirectoryPage(html, path) {
  html = html.replace(/<article class="directory-record" id="([^"]+)">[\s\S]*?<\/article>/g, (match, id) => {
    const resource = resourceById.get(id);
    return resource ? directoryRecord(resource) : match;
  });

  html = html.replace(
    /<div class="directory-downloads"><strong>Directory tools<\/strong>([\s\S]*?)<\/div>/i,
    `<details class="directory-data-tools"><summary>Downloads and directory data</summary><div class="directory-downloads">$1</div></details>`
  );

  html = html.replace(
    /(<nav class="directory-downloads" aria-label="Browse directory by need">[\s\S]*?<\/nav>\s*<nav class="directory-downloads" aria-label="Browse directory by region">[\s\S]*?<\/nav>\s*<nav class="directory-downloads" aria-label="Browse directory by country">[\s\S]*?<\/nav>)/i,
    `<details class="directory-browse"><summary>Browse by need or place</summary><div>$1</div></details>`
  );

  if (path === "/directory") {
    html = html
      .replace(/<p class="eyebrow">[^<]*<\/p>/i, '<p class="eyebrow">Directory</p>')
      .replace(/<h1>[^<]*<\/h1>/i, '<h1>Find a service.</h1>')
      .replace(/<p class="legal-hero__lede">[\s\S]*?<\/p>/i, '<p class="legal-hero__lede">Search by service, place, or organization. Call a provider, choose Apple Maps or Google Maps for directions, or open the full listing for more details.</p>');
  }
  return html;
}

function enhanceServicePage(html, path) {
  const id = decodeURIComponent(path.replace(/^\/service\//, "").replace(/\/$/, ""));
  const resource = resourceById.get(id);
  if (!resource) return html;
  html = html.replace(/<nav class="service-next-steps[^"]*"[\s\S]*?<\/nav>/i, serviceNextSteps(resource));
  html = html.replace(
    /<div class="directory-links">[\s\S]*?<\/div>/i,
    `<div class="directory-more-links"><a href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer">Official source</a><a href="/#resource=${encodeURIComponent(resource.id)}">Show on RWN map</a></div>`
  );
  return html;
}

async function walkHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkHtml(path));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

const releaseInfo = JSON.parse(await readFile("dist/data/release.json", "utf8"));
const release = releaseInfo.release;
if (!/^[a-f0-9]{12}$/.test(release)) throw new Error("Navigation v3 requires a valid release hash.");

for (const filePath of await walkHtml("dist")) {
  let html = await readFile(filePath, "utf8");
  const path = canonicalPath(html, filePath);
  if (!html.includes("/navigation-directory.css")) {
    html = html.replace("</head>", `  <link rel="stylesheet" href="/navigation-directory.css?v=${release}" />\n</head>`);
  }
  html = normalizeHeader(html, path);
  html = normalizeFooter(html);
  if (path.startsWith("/directory")) html = enhanceDirectoryPage(html, path);
  if (path.startsWith("/service/")) html = enhanceServicePage(html, path);
  await writeFile(filePath, html);
}

releaseInfo.navigationRelease = release;
await writeFile("dist/data/release.json", `${JSON.stringify(releaseInfo, null, 2)}\n`);
