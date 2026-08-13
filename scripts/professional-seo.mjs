import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HOME_TITLE = "Find Essential Services Near You | Real World Needs";
const HOME_DESCRIPTION = "Search food, shelter, health care, hygiene, clothing, water and other essential services. Review the source, date checked and provider contact details.";
const SOCIAL_IMAGE = "https://www.realworldneeds.org/media/earth-blue-marble.jpg";
const CRITICAL_HOME_STYLE = `<style data-rwn-critical-shell>
.directory-strip,.accountability,#openInspector{display:none!important}
.globe-canvas{touch-action:none;overscroll-behavior:contain}
.globe-pin-layer{transition:opacity 100ms linear}
.globe-stage.has-gpu-points.is-globe-moving .globe-pin-layer{opacity:0;pointer-events:none}
@media(max-width:900px){.globe-canvas{touch-action:pan-y;overscroll-behavior-y:auto}}
@media(prefers-reduced-motion:reduce){.globe-pin-layer{transition:none}}
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

function titleFrom(html) {
  return decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || "Real World Needs");
}

function descriptionFrom(html) {
  const match = html.match(/<meta\b[^>]*\bname=(["'])description\1[^>]*\bcontent=(["'])(.*?)\2[^>]*>/i);
  return decodeEntities(match?.[3]?.trim() || "Find essential services and review the source behind each listing.");
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

function professionalFooterLinks() {
  return `<nav class="professional-need-links" aria-label="Browse essential services by need"><strong>Browse by need</strong><a href="/directory/help/food">Food</a><a href="/directory/help/shelter">Shelter</a><a href="/directory/help/health">Health care</a><a href="/directory/help/hygiene">Hygiene</a><a href="/directory/help/clothing">Clothing</a><a href="/directory/help/water">Water</a><a href="/directory">Full directory</a><a href="/sources">Sources</a></nav>`;
}

function enhanceHome(html, release) {
  html = html
    .replace('<html lang="en">', '<html lang="en" class="rwn-professional">')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${HOME_TITLE}</title>`)
    .replace(/<meta\b[^>]*\bname=(["'])description\1[^>]*\bcontent=(["'])(.*?)\2[^>]*>/i, `<meta name="description" content="${HOME_DESCRIPTION}" />`)
    .replaceAll("Real World Needs | Find Free Food, Shelter, Health Care & Essential Help", HOME_TITLE)
    .replaceAll("Find free food, shelter, health care, clothing, hygiene support, drinking water, and other essential services in one searchable directory.", HOME_DESCRIPTION)
    .replaceAll("Search free essential services and go directly to the original organization or public source. Find food, shelter, health care, clothing, hygiene support, drinking water, and more.", HOME_DESCRIPTION)
    .replace("<h1>Find free help near you.</h1>", "<h1>Find food, shelter, health care and other essentials.</h1>")
    .replace(
      "<p>Real World Needs helps you find food, shelter, health care, showers and hygiene support, clothing, drinking water, and other essentials. Every listing stays connected to the organization or public source behind it.</p>",
      "<p>Search by service or place. Each listing shows who provides the help, how to contact them, where the information came from, and when we last checked it.</p>"
    );

  if (!html.includes("/src/clarity.css")) {
    html = html.replace("</head>", `  <link rel="stylesheet" href="/src/clarity.css?v=${release}" />\n</head>`);
  }
  if (!html.includes("data-rwn-critical-shell")) {
    html = html.replace("</head>", `  ${CRITICAL_HOME_STYLE}\n</head>`);
  }

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

  if (!html.includes("/professional-pages.css")) {
    html = html.replace("</head>", `  <link rel="stylesheet" href="/professional-pages.css?v=${release}" />\n</head>`);
  }
  if (!html.includes("data-rwn-page-critical")) {
    html = html.replace("</head>", `  ${CRITICAL_PAGE_STYLE}\n</head>`);
  }
  html = ensureHeadLink(html, "icon", "/rwn-mark.svg", ' type="image/svg+xml"');
  html = ensureHeadLink(html, "manifest", "/site.webmanifest");
  html = ensureHeadLink(html, "sitemap", "/sitemap.xml", ' type="application/xml"');
  html = addSocialMetadata(html);
  html = html.replace(/<meta\b[^>]*\bname=(["'])theme-color\1[^>]*\bcontent=(["'])(.*?)\2[^>]*>/i, '<meta name="theme-color" content="#ffffff" />');
  if (html.includes('<footer class="legal-footer">') && !html.includes("professional-need-links")) {
    html = html.replace("</footer>", `${professionalFooterLinks()}\n  </footer>`);
  }
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
