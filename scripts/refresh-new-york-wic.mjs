import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertReviewedMembership, preserveReviewedFields, replaceSourceSnapshot } from "./source-refresh-safety.mjs";

const DATA_URL = "https://health.data.ny.gov/resource/g4i5-r6zx.json";
const METADATA_URL = "https://health.data.ny.gov/api/views/g4i5-r6zx.json";
const SOURCE_URL = "https://health.data.ny.gov/Health/Women-Infants-and-Children-WIC-Program-Site-Inform/g4i5-r6zx";
const OUTPUT = new URL("../src/data/generated/new-york-wic.js", import.meta.url);
const SOURCE_FIELDS = ["name", "city", "lat", "lng", "address", "phone", "providerUrl", "sourceUrl", "sourceUpdatedAt", "lastChecked"];
export const NEW_YORK_WIC_PAGE_SIZE = 500;
export const NEW_YORK_WIC_MAX_ROWS = 10000;

function clean(value) {
  return String(value || "")
    .replaceAll("&", " and ")
    .replace(/[<>"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sourceId(row) {
  if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.site_number !== "string" || !row.site_number.trim()) {
    throw new Error("New York WIC row is missing a valid source site_number.");
  }
  return row.site_number.trim();
}

function validDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error(`New York WIC ${label} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

async function requestJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
    headers: { "User-Agent": "RealWorldNeeds data refresh; source-attributed public service directory" }
  });
  if (!response.ok) throw new Error(`New York WIC ${label} returned ${response.status}.`);
  return response.json();
}

async function fetchMetadata(fetchImpl) {
  const metadata = await requestJson(fetchImpl, METADATA_URL, "metadata");
  const rowsUpdatedAt = metadata?.rowsUpdatedAt;
  if (!Number.isSafeInteger(rowsUpdatedAt) || rowsUpdatedAt <= 0 || !Number.isFinite(new Date(rowsUpdatedAt * 1000).getTime())) {
    throw new Error("New York WIC metadata is missing a valid rowsUpdatedAt timestamp.");
  }
  const sourceUpdatedAt = validDate(new Date(rowsUpdatedAt * 1000).toISOString().slice(0, 10), "source update");
  return { rowsUpdatedAt, sourceUpdatedAt };
}

async function fetchCount(fetchImpl) {
  const url = new URL(DATA_URL);
  url.searchParams.set("$select", "count(*)");
  const result = await requestJson(fetchImpl, url, "count");
  const count = Array.isArray(result) && result.length === 1 ? result[0]?.count : undefined;
  if ((typeof count !== "string" && typeof count !== "number") || !/^\d+$/.test(String(count)) || !Number.isSafeInteger(Number(count)) || Number(count) > NEW_YORK_WIC_MAX_ROWS) {
    throw new Error(`New York WIC count must be an exact nonnegative integer no greater than ${NEW_YORK_WIC_MAX_ROWS}.`);
  }
  return Number(count);
}

async function fetchPage(fetchImpl, offset) {
  const url = new URL(DATA_URL);
  url.searchParams.set("$limit", String(NEW_YORK_WIC_PAGE_SIZE));
  url.searchParams.set("$offset", String(offset));
  url.searchParams.set("$order", "site_number");
  const rows = await requestJson(fetchImpl, url, `page at offset ${offset}`);
  if (!Array.isArray(rows)) throw new Error(`New York WIC page at offset ${offset} is not an array.`);
  return rows;
}

// Completeness is checked against every source identity before any publication
// filtering. A changing or partial feed cannot authorize replacement/withholding.
export async function fetchNewYorkWicSnapshot({ fetchImpl = fetch } = {}) {
  const initialMetadata = await fetchMetadata(fetchImpl);
  const expectedRows = await fetchCount(fetchImpl);
  const rows = [];
  const identities = new Set();
  let pagesFetched = 0;
  for (let offset = 0; offset < expectedRows; offset += NEW_YORK_WIC_PAGE_SIZE) {
    const page = await fetchPage(fetchImpl, offset);
    pagesFetched += 1;
    const expectedPageSize = Math.min(NEW_YORK_WIC_PAGE_SIZE, expectedRows - offset);
    if (page.length !== expectedPageSize) {
      throw new Error(`New York WIC incomplete page at offset ${offset}: expected ${expectedPageSize} rows, received ${page.length}.`);
    }
    for (const row of page) {
      const id = sourceId(row);
      if (identities.has(id)) throw new Error(`New York WIC duplicate source site_number ${id}.`);
      // site_number is an official text column (currently fixed-width digits
      // and hyphens). Require ascending text order instead of sorting away
      // evidence of unstable pagination; changed collation fails for review.
      if (rows.length > 0 && id < sourceId(rows.at(-1))) {
        throw new Error(`New York WIC source site_number order changed at ${id}.`);
      }
      identities.add(id);
      rows.push(row);
    }
  }
  const overflow = await fetchPage(fetchImpl, expectedRows);
  if (overflow.length !== 0) throw new Error("New York WIC overflow page was not empty; refusing a changing or incomplete snapshot.");
  const finalCount = await fetchCount(fetchImpl);
  const finalMetadata = await fetchMetadata(fetchImpl);
  if (expectedRows !== finalCount || initialMetadata.rowsUpdatedAt !== finalMetadata.rowsUpdatedAt) {
    throw new Error("New York WIC count or metadata changed during collection; refusing an unstable snapshot.");
  }
  if (rows.length !== expectedRows || identities.size !== expectedRows) {
    throw new Error("New York WIC raw source identity coverage does not match the official count.");
  }
  return {
    rows,
    sourceUpdatedAt: initialMetadata.sourceUpdatedAt,
    audit: { expectedRows, uniqueRawIds: identities.size, rowsUpdatedAt: initialMetadata.rowsUpdatedAt, pageSize: NEW_YORK_WIC_PAGE_SIZE, pagesFetched, overflowRows: 0 }
  };
}

function coordinate(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return { reason: "missing-coordinates" };
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) || !Number.isFinite(Number(value))) return { reason: "invalid-coordinates" };
  return { value: Number(value) };
}

export function classifyNewYorkWicRow(row) {
  sourceId(row);
  if (row.site_type === "Administrative") return { eligible: false, reason: "administrative-site" };
  if (row.site_type === "Vendor Management Agency") return { eligible: false, reason: "vendor-management-agency" };
  if (row.site_type !== "Permanent" && row.site_type !== "Temporary") {
    throw new Error(`New York WIC unrecognized site_type for ${sourceId(row)}: ${JSON.stringify(row.site_type)}.`);
  }
  if (typeof row.street_address !== "string" || !clean(row.street_address)) return { eligible: false, reason: "missing-street-address" };
  const latitude = coordinate(row.location_1?.latitude);
  const longitude = coordinate(row.location_1?.longitude);
  if (latitude.reason || longitude.reason) return { eligible: false, reason: latitude.reason || longitude.reason };
  // Conservative New York bounding box. This catches swapped, zero-coerced,
  // world-valid but clearly non-NY points; it does not claim parcel verification.
  if (latitude.value < 40 || latitude.value > 45.1 || longitude.value < -80 || longitude.value > -71.7) {
    return { eligible: false, reason: "outside-new-york-bounds" };
  }
  return { eligible: true, lat: latitude.value, lng: longitude.value };
}

export function makeNewYorkWicResource(row, { checkedOn, sourceUpdatedAt } = {}) {
  const classification = classifyNewYorkWicRow(row);
  if (!classification.eligible) return null;
  validDate(checkedOn, "check");
  validDate(sourceUpdatedAt, "source update");
  const { lat, lng } = classification;
  const id = slug(sourceId(row));
  if (!id) throw new Error("New York WIC source site_number cannot produce a valid resource ID.");
  const temporary = row.site_type === "Temporary";
  const address = [row.street_address, row.street2, row.city, row.state, row.zip].map(clean).filter(Boolean).join(", ");
  const providerUrl = typeof row.link_to_website?.url === "string" && row.link_to_website.url.startsWith("https://") ? row.link_to_website.url : null;
  return {
    id: `ny-wic-${id}`,
    name: `${clean(row.agency_name)} — ${clean(row.city)} WIC`,
    city: clean(row.city),
    country: "United States",
    region: "North America",
    lat,
    lng,
    category: "food",
    secondaryCategories: ["health", "referral"],
    kind: "direct",
    locationPrecision: "exact",
    accessType: temporary ? "Temporary WIC service site; call before visiting" : "Permanent WIC service site; call to apply or schedule",
    costNote: "Free WIC benefits and support for eligible participants",
    address,
    ...(row.phone_number ? { phone: clean(row.phone_number) } : {}),
    ...(providerUrl ? { providerUrl } : {}),
    summary: "A New York WIC service site offering nutrition support and healthy foods to eligible pregnant, breastfeeding, or postpartum people, infants, and children under five.",
    services: ["Healthy foods through WIC", "Nutrition education", "Breastfeeding support", "Health and social-service referrals"],
    eligibility: "New York residents who are pregnant, recently pregnant, or breastfeeding, plus infants and children under five, subject to WIC eligibility requirements.",
    availabilityNote: temporary ? "The state identifies this as a temporary site and warns that temporary locations and limited hours can change on short notice. Call before travel." : "The state dataset does not include office hours. Call before travel to confirm hours, appointment availability, and documents needed.",
    sourceName: "New York State Department of Health",
    sourceKind: "Official state health open-data record",
    sourceUrl: SOURCE_URL,
    sourceDetail: "The state WIC dataset publishes the site name, address, phone, site type, counties served, and map location; it is posted on a quarterly schedule.",
    datasetId: "new-york-wic-sites",
    sourceRecordId: clean(row.site_number),
    sourceUpdatedAt,
    verificationMethod: "official-open-data-snapshot",
    coordinateNote: "Coordinates are published in the New York State WIC Program Site Information dataset.",
    lastChecked: checkedOn
  };
}

export async function refreshNewYorkWic({ fetchImpl = fetch, writeOutput, checkedOn = new Date().toISOString().slice(0, 10), minimumRecords = 250, previousResources } = {}) {
  validDate(checkedOn, "check");
  if (!Number.isSafeInteger(minimumRecords) || minimumRecords < 0) throw new Error("New York WIC minimumRecords must be a nonnegative integer.");
  const previousById = new Map((previousResources || []).map((resource) => [resource.id, resource]));
  if (previousById.size !== (previousResources || []).length) throw new Error("New York WIC previous snapshot contains duplicate resource IDs.");
  const snapshot = await fetchNewYorkWicSnapshot({ fetchImpl });
  const records = [];
  const exclusions = [];
  const exclusionCounts = {};
  for (const row of snapshot.rows) {
    const classification = classifyNewYorkWicRow(row);
    if (!classification.eligible) {
      exclusions.push({ sourceRecordId: sourceId(row), reason: classification.reason });
      exclusionCounts[classification.reason] = (exclusionCounts[classification.reason] || 0) + 1;
      continue;
    }
    const candidate = makeNewYorkWicResource(row, { checkedOn, sourceUpdatedAt: snapshot.sourceUpdatedAt });
    records.push(preserveReviewedFields(candidate, previousById.get(candidate.id), SOURCE_FIELDS));
  }
  const ids = new Set(records.map((record) => record.id));
  if (records.length < minimumRecords || ids.size !== records.length) {
    throw new Error(`New York WIC refresh produced ${records.length} records and ${ids.size} unique IDs; refusing to publish.`);
  }
  assertReviewedMembership(records, previousResources);
  records.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const audit = { ...snapshot.audit, sourceUpdatedAt: snapshot.sourceUpdatedAt, checkedOn, publishedRecords: records.length, excludedRecords: exclusions.length, exclusionCounts, exclusions };
  const output = `// Generated by scripts/refresh-new-york-wic.mjs from the official NYSDOH open-data endpoint.\n// Do not hand edit; rerun npm run refresh:data:ny-wic.\nexport const newYorkWicResources = ${JSON.stringify(records, null, 2)};\n`;
  if (writeOutput) await writeOutput(output);
  return { records, audit, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = await readFile(OUTPUT);
  const { newYorkWicResources } = await import(OUTPUT.href);
  const result = await refreshNewYorkWic({
    previousResources: newYorkWicResources,
    writeOutput: (output) => replaceSourceSnapshot(OUTPUT, before, output)
  });
  console.log(`Refreshed ${result.records.length} New York WIC sites from NYSDOH open data; excluded ${result.audit.excludedRecords} of ${result.audit.expectedRows} source rows.`);
  console.log(JSON.stringify(result.audit, null, 2));
}
