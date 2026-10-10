import { writeFile } from "node:fs/promises";

const FINDER_BASE = "https://www.trussell.org.uk/emergency-food/get-a-food-voucher/choose-a-foodbank";
const OUTPUT = new URL("../src/data/generated/trussell-foodbanks.js", import.meta.url);
const USER_AGENT = "RealWorldNeeds/1.0 source refresh (public humanitarian directory)";
const MIN_EXPECTED_SOURCE_RECORDS = 1300;
const MIN_EXPECTED_PUBLISHED_RECORDS = 1250;
const MAX_CONCURRENCY = 8;
const RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": USER_AGENT
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.text();
  } catch (error) {
    if (attempt >= RETRIES) throw error;
    await sleep(350 * attempt);
    return fetchText(url, attempt + 1);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeNextPayloads(html) {
  const decoded = [];
  const expression = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)<\/script>/g;
  for (const match of html.matchAll(expression)) {
    try {
      decoded.push(JSON.parse(`"${match[1]}"`));
    } catch {
      // A malformed unrelated streamed chunk should not make us publish bad data.
    }
  }
  return decoded.join("\n");
}

function jsonObjectAt(text, start) {
  if (text[start] !== "{") throw new Error("Expected JSON object start");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error("Unterminated JSON object in Trussell payload");
}

function extractResultObjects(payload) {
  const records = [];
  const needle = '"result":';
  let cursor = 0;
  while (cursor < payload.length) {
    const keyIndex = payload.indexOf(needle, cursor);
    if (keyIndex < 0) break;
    const objectStart = payload.indexOf("{", keyIndex + needle.length);
    if (objectStart < 0) break;
    let slice;
    try {
      slice = jsonObjectAt(payload, objectStart);
    } catch {
      cursor = objectStart + 1;
      continue;
    }
    try {
      const value = JSON.parse(slice);
      if (value?.uuid && value?.title && value?.geoLocation) records.push(value);
    } catch {
      // Ignore non-food-bank result objects; completeness checks below fail closed.
    }
    cursor = objectStart + slice.length;
  }
  return records;
}

function totalPagesFromPayload(payload) {
  const match = payload.match(/"totalPages":(\d+)/);
  return match ? Number(match[1]) : null;
}

function totalResultsFromPayload(payload) {
  const candidates = [...payload.matchAll(/\[(\d+)," results"\]/g)].map((match) => Number(match[1]));
  return candidates.length ? Math.max(...candidates) : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .replace(/&(?:#0*39|apos);/gi, "'")
    .replace(/&(?:amp|#0*38);/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function parseCoordinates(record) {
  let geometry;
  try {
    geometry = JSON.parse(record.geoLocation);
  } catch {
    return null;
  }
  const [lng, lat] = geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 49 || lat > 61.5 || lng < -9.5 || lng > 2.7) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function uniqueParts(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const value = normalizeText(raw);
    if (!value) continue;
    const key = value.toLocaleLowerCase("en-GB");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function safeProviderUrl(record) {
  const candidate = normalizeText(record.websiteReferralUrl);
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch {}
  }
  const domain = normalizeText(record.domain);
  if (!domain) return FINDER_BASE;
  try {
    return new URL(`https://${domain}`).toString();
  } catch {
    return FINDER_BASE;
  }
}

function sourceHidesAddress(value) {
  // Trussell currently sends "On"/"Off", but tolerate equivalent boolean flags.
  // Unrecognized nonempty flags fail closed rather than exposing an address.
  if (value === null || value === undefined || value === false) return false;
  const flag = normalizeText(value)?.toLowerCase() || "";
  return !["", "off", "false", "no", "0"].includes(flag);
}

function makeResource(record, sourcePage, checkedOn) {
  if (sourceHidesAddress(record.hideAddressLink)) return null;
  if (!normalizeText(record.address01) && !normalizeText(record.address02)) return null;
  const coordinates = parseCoordinates(record);
  if (!coordinates) return null;

  const title = normalizeText(record.title);
  const groupTitle = normalizeText(record.groupTitle);
  const town = normalizeText(record.town);
  const postcode = normalizeText(record.postcode);
  const addressParts = uniqueParts([
    record.address01,
    record.address02,
    town,
    record.county,
    postcode,
    "United Kingdom"
  ]);
  if (!title || addressParts.length < 3 || !postcode) return null;

  const providerUrl = safeProviderUrl(record);
  const collectionStatus = normalizeText(record.dcsStatusLabel);
  const phone = normalizeText(record.telephone);
  const email = normalizeText(record.email);
  const referralType = normalizeText(record.referralType);
  const referralInstruction = referralType === "telephone"
    ? "Call the food bank or an approved referral partner to arrange a voucher before collection."
    : "Use the provider page or an approved referral partner to arrange a voucher before collection.";

  return {
    id: `trussell-${record.uuid}`,
    name: groupTitle && title.toLocaleLowerCase("en-GB") !== groupTitle.toLocaleLowerCase("en-GB")
      ? `${title} — ${groupTitle} Foodbank`
      : title,
    city: town || groupTitle || "United Kingdom",
    country: "United Kingdom",
    region: "Europe",
    lat: coordinates.lat,
    lng: coordinates.lng,
    category: "food",
    secondaryCategories: ["referral"],
    kind: "direct",
    locationPrecision: "exact",
    accessType: "Free emergency food parcel; Trussell voucher/referral required",
    costModel: "free-eligible",
    costNote: "Free emergency food parcel after an approved Trussell voucher/referral",
    address: addressParts.join(", "),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    providerUrl,
    collectionStatus,
    collectionStatusCheckedOn: checkedOn,
    summary: `An official Trussell food-bank centre${groupTitle ? ` in the ${groupTitle} network` : ""} where people with an approved food-bank voucher can access a free emergency food parcel.`,
    services: [
      "Free emergency food parcel with voucher/referral",
      "Food-bank referral guidance"
    ],
    eligibility: "A food-bank voucher/referral is required. A local referral partner assesses need and issues a voucher before emergency food is collected.",
    availabilityNote: `${collectionStatus ? `${collectionStatus}. ` : ""}${referralInstruction} Check the provider page or call before travel because collection times and local arrangements can change.`,
    sourceName: "Trussell",
    sourceKind: "Official Trussell food-bank finder record",
    sourceUrl: `${FINDER_BASE}?lat=&lng=&page=${sourcePage}`,
    sourceDetail: "Trussell's official finder publishes the centre UUID, address, contact details, referral route, collection status, and map coordinates used for this listing.",
    datasetId: "trussell-food-bank-centres",
    sourceRecordId: record.uuid,
    verificationMethod: "official-network-snapshot",
    coordinateNote: "Coordinates are published for this centre in Trussell's official food-bank finder payload.",
    lastChecked: checkedOn
  };
}

async function mapConcurrent(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function loadPage(page) {
  const url = `${FINDER_BASE}?lat=&lng=&page=${page}`;
  const html = await fetchText(url);
  const payload = decodeNextPayloads(html);
  if (!payload.includes('"uuid"') && page === 1) throw new Error("Trussell payload format changed: no UUID records found");
  return {
    page,
    payload,
    records: extractResultObjects(payload),
    totalPages: totalPagesFromPayload(payload),
    totalResults: totalResultsFromPayload(payload)
  };
}

const checkedOn = new Date().toISOString().slice(0, 10);
const firstPage = await loadPage(1);
if (!firstPage.totalPages || firstPage.totalPages < 100 || firstPage.totalPages > 250) {
  throw new Error(`Unexpected Trussell page count: ${firstPage.totalPages}`);
}
if (!firstPage.totalResults || firstPage.totalResults < MIN_EXPECTED_SOURCE_RECORDS) {
  throw new Error(`Unexpected Trussell result count: ${firstPage.totalResults}`);
}

const pageNumbers = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
const remainingPages = await mapConcurrent(pageNumbers, MAX_CONCURRENCY, (page) => loadPage(page));
const pages = [firstPage, ...remainingPages];

const rawByUuid = new Map();
for (const page of pages) {
  for (const record of page.records) {
    const existing = rawByUuid.get(record.uuid);
    if (existing) {
      if (JSON.stringify(existing.record) !== JSON.stringify(record)) {
        throw new Error(`Conflicting duplicate Trussell UUID ${record.uuid}`);
      }
      continue;
    }
    rawByUuid.set(record.uuid, { record, page: page.page });
  }
}

if (rawByUuid.size < MIN_EXPECTED_SOURCE_RECORDS) {
  throw new Error(`Only ${rawByUuid.size} unique Trussell records parsed from ${firstPage.totalResults} reported results`);
}
if (rawByUuid.size < Math.floor(firstPage.totalResults * 0.97)) {
  throw new Error(`Parsed ${rawByUuid.size}/${firstPage.totalResults} Trussell records; refusing a materially incomplete snapshot`);
}

const resources = [...rawByUuid.values()]
  .map(({ record, page }) => makeResource(record, page, checkedOn))
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.id.localeCompare(b.id));

if (resources.length < MIN_EXPECTED_PUBLISHED_RECORDS) {
  throw new Error(`Only ${resources.length} publishable Trussell centres remained after privacy/location validation`);
}

const ids = new Set();
for (const resource of resources) {
  if (ids.has(resource.id)) throw new Error(`Duplicate generated resource ID ${resource.id}`);
  ids.add(resource.id);
  if (!resource.address || resource.locationPrecision !== "exact") throw new Error(`Invalid direct-site semantics for ${resource.id}`);
  if (!resource.providerUrl || !resource.sourceUrl) throw new Error(`Missing source link for ${resource.id}`);
  if (!Number.isFinite(resource.lat) || !Number.isFinite(resource.lng)) throw new Error(`Invalid coordinate for ${resource.id}`);
}

const header = `// Generated by scripts/refresh-trussell-foodbanks.mjs from Trussell's official food-bank finder.\n// Do not hand edit; rerun npm run refresh:data:trussell.\n`;
const metadata = {
  reportedSourceRecords: firstPage.totalResults,
  parsedSourceRecords: rawByUuid.size,
  publishedRecords: resources.length,
  totalPages: firstPage.totalPages,
  checkedOn,
  excludedRecords: rawByUuid.size - resources.length
};
const compactRows = resources.map((resource) => {
  const source = rawByUuid.get(resource.sourceRecordId);
  const record = source?.record || {};
  return [
    resource.sourceRecordId,
    resource.name,
    resource.city,
    resource.lat,
    resource.lng,
    resource.address,
    resource.phone || null,
    resource.email || null,
    resource.providerUrl,
    normalizeText(record.dcsStatusLabel),
    normalizeText(record.referralType),
    source?.page || 1
  ];
});
const runtime = `const FINDER_BASE = ${JSON.stringify(FINDER_BASE)};
const CHECKED_ON = ${JSON.stringify(checkedOn)};
const rows = ${JSON.stringify(compactRows)};

function fromRow(row) {
  const [uuid, name, city, lat, lng, address, phone, email, providerUrl, collectionStatus, referralType, sourcePage] = row;
  const referralInstruction = referralType === "telephone"
    ? "Call the food bank or an approved referral partner to arrange a voucher before collection."
    : "Use the provider page or an approved referral partner to arrange a voucher before collection.";
  return {
    id: \`trussell-\${uuid}\`,
    name,
    city,
    country: "United Kingdom",
    region: "Europe",
    lat,
    lng,
    category: "food",
    secondaryCategories: ["referral"],
    kind: "direct",
    locationPrecision: "exact",
    accessType: "Free emergency food parcel; Trussell voucher/referral required",
    costModel: "free-eligible",
    costNote: "Free emergency food parcel after an approved Trussell voucher/referral",
    address,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    providerUrl,
    collectionStatus,
    collectionStatusCheckedOn: CHECKED_ON,
    summary: "An official Trussell food-bank centre where people with an approved food-bank voucher can access a free emergency food parcel.",
    services: ["Free emergency food parcel with voucher/referral", "Food-bank referral guidance"],
    eligibility: "A food-bank voucher/referral is required. A local referral partner assesses need and issues a voucher before emergency food is collected.",
    availabilityNote: \`\${collectionStatus ? \`\${collectionStatus}. \` : ""}\${referralInstruction} Check the provider page or call before travel because collection times and local arrangements can change.\`,
    sourceName: "Trussell",
    sourceKind: "Official Trussell food-bank finder record",
    sourceUrl: \`\${FINDER_BASE}?lat=&lng=&page=\${sourcePage}\`,
    sourceDetail: "Trussell's official finder publishes the centre UUID, address, contact details, referral route, collection status, and map coordinates used for this listing.",
    datasetId: "trussell-food-bank-centres",
    sourceRecordId: uuid,
    verificationMethod: "official-network-snapshot",
    coordinateNote: "Coordinates are published for this centre in Trussell's official food-bank finder payload.",
    lastChecked: CHECKED_ON
  };
}

export const trussellFoodbankResources = rows.map(fromRow);`;
const output = `${header}export const trussellFoodbankMetadata = ${JSON.stringify(metadata, null, 2)};\n\n${runtime}\n`;
await writeFile(OUTPUT, output, "utf8");
console.log(`Generated ${resources.length} Trussell food-bank centres from ${rawByUuid.size}/${firstPage.totalResults} official records across ${firstPage.totalPages} pages.`);
console.log(`Excluded ${rawByUuid.size - resources.length} records that did not meet public-address/direct-location requirements.`);
