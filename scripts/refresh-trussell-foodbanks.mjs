import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { preserveReviewedFields, replaceSourceSnapshot, assertReviewedMembership } from "./source-refresh-safety.mjs";

const FINDER_BASE = "https://www.trussell.org.uk/emergency-food/get-a-food-voucher/choose-a-foodbank";
const OUTPUT = new URL("../src/data/generated/trussell-foodbanks.js", import.meta.url);
const USER_AGENT = "RealWorldNeeds/1.0 source refresh (public humanitarian directory)";
const MIN_EXPECTED_SOURCE_RECORDS = 1300;
const MIN_EXPECTED_PUBLISHED_RECORDS = 1250;
const PAGE_SIZE = 10;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": USER_AGENT
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25000)
  });
  // Stop on any failed request, including access restrictions. Never retry a
  // denied route or treat a partial set of pages as a successful refresh.
  if (!response.ok) throw new Error(`HTTP ${response.status} for Trussell source`);
  return response.text();
}

export function decodeNextPayloads(html) {
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

export function extractResultObjects(payload) {
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
      if (value?.uuid) records.push(value);
    } catch {
      // Ignore non-food-bank result objects; completeness checks below fail closed.
    }
    cursor = objectStart + slice.length;
  }
  return records;
}

function totalPagesFromPayload(payload) {
  const values = [...payload.matchAll(/"totalPages":(\d+)/g)].map((match) => Number(match[1]));
  return values.length && new Set(values).size === 1 ? values[0] : null;
}

function totalResultsFromPayload(payload) {
  const candidates = [...payload.matchAll(/\[(\d+)," results"\]/g)].map((match) => Number(match[1]));
  return candidates.length && new Set(candidates).size === 1 ? candidates[0] : null;
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
  if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 2) return null;
  const [lng, lat] = geometry.coordinates;
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

export function publicationExclusion(record) {
  if (sourceHidesAddress(record.hideAddressLink)) return "source_hidden_location";
  if (!normalizeText(record.address01) && !normalizeText(record.address02)) return "missing_street_address";
  if (!parseCoordinates(record)) return "invalid_coordinates";
  if (!normalizeText(record.title) || !normalizeText(record.postcode)) return "incomplete_location";
  if (uniqueParts([record.address01, record.address02, record.town, record.county, record.postcode, "United Kingdom"]).length < 3) return "incomplete_location";
  return null;
}

export function makeResource(record, sourcePage, checkedOn) {
  if (publicationExclusion(record)) return null;
  const coordinates = parseCoordinates(record);

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
    summary: "An official Trussell food-bank centre where people with an approved food-bank voucher can access a free emergency food parcel.",
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

export async function fetchTrussellSnapshot({ loadPageImpl = loadPage, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const firstPage = await loadPageImpl(1);
  const { totalPages, totalResults } = firstPage;
  if (!Number.isSafeInteger(totalResults) || totalResults < MIN_EXPECTED_SOURCE_RECORDS || totalResults > 2500) {
    throw new Error(`Unexpected Trussell result count: ${totalResults}`);
  }
  if (!Number.isSafeInteger(totalPages) || totalPages !== Math.ceil(totalResults / PAGE_SIZE)) {
    throw new Error(`Inconsistent Trussell page count: ${totalPages}`);
  }
  const rawByUuid = new Map();
  function acceptPage(page, expectedPage) {
    if (page.page !== expectedPage || page.totalPages !== totalPages || page.totalResults !== totalResults) {
      throw new Error(`Trussell totals or page number changed on page ${expectedPage}`);
    }
    const expectedSize = Math.min(PAGE_SIZE, totalResults - (expectedPage - 1) * PAGE_SIZE);
    if (!Array.isArray(page.records) || page.records.length !== expectedSize) {
      throw new Error(`Incomplete Trussell page ${expectedPage}: expected ${expectedSize} identities`);
    }
    for (const record of page.records) {
      if (typeof record?.uuid !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(record.uuid)) {
        throw new Error(`Invalid Trussell source identity on page ${expectedPage}`);
      }
      if (rawByUuid.has(record.uuid)) throw new Error(`Duplicate Trussell UUID ${record.uuid}; snapshot may have shifted`);
      rawByUuid.set(record.uuid, { record, page: expectedPage });
    }
  }
  acceptPage(firstPage, 1);
  // Sequential requests, at least one second apart, stop at the first failure.
  for (let page = 2; page <= totalPages; page += 1) {
    await wait(1000);
    acceptPage(await loadPageImpl(page), page);
  }
  if (rawByUuid.size !== totalResults) throw new Error(`Incomplete Trussell snapshot: ${rawByUuid.size}/${totalResults} identities`);
  await wait(1000);
  const bracket = await loadPageImpl(1);
  if (bracket.page !== 1 || bracket.totalPages !== totalPages || bracket.totalResults !== totalResults ||
      JSON.stringify(stableValue(bracket.records)) !== JSON.stringify(stableValue(firstPage.records))) {
    throw new Error("Trussell first page changed during collection; refusing an unstable snapshot");
  }
  return { rawByUuid, totalPages, totalResults };
}

const SOURCE_FIELDS = ["name", "city", "lat", "lng", "address", "phone", "email", "providerUrl", "collectionStatus", "collectionStatusCheckedOn", "sourceUrl", "lastChecked"];

export function prepareTrussellResources(snapshot, checkedOn, previousResources = []) {
  const previousById = new Map(previousResources.map((record) => [record.id, record]));
  const exclusions = {};
  const resources = [];
  for (const { record, page } of snapshot.rawByUuid.values()) {
    const reason = publicationExclusion(record);
    if (reason) {
      exclusions[reason] = (exclusions[reason] || 0) + 1;
      continue;
    }
    const resource = makeResource(record, page, checkedOn);
    const previous = previousById.get(resource.id);
    // Older generated records carry the referral mode only in these exact
    // instructions. Do not retain a superseded mode while advancing its check.
    const referralInstructions = [
      "Call the food bank or an approved referral partner to arrange a voucher before collection.",
      "Use the provider page or an approved referral partner to arrange a voucher before collection."
    ];
    if (referralInstructions.some((instruction) => previous?.availabilityNote?.includes(instruction) && !resource.availabilityNote.includes(instruction))) {
      throw new Error(`Changed referral instructions for ${resource.id} require editorial reconciliation before refresh.`);
    }
    resources.push(preserveReviewedFields(resource, previous, SOURCE_FIELDS));
  }
  if (resources.length < MIN_EXPECTED_PUBLISHED_RECORDS) throw new Error(`Only ${resources.length} publishable Trussell centres remained after privacy/location validation`);
  resources.sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.id.localeCompare(b.id));
  return { resources, exclusions };
}

export function renderTrussellSnapshot(snapshot, resources, exclusions, checkedOn) {
const { rawByUuid, totalResults, totalPages } = snapshot;
const header = `// Generated by scripts/refresh-trussell-foodbanks.mjs from Trussell's official food-bank finder.\n// Do not hand edit; rerun npm run refresh:data:trussell.\n`;
const metadata = {
  reportedSourceRecords: totalResults,
  parsedSourceRecords: rawByUuid.size,
  publishedRecords: resources.length,
  totalPages,
  checkedOn,
  excludedRecords: rawByUuid.size - resources.length,
  exclusionReasons: exclusions
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
const preservedFields = Object.fromEntries(resources.map((resource) => {
  const source = rawByUuid.get(resource.sourceRecordId);
  const generated = makeResource(source.record, source.page, checkedOn);
  return [resource.id, Object.fromEntries(Object.entries(resource).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(generated[key])))];
}).filter(([, fields]) => Object.keys(fields).length));
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

const preservedFields = ${JSON.stringify(preservedFields)};
export const trussellFoodbankResources = rows.map((row) => {
  const resource = fromRow(row);
  return { ...resource, ...preservedFields[resource.id] };
});`;
const output = `${header}export const trussellFoodbankMetadata = ${JSON.stringify(metadata, null, 2)};\n\n${runtime}\n`;
return output;
}

export async function refreshTrussell({ loadPageImpl, wait, checkedOn = new Date().toISOString().slice(0, 10), previousResources, writeOutput } = {}) {
  const snapshot = await fetchTrussellSnapshot({ loadPageImpl, wait });
  const { resources, exclusions } = prepareTrussellResources(snapshot, checkedOn, previousResources);
  assertReviewedMembership(resources, previousResources);
  const output = renderTrussellSnapshot(snapshot, resources, exclusions, checkedOn);
  if (writeOutput) await writeOutput(output);
  return { resources, exclusions, output, totalResults: snapshot.totalResults, totalPages: snapshot.totalPages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = await readFile(OUTPUT);
  const { trussellFoodbankResources } = await import(OUTPUT.href);
  const result = await refreshTrussell({
    previousResources: trussellFoodbankResources,
    writeOutput: (output) => replaceSourceSnapshot(OUTPUT, before, output)
  });
  console.log(`Generated ${result.resources.length} Trussell centres from all ${result.totalResults} identities across ${result.totalPages} pages.`);
  console.log(`Publication exclusions: ${JSON.stringify(result.exclusions)}. This is source reconciliation, not a database insertion or closure decision.`);
}
