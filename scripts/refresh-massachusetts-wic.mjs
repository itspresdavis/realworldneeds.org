import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertReviewedMembership, preserveReviewedFields, replaceSourceSnapshot } from "./source-refresh-safety.mjs";

const BASE_URL = "https://www.mass.gov/wic-information-for-participants/locations";
const OUTPUT = new URL("../src/data/generated/massachusetts-wic.js", import.meta.url);
// Publisher dates are deliberately absent: this directory provides no reviewed
// per-office update date. Existing provenance survives pending separate review.
const SOURCE_FIELDS = ["name", "city", "lat", "lng", "address", "phone", "hours", "sourceUrl", "lastChecked"];
export const MASSACHUSETTS_WIC_MAX_ROWS = 1000;
export const MASSACHUSETTS_WIC_MAX_PAGES = 30;
export const MASSACHUSETTS_WIC_REQUEST_TIMEOUT_MS = 25000;

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error("Massachusetts WIC check date must be a valid YYYY-MM-DD date.");
  }
  return value;
}

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
  const starts = [...html.matchAll(/ma\.leafletMapData\.push\(\s*/g)];
  if (starts.length !== 1) throw new Error("Mass.gov WIC requires exactly one map payload.");
  const start = starts[0].index + starts[0][0].length;
  if (html[start] !== "{") throw new Error("Mass.gov WIC map payload must be a JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = start; cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      if (!/^\s*\);/.test(html.slice(cursor + 1))) throw new Error("Mass.gov WIC map payload has an invalid terminator.");
      const value = JSON.parse(html.slice(start, cursor + 1));
      if (!value || typeof value.map !== "string" || !value.map || !Array.isArray(value.markers)) throw new Error("Mass.gov WIC map payload is missing its map or markers array.");
      return value;
    }
  }
  throw new Error("Mass.gov WIC map payload is unterminated.");
}

function sourceId(marker) {
  const markup = marker?.infoWindow?.name;
  const anchors = typeof markup === "string" ? [...markup.matchAll(/<a(?=\s|>)([^<>]*)>/gi)] : [];
  const links = [];
  if (anchors.length === 1) {
    let attributes = anchors[0][1];
    // Consume actual attributes, so data-href and quoted attribute text cannot
    // masquerade as a link. Count href in every case/quote form before enforcing
    // the reviewed lower-case, double-quoted format used by listingSegment.
    while (attributes.trim()) {
      const attribute = attributes.match(/^\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/);
      if (!attribute) throw new Error("Mass.gov WIC location identity has malformed anchor attributes.");
      if (attribute[1].toLowerCase() === "href") links.push({ name: attribute[1], doubleQuoted: attribute[2], value: attribute[2] ?? attribute[3] ?? attribute[4] });
      attributes = attributes.slice(attribute[0].length);
    }
  }
  if (links.length !== 1 || links[0].name !== "href" || links[0].doubleQuoted === undefined || !/^\/locations\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(links[0].value)) {
    throw new Error("Mass.gov WIC marker is missing a valid, unambiguous location identity.");
  }
  return links[0].value;
}

const ITEM_START = '<li class="ma__image-promo js-location-listing-link">';

function listingCards(html) {
  const resultsStart = html.indexOf("ma__location-listing__results");
  if (resultsStart < 0) throw new Error("Mass.gov WIC rendered results are missing.");
  return html.slice(resultsStart).split(ITEM_START).slice(1).map((content) => {
    let depth = 1;
    for (const tag of content.matchAll(/<\/?li(?=[\s>])[^>]*>/gi)) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (depth === 0) return ITEM_START + content.slice(0, tag.index + tag[0].length);
    }
    throw new Error("Mass.gov WIC rendered location card is unterminated.");
  });
}

function cardIdentity(card) {
  return sourceId({ infoWindow: { name: card.split(/<ul\b/)[0] } });
}

export function parseMassachusettsWicPage(html) {
  if (typeof html !== "string") throw new Error("Mass.gov WIC page must be HTML text.");
  const { markers } = markerPayload(html);
  // Validate the displayed range, not just a permissive `of N results` match.
  // Repeated identical counters (top/bottom pager) are harmless; conflicts fail.
  const ranges = [...plainText(html.replace(/<script[\s\S]*?<\/script>/gi, " ")).matchAll(/\bShowing\s+(\d+)\s*(?:[-–]|to)\s*(\d+)\s+of\s+(\d+)\s+results\b/gi)]
    .map((match) => match.slice(1).map(Number));
  if (!ranges.length || ranges.some((range) => range.some((n) => !Number.isSafeInteger(n))) || new Set(ranges.map((range) => JSON.stringify(range))).size !== 1) {
    throw new Error("Mass.gov WIC page is missing an exact, consistent result range.");
  }
  const [start, end, total] = ranges[0];
  if (total < 1 || total > MASSACHUSETTS_WIC_MAX_ROWS || start < 0 || end < start || end > total || (markers.length ? start < 1 || end - start + 1 !== markers.length : start !== 0 || end !== 0)) {
    throw new Error("Mass.gov WIC page has an invalid or incomplete result range.");
  }
  const cards = listingCards(html);
  const cardIds = cards.map(cardIdentity);
  const ids = markers.map(sourceId);
  if (cards.length !== markers.length || new Set(cardIds).size !== cards.length || ids.some((id) => !cardIds.includes(id))) {
    throw new Error("Mass.gov WIC map and rendered location identities do not match.");
  }
  return { markers, html, start, end, total };
}

function listingSegment(html, href) {
  const matches = listingCards(html).filter((card) => cardIdentity(card) === href);
  if (matches.length !== 1) throw new Error("Mass.gov WIC source identity lacks one rendered location card.");
  return matches[0];
}

function coordinate(value) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) || !Number.isFinite(Number(value))) {
    throw new Error("Mass.gov WIC coordinates must be finite numbers or nonblank decimal strings.");
  }
  return Number(value);
}

export function makeMassachusettsWicResource(marker, html, { checkedOn } = {}) {
  validDate(checkedOn);
  const href = sourceId(marker);
  const info = marker.infoWindow;
  if (typeof marker.position?.alt !== "string" || !plainText(marker.position.alt) || typeof info.address !== "string" || !plainText(info.address)) {
    throw new Error(`Mass.gov WIC ${href} is missing a name or street address.`);
  }
  if (info.phone !== undefined && info.phone !== null && typeof info.phone !== "string") throw new Error(`Mass.gov WIC ${href} has a malformed phone.`);
  const name = plainText(marker.position.alt);
  const address = plainText(info.address);
  const lat = coordinate(marker.position.lat);
  const lng = coordinate(marker.position.lng);
  // Conservative Massachusetts envelope, including Cape Cod and the islands.
  // This is a plausibility check, not parcel or state-boundary verification.
  if (lat < 41.1 || lat > 42.9 || lng < -73.6 || lng > -69.8) {
    throw new Error(`Mass.gov WIC ${href} coordinates are outside Massachusetts bounds.`);
  }
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
    verificationMethod: "official-location-list",
    coordinateNote: "Coordinates come from the Mass.gov WIC location map, whose map data is sourced from MassGIS.",
    lastChecked: checkedOn
  };
}

async function loadPage(page, fetchImpl, requestTimeoutMs) {
  const controller = new AbortController();
  let timer;
  // The deadline includes body consumption even when an injected transport
  // ignores AbortSignal. Promise.race observes late rejections without retrying.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Mass.gov WIC page ${page} exceeded the request/body deadline.`);
      controller.abort(error);
      reject(error);
    }, requestTimeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(`${BASE_URL}?page=${page}`, {
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: { "User-Agent": "RealWorldNeeds data refresh; source-attributed public service directory" }
        });
        controller.signal.throwIfAborted();
        if (!response.ok) throw new Error(`Mass.gov WIC page ${page} returned ${response.status}.`);
        const html = await response.text();
        controller.signal.throwIfAborted();
        return parseMassachusettsWicPage(html);
      })(),
      deadline
    ]);
  } finally { clearTimeout(timer); }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function pageFingerprint(page) {
  // Compare parsed facts and listing details, ignoring unrelated page chrome.
  return JSON.stringify(stableValue(page.markers.map((marker) => ({ marker, listing: plainText(listingSegment(page.html, sourceId(marker))) }))));
}

export async function fetchMassachusettsWicSnapshot({ fetchImpl = fetch, requestTimeoutMs = MASSACHUSETTS_WIC_REQUEST_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MASSACHUSETTS_WIC_REQUEST_TIMEOUT_MS) throw new Error("Mass.gov WIC requestTimeoutMs is outside its bounded range.");
  const first = await loadPage(0, fetchImpl, requestTimeoutMs);
  const pageSize = first.markers.length;
  const pages = Math.ceil(first.total / pageSize);
  if (first.start !== 1 || pageSize < 1 || pageSize > 100 || pages > MASSACHUSETTS_WIC_MAX_PAGES) throw new Error("Mass.gov WIC first page has an invalid range or page budget.");
  const rows = [];
  const identities = new Set();
  function accept(page, index) {
    const start = index * pageSize + 1;
    const end = Math.min(start + pageSize - 1, first.total);
    if (page.total !== first.total || page.start !== start || page.end !== end || page.markers.length !== end - start + 1) throw new Error(`Mass.gov WIC totals or range changed on page ${index}.`);
    for (const marker of page.markers) {
      const id = sourceId(marker);
      if (identities.has(id)) throw new Error(`Mass.gov WIC duplicate source identity ${id}.`);
      identities.add(id);
      rows.push({ marker, html: page.html });
    }
  }
  accept(first, 0);
  for (let page = 1; page < pages; page += 1) accept(await loadPage(page, fetchImpl, requestTimeoutMs), page);
  // Require explicit empty-range evidence. A clamped last page, unexpected
  // access response or unsupported empty-page format fails for manual review.
  const overflow = await loadPage(pages, fetchImpl, requestTimeoutMs);
  if (overflow.total !== first.total || overflow.markers.length !== 0 || overflow.start !== 0 || overflow.end !== 0) throw new Error("Mass.gov WIC overflow page was not empty or its count changed.");
  const bracket = await loadPage(0, fetchImpl, requestTimeoutMs);
  if (bracket.total !== first.total || bracket.start !== first.start || bracket.end !== first.end || pageFingerprint(bracket) !== pageFingerprint(first)) throw new Error("Mass.gov WIC first page changed during collection.");
  if (rows.length !== first.total || identities.size !== first.total) throw new Error("Mass.gov WIC raw identity coverage does not match the result count.");
  return { rows, audit: { expectedRows: first.total, uniqueRawIds: identities.size, pageSize, pagesFetched: pages, overflowRows: 0 } };
}

export async function refreshMassachusettsWic({ fetchImpl = fetch, requestTimeoutMs, writeOutput, checkedOn = new Date().toISOString().slice(0, 10), minimumRecords = 90, previousResources } = {}) {
  validDate(checkedOn);
  if (!Number.isSafeInteger(minimumRecords) || minimumRecords < 1) throw new Error("Massachusetts WIC minimumRecords must be a positive integer.");
  const previousById = new Map((previousResources || []).map((record) => [record.id, record]));
  if (previousById.size !== (previousResources || []).length) throw new Error("Massachusetts WIC previous snapshot contains duplicate resource IDs.");
  const snapshot = await fetchMassachusettsWicSnapshot({ fetchImpl, requestTimeoutMs });
  const records = snapshot.rows.map(({ marker, html }) => {
    const candidate = makeMassachusettsWicResource(marker, html, { checkedOn });
    const previous = previousById.get(candidate.id);
    if (previous && Boolean(previous.hours) !== Boolean(candidate.hours)) throw new Error(`Changed hours availability for ${candidate.id} requires editorial reconciliation.`);
    const accessibilityNotes = ["Mass.gov marks this location as wheelchair accessible.", "Accessibility details are not stated in the location summary; call the office for current access information."];
    if (previous && accessibilityNotes.some((note) => previous.accessibilityNote?.includes(note) && !candidate.accessibilityNote.includes(note))) throw new Error(`Changed accessibility evidence for ${candidate.id} requires editorial reconciliation.`);
    return preserveReviewedFields(candidate, previous, SOURCE_FIELDS);
  });
  if (records.length < minimumRecords || new Set(records.map((record) => record.id)).size !== records.length) throw new Error(`Massachusetts WIC refresh produced ${records.length} records; refusing to publish.`);
  assertReviewedMembership(records, previousResources);
  records.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const audit = { ...snapshot.audit, checkedOn, publishedRecords: records.length, publisherDate: "not-published; existing provenance preserved" };
  const output = `// Generated by scripts/refresh-massachusetts-wic.mjs from the official Mass.gov directory.\n// Do not hand edit; rerun npm run refresh:data:ma-wic.\nexport const massachusettsWicResources = ${JSON.stringify(records, null, 2)};\n`;
  if (writeOutput) await writeOutput(output);
  return { records, audit, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = await readFile(OUTPUT);
  const { massachusettsWicResources } = await import(OUTPUT.href);
  const result = await refreshMassachusettsWic({
    previousResources: massachusettsWicResources,
    writeOutput: (output) => replaceSourceSnapshot(OUTPUT, before, output)
  });
  console.log(`Refreshed ${result.records.length} Massachusetts WIC locations from Mass.gov.`);
  console.log(JSON.stringify(result.audit, null, 2));
}
