import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = "https://www.mass.gov/wic-information-for-participants/locations";
const REVIEW_DATE = new Date().toISOString().slice(0, 10);

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&ndash;", "–")
    .replaceAll("&mdash;", "—")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function plainText(value) {
  return decodeHtml(String(value || "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<\/li>/gi, "; ")
    .replace(/<\/div>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s*;\s*;+/g, "; ")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim();
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function markerPayload(html) {
  const match = html.match(/ma\.leafletMapData\.push\((\{"map":[\s\S]*?\})\);/);
  if (!match) throw new Error("Mass.gov WIC map data was not found in the page.");
  return JSON.parse(match[1]);
}

function listingSegment(html, href) {
  const resultsStart = html.indexOf("ma__location-listing__results");
  const results = resultsStart >= 0 ? html.slice(resultsStart) : html;
  const linkIndex = results.indexOf(`href="${href}"`);
  if (linkIndex < 0) return "";
  const itemStart = '<li class="ma__image-promo js-location-listing-link">';
  const start = results.lastIndexOf(itemStart, linkIndex);
  const next = results.indexOf(itemStart, linkIndex + href.length);
  return results.slice(Math.max(0, start), next < 0 ? undefined : next);
}

function recordFromMarker(marker, html) {
  const name = plainText(marker.position?.alt);
  const info = marker.infoWindow || {};
  const href = info.name?.match(/href="([^"]+)"/)?.[1];
  const lat = Number(marker.position?.lat);
  const lng = Number(marker.position?.lng);
  const address = plainText(info.address);
  if (!name || !href || !Number.isFinite(lat) || !Number.isFinite(lng) || !address) return null;

  const segment = listingSegment(html, href);
  const hoursMarkup = segment.match(/<ul class="ma__image-promo__hours"[\s\S]*?>([\s\S]*?)<\/ul>/)?.[1] || "";
  const hours = plainText(hoursMarkup);
  const city = address.match(/,\s*([^,]+),\s*MA\s+\d{5}(?:-\d{4})?\s*$/i)?.[1]?.trim() || "Massachusetts";
  const accessible = /Wheelchair Accessible/i.test(segment);
  const militaryOnly = /Military only/i.test(name);

  return {
    id: `ma-wic-${slug(href.split("/").filter(Boolean).at(-1) || name)}`,
    name,
    city,
    country: "United States",
    region: "North America",
    lat,
    lng,
    category: "food",
    secondaryCategories: ["referral"],
    kind: "direct",
    locationPrecision: "exact",
    accessType: militaryOnly ? "Military WIC office; call for eligibility and appointment" : "Local WIC office; call for eligibility and appointment",
    costNote: "Free to Massachusetts families who qualify",
    address,
    ...(info.phone ? { phone: plainText(info.phone) } : {}),
    ...(hours ? { hours } : {}),
    summary: "A Massachusetts WIC office providing healthy foods, nutrition education, breastfeeding support, and referrals to healthcare and other services for qualifying families.",
    services: ["Healthy foods through WIC", "Nutrition education", "Breastfeeding support", "Healthcare and community referrals"],
    eligibility: militaryOnly ? "Published as a military-only WIC location; confirm eligibility by phone." : "Pregnant, breastfeeding, or postpartum people and children under five who meet Massachusetts WIC requirements.",
    availabilityNote: hours ? "Published office hours are shown. Call before travel to confirm the schedule, appointment availability, and documents needed." : "Mass.gov does not publish hours in the location summary. Call before travel to confirm the schedule, appointment availability, and documents needed.",
    accessibilityNote: accessible ? "Mass.gov marks this location as wheelchair accessible." : "Accessibility details are not stated in the location summary; call the office for current access information.",
    sourceName: "Massachusetts Department of Public Health",
    sourceKind: "Official state WIC location directory",
    sourceUrl: `https://www.mass.gov${href}`,
    sourceDetail: "Mass.gov publishes the office address, map point, phone number, and available hours for this WIC location.",
    datasetId: "massachusetts-wic-locations",
    sourceRecordId: href,
    sourceUpdatedAt: REVIEW_DATE,
    verificationMethod: "official-location-list",
    coordinateNote: "Coordinates come from the Mass.gov WIC location map, whose map data is sourced from MassGIS.",
    lastChecked: REVIEW_DATE
  };
}

async function loadPage(page) {
  const response = await fetch(`${BASE_URL}?page=${page}`, {
    headers: { "User-Agent": "RealWorldNeeds data refresh; source-attributed public service directory" }
  });
  if (!response.ok) throw new Error(`Mass.gov WIC page ${page} returned ${response.status}.`);
  return response.text();
}

const records = new Map();
let expectedTotal = null;

for (let page = 0; page < 30; page += 1) {
  const html = await loadPage(page);
  if (expectedTotal === null) {
    expectedTotal = Number(html.match(/of\s+(\d+)\s+results/i)?.[1] || 0);
  }
  const markers = markerPayload(html).markers || [];
  if (!markers.length) break;
  for (const marker of markers) {
    const record = recordFromMarker(marker, html);
    if (record) records.set(record.id, record);
  }
  if (expectedTotal && records.size >= expectedTotal) break;
}

if (!expectedTotal || records.size !== expectedTotal) {
  throw new Error(`Expected ${expectedTotal || "a known number of"} Massachusetts WIC locations; parsed ${records.size}.`);
}

const sorted = [...records.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
const output = `// Generated by scripts/refresh-massachusetts-wic.mjs from the official Mass.gov directory.\n// Do not hand edit; rerun npm run refresh:data:ma-wic.\nexport const massachusettsWicResources = ${JSON.stringify(sorted, null, 2)};\n`;

await mkdir("src/data/generated", { recursive: true });
await writeFile("src/data/generated/massachusetts-wic.js", output);
console.log(`Refreshed ${sorted.length} Massachusetts WIC locations from Mass.gov.`);
