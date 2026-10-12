import { isContactOnly, hasMapCoordinates, contactOnlyNotice } from "../src/utils/resource-location.js";
import { phoneLinks } from "../src/utils/phone.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resources } from "../src/data/resources.js";
import { sourceClosureMarkup, sourceClosureNotice } from "../src/utils/source-status.js";

const HOME_TITLE = "Find Essential Services Near You | Real World Needs";
const HOME_DESCRIPTION = "Search food, shelter, health care, hygiene, clothing, water and other essential services. Review provider contact details, the original source and the date RWN checked each listing.";
const SOCIAL_IMAGE = "https://www.realworldneeds.org/media/earth-blue-marble.jpg";
const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
const CRITICAL_HOME_STYLE = `<style data-rwn-critical-shell>
.directory-strip,.accountability,#openInspector{display:none!important}
.globe-canvas{touch-action:none;overscroll-behavior:contain}
.globe-pin>strong,.globe-cluster>strong{transition:opacity 120ms linear}
.globe-stage.has-gpu-points.is-globe-moving .globe-pin-layer{pointer-events:none}
.globe-stage.has-gpu-points.is-globe-moving .globe-pin>strong,.globe-stage.has-gpu-points.is-globe-moving .globe-cluster>strong{opacity:0}
@media(max-width:900px){.globe-canvas{touch-action:pan-y;overscroll-behavior-y:auto}}
@media(prefers-reduced-motion:reduce){.globe-pin>strong,.globe-cluster>strong{transition:none}}
</style>`;
const CRITICAL_PAGE_STYLE = `<style data-rwn-page-critical>
.directory-category-chips button{min-height:44px!important}
#service>.legal-hero{padding-top:2.6rem!important;padding-bottom:2.2rem!important}
@media(max-width:650px){
  #directory>.legal-hero{padding:1.2rem .9rem 1rem!important}
  #directory>.legal-hero h1{max-width:19ch!important;font-size:clamp(1.85rem,8vw,2.3rem)!important;line-height:1.04!important;letter-spacing:-.04em!important}
  #directory>.legal-hero .legal-hero__lede{margin-top:.55rem!important;font-size:.84rem!important;line-height:1.48!important}
  #directory>.legal-hero .eyebrow{font-size:.62rem!important}
  .directory-shell{padding-top:.7rem!important}
  #service>.legal-hero{padding:1.35rem .9rem 1.15rem!important}
}
</style>`;
const DIRECTORY_HEADING = "Find a service in the directory.";
const DIRECTORY_DESCRIPTION = "Search by service, place, or organization. Listings include contact details, the source, and the date RWN checked it.";

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

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const decodeEntities = (value) => String(value || "")
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");
const escapeAttribute = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const escapeHtml = (value) => escapeAttribute(value).replaceAll("'", "&#39;");

function titleFrom(html) {
  return decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || "Real World Needs");
}

function descriptionFrom(html) {
  const match = html.match(/<meta\b[^>]*\bname=(["'])description\1[^>]*\bcontent=(["'])(.*?)\2[^>]*>/i);
  return decodeEntities(match?.[3]?.trim() || "Find essential services and review the source behind each listing.");
}

function canonicalPathFrom(html) {
  const canonical = html.match(/<link\b[^>]*\brel=(["'])canonical\1[^>]*\bhref=(["'])(.*?)\2[^>]*>/i)?.[3] || "/";
  try {
    return new URL(canonical, "https://www.realworldneeds.org").pathname;
  } catch {
    return "/";
  }
}

function upsertMeta(html, attribute, key, content) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=(["'])${escapeRegex(key)}\\1[^>]*\\bcontent=(["'])(.*?)\\2[^>]*>`, "i");
  const tag = `<meta ${attribute}="${key}" content="${escapeAttribute(content)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace("</head>", `  ${tag}\n</head>`);
}

function ensureHeadLink(html, rel, href, extra = "") {
  if (new RegExp(`<link[^>]+href=["']${escapeRegex(href)}(?:\\?[^"']*)?["']`, "i").test(html)) return html;
  return html.replace("</head>", `  <link rel="${rel}" href="${href}"${extra} />\n</head>`);
}

function ensureVersionedStylesheet(html, href, release) {
  if (new RegExp(`<link[^>]+href=["']${escapeRegex(href)}(?:\\?[^"']*)?["']`, "i").test(html)) return html;
  return html.replace("</head>", `  <link rel="stylesheet" href="${href}?v=${release}" />\n</head>`);
}

function addSocialMetadata(html) {
  const title = titleFrom(html);
  const description = descriptionFrom(html);
  html = upsertMeta(html, "property", "og:title", title);
  html = upsertMeta(html, "property", "og:description", description);
  html = upsertMeta(html, "property", "og:image", SOCIAL_IMAGE);
  html = upsertMeta(html, "property", "og:image:alt", "Real World Needs essential services directory");
  html = upsertMeta(html, "property", "og:locale", "en_US");
  html = upsertMeta(html, "name", "twitter:card", "summary_large_image");
  html = upsertMeta(html, "name", "twitter:title", title);
  html = upsertMeta(html, "name", "twitter:description", description);
  html = upsertMeta(html, "name", "twitter:image", SOCIAL_IMAGE);
  html = upsertMeta(html, "name", "twitter:image:alt", "Real World Needs essential services directory");
  html = upsertMeta(html, "name", "author", "Real World Needs");
  html = upsertMeta(html, "name", "application-name", "Real World Needs");
  return html;
}

function navKey(path) {
  if (path.startsWith("/directory") || path.startsWith("/service/")) return "directory";
  if (path === "/editorial-policy") return "checks";
  if (path === "/sources") return "sources";
  if (path === "/transparency") return "transparency";
  return "find";
}

function navigationLinks(path) {
  const current = navKey(path);
  const links = [
    ["find", "/", "Find help"],
    ["directory", "/directory", "Directory"],
    ["saved", "/directory#saved", "Saved"],
    ["checks", "/editorial-policy", "How listings are checked"],
    ["sources", "/sources", "Sources"],
    ["transparency", "/transparency", "Transparency"]
  ];
  return links.map(([key, href, label]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ""}>${label}</a>`).join("");
}

function unifiedHeader(path) {
  const links = navigationLinks(path);
  return `<header class="legal-header rwn-unified-header">
    <a class="legal-brand" href="/" aria-label="Real World Needs home"><img class="legal-brand__mark" src="/brand/rwn-logo-192.png" alt="" width="192" height="192" decoding="async" /><span><strong>Real World Needs</strong><small>Essential services directory</small></span></a>
    <nav class="rwn-page-nav" aria-label="Primary navigation">${links}</nav>
    <details class="rwn-page-menu"><summary aria-label="Open navigation menu">Menu</summary><nav aria-label="Mobile navigation">${links}</nav></details>
  </header>`;
}

function unifiedFooter() {
  return `<footer class="legal-footer rwn-unified-footer">
    <p><strong>Real World Needs</strong><br />Essential services directory</p>
    <nav aria-label="Footer find help"><strong>Find help</strong><a href="/">Interactive map</a><a href="/directory">Directory</a><a href="/directory#saved">Saved services</a></nav>
    <nav aria-label="Footer about RWN"><strong>About RWN</strong><a href="/editorial-policy">How listings are checked</a><a href="/sources">Sources</a><a href="/transparency">Transparency</a></nav>
    <nav aria-label="Footer policies"><strong>Policies</strong><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a></nav>
    <nav class="professional-need-links" aria-label="Browse essential services by need"><strong>Browse by need</strong><a href="/directory/help/food">Food</a><a href="/directory/help/shelter">Shelter</a><a href="/directory/help/health">Health care</a><a href="/directory/help/hygiene">Hygiene</a><a href="/directory/help/clothing">Clothing</a><a href="/directory/help/water">Water</a></nav>
  </footer>`;
}

function mapsFor(resource) {
  const coordinate = `${resource.lat},${resource.lng}`;
  return {
    apple: `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(resource.name)}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`
  };
}

function directoryQuickActions(resource) {
  const links = [];
  const phones = phoneLinks(resource.phone);
  for (const { label, href } of phones) {
    links.push(`<a class="is-call" href="${href}">Call ${escapeHtml(label)}</a>`);
  }
  if (resource.kind === "direct" && hasMapCoordinates(resource)) {
    const maps = mapsFor(resource);
    links.push(`<a href="${escapeHtml(maps.apple)}" rel="noopener noreferrer">Apple Maps</a>`);
    links.push(`<a href="${escapeHtml(maps.google)}" rel="noopener noreferrer">Google Maps</a>`);
  }
  if (isContactOnly(resource) && resource.accessUrl) {
    links.push(`<a href="${escapeHtml(resource.accessUrl)}" rel="noopener noreferrer">Get help online</a>`);
  }
  links.push(`<a class="is-details" href="/service/${encodeURIComponent(resource.id)}">View details</a>`);
  return `<nav class="directory-quick-actions" data-rwn-actions="${escapeHtml(resource.id)}" aria-label="Quick actions for ${escapeHtml(resource.name)}"><span>${resource.kind === "direct" ? (phones.length ? "Call or get directions" : "Get directions") : "Open this listing"}</span>${links.join("")}</nav>`;
}

function serviceActions(resource) {
  const links = [];
  const phones = phoneLinks(resource.phone);
  const isDirectLocation = resource.kind === "direct" && hasMapCoordinates(resource);
  const isFinder = resource.kind === "locator" || resource.kind === "network";
  const contactOnly = isContactOnly(resource);
  const nextStep = contactOnly
    ? `Check coverage, then ${resource.phone ? (resource.accessUrl ? "call or get help online" : "call for help") : "get help online"}`
    : sourceClosureNotice(resource) ? "Confirm availability before travel" : isDirectLocation
    ? (phones.length ? "Call, get directions, or verify current details" : "Get directions or verify current details")
    : (phones.length ? "Call or verify current details" : "Verify current details");
  const context = contactOnly
    ? `<span class="service-next-steps__context">${escapeHtml(contactOnlyNotice(resource))}</span>${resource.phone ? `<span class="service-next-steps__context">Phone dialing scope: ${escapeHtml(resource.phoneAccess)}</span>` : ""}`
    : isFinder
    ? `<span class="service-next-steps__context">Official ${resource.kind === "locator" ? "resource finder" : "service network"} — not a walk-in location.</span>`
    : "";
  const phoneContext = resource.phone && (phones.length !== 1 || phones[0].label !== resource.phone)
    ? `<span class="service-next-steps__context" data-phone-context>Phone: ${escapeHtml(resource.phone)}</span>`
    : "";
  for (const { label, href } of phones) {
    links.push(`<a class="is-call" href="${href}"><strong>Call</strong><span>${escapeHtml(label)}</span></a>`);
  }
  if (isDirectLocation) {
    const maps = mapsFor(resource);
    links.push(`<a class="is-map is-directions" href="${escapeHtml(maps.google)}" rel="noopener noreferrer"><strong>Directions</strong><span>Open a route in your maps app</span></a>`);
  }
  if (contactOnly && resource.accessUrl) {
    links.push(`<a href="${escapeHtml(resource.accessUrl)}" rel="noopener noreferrer"><strong>Get help online</strong><span>Use the reviewed access link</span></a>`);
  }
  links.push(`<a class="is-primary" href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer"><strong>Official source</strong><span>Verify current details</span></a>`);
  if (hasMapCoordinates(resource)) links.push(`<a href="/#resource=${encodeURIComponent(resource.id)}"><strong>Interactive map</strong><span>Show this listing on RWN</span></a>`);
  return `<nav class="service-next-steps" aria-label="${isDirectLocation ? "Contact or get directions" : "Contact or verify current details"} for this service"><div><span>Next step</span><strong>${nextStep}</strong>${context}${phoneContext}</div><div>${links.join("")}</div></nav>`;
}

function enhanceActionOrientation(html) {
  html = html.replace(/<article class="directory-record"([^>]*)>[\s\S]*?<\/article>/g, (article) => {
    if (article.includes("data-rwn-actions=")) return article;
    const match = article.match(/href="\/service\/([^"#?]+)"/);
    if (!match) return article;
    const id = decodeURIComponent(match[1]);
    const resource = resourcesById.get(id);
    if (!resource) return article;
    return article.replace("</header>", `</header>\n    ${sourceClosureMarkup(resource)}${directoryQuickActions(resource)}`);
  });

  const serviceId = canonicalPathFrom(html).match(/^\/service\/([^/]+)\/?$/)?.[1];
  if (serviceId) {
    const resource = resourcesById.get(decodeURIComponent(serviceId));
    if (resource) html = html.replace(/<nav class="service-next-steps"[\s\S]*?<\/nav>/, serviceActions(resource));
  }

  html = html.replace(
    /<div class="directory-downloads"><strong>Directory tools<\/strong>([\s\S]*?)<\/div>/,
    '<details class="directory-advanced"><summary>Download directory data</summary><div class="directory-downloads">$1</div></details>'
  );

  const browsePattern = /(<nav class="directory-downloads" aria-label="Browse directory by need">[\s\S]*?<\/nav>\s*<nav class="directory-downloads" aria-label="Browse directory by region">[\s\S]*?<\/nav>\s*<nav class="directory-downloads" aria-label="Browse directory by country">[\s\S]*?<\/nav>)/;
  if (browsePattern.test(html)) {
    html = html.replace(browsePattern, '<details class="directory-browse-more"><summary>Browse by location or type of help</summary><div>$1</div></details>');
  }
  return html;
}

function enhanceHome(html, release) {
  html = html
    .replace('<html lang="en">', '<html lang="en" class="rwn-professional">')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${HOME_TITLE}</title>`)
    .replace(/<meta\b[^>]*\bname=(["'])description\1[^>]*\bcontent=(["'])(.*?)\2[^>]*>/i, `<meta name="description" content="${HOME_DESCRIPTION}" />`)
    .replaceAll("Real World Needs | Find Free Food, Shelter, Health Care & Essential Help", HOME_TITLE)
    .replaceAll("Find free food, shelter, health care, clothing, hygiene support, drinking water, and other essential services in one searchable directory.", HOME_DESCRIPTION)
    .replaceAll("Search free essential services and go directly to the original organization or public source. Find food, shelter, health care, clothing, hygiene support, drinking water, and more.", HOME_DESCRIPTION)
    .replace(
      "<p>Real World Needs helps you find food, shelter, health care, showers and hygiene support, clothing, drinking water, and other essentials. Every listing stays connected to the organization or public source behind it.</p>",
      "<p>Search by service or place. Listings include provider contact details, the original source, and the date RWN checked it.</p>"
    );

  html = ensureVersionedStylesheet(html, "/src/clarity.css", release);
  html = ensureVersionedStylesheet(html, "/navigation-actions.css", release);
  if (!html.includes("data-rwn-critical-shell")) html = html.replace("</head>", `  ${CRITICAL_HOME_STYLE}\n</head>`);

  html = addSocialMetadata(html);
  html = ensureHeadLink(html, "sitemap", "/sitemap.xml", ' type="application/xml"');
  return html;
}

function enhanceGeneratedPage(html, release) {
  html = html
    .replaceAll('<span class="legal-brand__mark">RWN</span>', '<img class="legal-brand__mark" src="/brand/rwn-logo-192.png" alt="" width="192" height="192" decoding="async" />')
    .replaceAll('<img class="legal-brand__mark" src="/rwn-mark.svg" alt="" width="34" height="34" decoding="async" />', '<img class="legal-brand__mark" src="/brand/rwn-logo-192.png" alt="" width="192" height="192" decoding="async" />')
    .replaceAll("Free essential services directory", "Essential services directory")
    .replaceAll("Text directory", "Directory")
    .replaceAll("Find free essential services without using the globe.", DIRECTORY_HEADING)
    .replaceAll("Browse food assistance, shelter, health care, hygiene, clothing, drinking water, and local resource finders. Every listing stays connected to its original source.", DIRECTORY_DESCRIPTION);

  html = ensureVersionedStylesheet(html, "/professional-pages.css", release);
  html = ensureVersionedStylesheet(html, "/navigation-actions.css", release);
  if (!html.includes("data-rwn-page-critical")) html = html.replace("</head>", `  ${CRITICAL_PAGE_STYLE}\n</head>`);
  html = ensureHeadLink(html, "icon", "/rwn-mark.svg", ' type="image/svg+xml"');
  html = ensureHeadLink(html, "manifest", "/site.webmanifest");
  html = ensureHeadLink(html, "sitemap", "/sitemap.xml", ' type="application/xml"');
  html = addSocialMetadata(html);
  html = html.replace(/<meta\b[^>]*\bname=(["'])theme-color\1[^>]*\bcontent=(["'])(.*?)\2[^>]*>/i, '<meta name="theme-color" content="#ffffff" />');

  const path = canonicalPathFrom(html);
  if (/<header class="legal-header">[\s\S]*?<\/header>/.test(html)) html = html.replace(/<header class="legal-header">[\s\S]*?<\/header>/, unifiedHeader(path));
  if (/<footer class="legal-footer">[\s\S]*?<\/footer>/.test(html)) html = html.replace(/<footer class="legal-footer">[\s\S]*?<\/footer>/, unifiedFooter());
  if (html.includes('class="rwn-page-menu"')) {
    html = html.replace("</head>", `  <script type="module" src="/page-menu.js?v=${release}"></script>\n</head>`);
  }
  html = enhanceActionOrientation(html);
  return html;
}

const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
const release = releaseInfo.release;
if (!/^[a-f0-9]{12}$/.test(release)) throw new Error("A valid content-derived release hash is required before presentation enhancement.");

for (const path of await walkHtml("dist")) {
  const html = await readFile(path, "utf8");
  const enhanced = path === join("dist", "index.html")
    ? enhanceHome(html, release)
    : enhanceGeneratedPage(html, release);
  await writeFile(path, enhanced);
}

releaseInfo.presentationRelease = release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
