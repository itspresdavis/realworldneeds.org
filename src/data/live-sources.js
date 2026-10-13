const USDA_LAYER_URL = "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/Summer_Meals_Site_Finder_2026_(Testing)/FeatureServer/0/query";
const USDA_PUBLIC_URL = "https://www.fns.usda.gov/summer/sitefinder";
const SOURCE_TIMEOUT_MS = 7000;
const SOURCE_RETRY_DELAYS_MS = [250, 750];
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60000;

const usdaCircuit = {
  failures: 0,
  openUntil: 0
};

export const sourceRegistry = [
  {
    id: "usda-summer-meals-2026",
    title: "USDA Summer Meals for Kids Site Finder — 2026",
    owner: "U.S. Department of Agriculture, Food and Nutrition Service",
    sourceUrl: USDA_PUBLIC_URL,
    dataUrl: USDA_LAYER_URL,
    mode: "live-nearby-query",
    updateFrequency: "State agencies submit at least three times each summer; USDA says its public finder is updated every Friday during the season.",
    accessStandard: "Only geocoded records scoring at least 80, not marked dropped, and active on the search date are returned.",
    locationPrivacy: "RWN rounds a user-approved location to one decimal degree before querying a 160 km search radius. Exact device coordinates stay in browser memory.",
    activeRecordsAtAudit: 17442,
    massachusettsActiveRecordsAtAudit: 637,
    auditedAt: "2026-08-05",
    reuseBasis: "Public official map endpoint. RWN queries bounded results live with attribution instead of republishing the full federal feed as a static copy."
  },
  {
    id: "massachusetts-wic-locations",
    title: "Massachusetts WIC locations",
    owner: "Massachusetts Department of Public Health",
    sourceUrl: "https://www.mass.gov/wic-information-for-participants/locations",
    mode: "reviewed-snapshot",
    updateFrequency: "Refreshed from the current official Mass.gov directory before publication.",
    recordCount: 101,
    auditedAt: "2026-08-05",
    fields: ["official map coordinates", "address", "phone", "published hours", "accessibility when stated", "official location page"],
    reuseBasis: "Public state location directory with record-level attribution and direct links back to each Mass.gov location page."
  },
  {
    id: "new-york-wic-sites",
    title: "New York State WIC Program Site Information",
    owner: "New York State Department of Health",
    sourceUrl: "https://health.data.ny.gov/Health/Women-Infants-and-Children-WIC-Program-Site-Inform/g4i5-r6zx",
    mode: "reviewed-open-data-snapshot",
    updateFrequency: "Quarterly",
    sourceUpdatedAt: "2026-04-30",
    recordCount: 293,
    auditedAt: "2026-08-05",
    fields: ["state-published coordinates", "address", "phone", "permanent or temporary site type", "provider website when supplied"],
    reuseBasis: "Official public state health open-data endpoint with dataset attribution."
  },
  {
    id: "trussell-food-bank-centres",
    title: "Trussell food-bank centres",
    owner: "Trussell",
    sourceUrl: "https://www.trussell.org.uk/emergency-food/get-a-food-voucher/choose-a-foodbank",
    mode: "reviewed-official-network-snapshot",
    updateFrequency: "Refreshable from the current official Trussell finder; RWN's generator fails closed if the source becomes materially incomplete or changes format.",
    recordCount: 1373,
    sourceReportedRecordsAtAudit: 1390,
    sourceParsedRecordsAtAudit: 1388,
    excludedForPublicationAtAudit: 15,
    auditedAt: "2026-10-10",
    fields: ["Trussell-published coordinates", "public address", "town and postcode", "phone and email when supplied", "referral route", "collection or delivery status", "provider page"],
    reuseBasis: "Official Trussell finder snapshot with record-level UUIDs and attribution. RWN excludes hidden-address records and records that fail exact-location or publication checks."
  }
];

function isoDay(date = new Date()) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("A valid date is required for the USDA query.");
  return parsed.toISOString().slice(0, 10);
}

function activeWhere(date) {
  const day = isoDay(date);
  return `Score >= 80 AND Dropped = 'False' AND Start_date <= timestamp '${day} 23:59:59' AND End_date >= timestamp '${day} 00:00:00'`;
}

function queryUrl(parameters) {
  const url = new URL(USDA_LAYER_URL);
  for (const [key, value] of Object.entries({ f: "json", ...parameters })) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

export function buildUsdaActiveCountUrl(date = new Date()) {
  return queryUrl({ where: activeWhere(date), returnCountOnly: true });
}

export function roundedSearchPoint(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new TypeError("Valid latitude and longitude are required.");
  }
  return { lat: Number(lat.toFixed(1)), lng: Number(lng.toFixed(1)) };
}

export function buildUsdaNearbyUrl(location, date = new Date()) {
  const point = roundedSearchPoint(location);
  return queryUrl({
    where: activeWhere(date),
    geometry: JSON.stringify({ x: point.lng, y: point.lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    distance: 160,
    units: "esriSRUnit_Kilometer",
    outSR: 4326,
    returnGeometry: true,
    resultRecordCount: 1000,
    orderByFields: "FID ASC",
    outFields: [
      "FID", "MasterID", "Site_Name", "Site_Address1", "Site_Address2", "Site_City", "Site_State", "Site_Zip",
      "Site_Phone", "Contact_Phone", "Sponsoring_Organization", "Start_date", "End_date", "Days_of_operation",
      "Breakfast_Time2", "Lunch_Time2", "Snack_Time_AM2", "Snack_Time_PM2", "Dinner_Supper_Time2",
      "Site_Program", "Service_Model", "State_Site_ID_Number", "Score"
    ].join(",")
  });
}

function clean(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value || "")
    .replaceAll("&", " and ")
    .replace(/[<>"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceId(attributes) {
  return clean(attributes.MasterID || attributes.State_Site_ID_Number || attributes.FID)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ArcGIS date fields are numeric Unix milliseconds. Absent dates stay unknown;
// supplied values must be finite and representable before formatting.
function validSourceDate(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function displayDate(value) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(value));
}

function sourceDate(value) {
  return value == null ? null : new Date(value).toISOString().split("T")[0];
}

function daysLabel(value) {
  const labels = { M: "Mon", T: "Tue", W: "Wed", TH: "Thu", F: "Fri", SA: "Sat", S: "Sun", SU: "Sun" };
  return clean(value).split(",").map((day) => labels[day.trim().toUpperCase()] || day.trim()).filter(Boolean).join(", ");
}

function mealTimes(attributes) {
  return [
    ["Breakfast", attributes.Breakfast_Time2],
    ["Lunch", attributes.Lunch_Time2],
    ["Morning snack", attributes.Snack_Time_AM2],
    ["Afternoon snack", attributes.Snack_Time_PM2],
    ["Dinner", attributes.Dinner_Supper_Time2]
  ].flatMap(([label, value]) => {
    const time = clean(value);
    return !time || /^0?0:00\s*-\s*0?0:00$/.test(time) ? [] : [`${label} ${time}`];
  });
}

export function usdaFeatureToResource(feature, checkedAt = new Date()) {
  const attributes = feature?.attributes || {};
  const lat = feature?.geometry?.y;
  const lng = feature?.geometry?.x;
  const id = sourceId(attributes);
  const name = clean(attributes.Site_Name);
  const city = clean(attributes.Site_City);
  const state = clean(attributes.Site_State);
  const zip = clean(attributes.Site_Zip);
  const street = [attributes.Site_Address1, attributes.Site_Address2].map(clean).filter(Boolean).join(", ");
  if (!id || !name || !city || !state || !street || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const start = attributes.Start_date, end = attributes.End_date;
  if ((start != null && !validSourceDate(start)) || (end != null && !validSourceDate(end)) || (start != null && end != null && start > end)) return null;

  const times = mealTimes(attributes);
  const days = daysLabel(attributes.Days_of_operation);
  const validFrom = sourceDate(attributes.Start_date);
  const validThrough = sourceDate(attributes.End_date);
  const model = clean(attributes.Service_Model).toUpperCase();
  const toGo = model.includes("NON-CONGREGATE");
  const phone = clean(attributes.Site_Phone || attributes.Contact_Phone);
  const serviceWindow = [validFrom && displayDate(attributes.Start_date), validThrough && displayDate(attributes.End_date)].filter(Boolean).join("–");

  return {
    id: `usda-summer-2026-${id}`,
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
    costModel: "free-eligible",
    accessType: toGo ? "Free summer meals to go for children 18 and younger" : "Free summer meals served on site for children 18 and younger",
    costNote: "Free for children and teens age 18 and younger",
    address: [street, city, state, zip].filter(Boolean).join(", "),
    ...(phone ? { phone } : {}),
    ...((days || times.length) ? { hours: [days, ...times].filter(Boolean).join(" · ") } : {}),
    summary: `${toGo ? "A current USDA-listed summer meals pickup site" : "A current USDA-listed summer meal site"} providing free food to children and teens age 18 and younger.`,
    services: [toGo ? "Summer meals to go" : "Eat-on-site summer meals", ...times.map((time) => time.replace(/\s+\d.*$/, " service"))],
    eligibility: "Children and teens age 18 and younger. Contact the site about local meal-service instructions.",
    availabilityNote: `Seasonal service${serviceWindow ? ` published for ${serviceWindow}` : ""}. USDA says state agencies update the finder throughout summer; confirm the current day and meal time before travel.`,
    sourceName: "USDA Food and Nutrition Service",
    sourceKind: "Live federal site finder populated by state agencies",
    sourceUrl: USDA_PUBLIC_URL,
    sourceDetail: "State agencies submit approved summer meal locations and operating details to USDA. This record was loaded live and was active on the search date.",
    datasetId: "usda-summer-meals-2026",
    sourceRecordId: clean(attributes.MasterID || attributes.State_Site_ID_Number || attributes.FID),
    ...(validFrom ? { validFrom } : {}),
    ...(validThrough ? { validThrough } : {}),
    verificationMethod: "live-official-feed",
    coordinateNote: `The point is published in USDA's official 2026 layer and passed its public map's geocoding-quality threshold${Number.isFinite(attributes.Score) ? ` (score ${attributes.Score.toFixed(0)})` : ""}. Confirm the written address before travel.`,
    lastChecked: isoDay(checkedAt)
  };
}

function abortReason(signal) {
  return signal.reason || new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function sleep(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(abortReason(signal)); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function payloadError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function circuitError() {
  const error = new Error("The official USDA source is temporarily unavailable. RWN's reviewed directory remains available.");
  error.code = "RWN_SOURCE_CIRCUIT_OPEN";
  return error;
}

function registerSourceSuccess() {
  usdaCircuit.failures = 0;
  usdaCircuit.openUntil = 0;
}

function registerSourceFailure() {
  usdaCircuit.failures += 1;
  if (usdaCircuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    usdaCircuit.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  }
}

export function resetUsdaCircuitForTests() {
  usdaCircuit.failures = 0;
  usdaCircuit.openUntil = 0;
}

// The same seven-second deadline covers headers, body and validation. Racing
// explicitly also bounds transports/mocks that ignore their AbortSignal. Three
// attempts plus 250/750 ms backoff take at most 22 seconds, subject to scheduling.
async function fetchAttempt(url, fetchImpl, signal, validate) {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timeout, abortFromCaller;
  const interruption = new Promise((_, reject) => {
    const interrupt = reason => { controller.abort(reason); reject(reason); };
    abortFromCaller = () => interrupt(abortReason(signal));
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    timeout = setTimeout(() => {
      const error = new Error("The official USDA source request timed out.");
      error.name = "TimeoutError";
      interrupt(error);
    }, SOURCE_TIMEOUT_MS);
  });
  const work = async () => {
    const response = await fetchImpl(url, { signal: controller.signal, referrerPolicy: "no-referrer" });
    throwIfAborted(controller.signal);
    if (!response.ok) {
      // No denied response body needs to be read, retained or retried.
      controller.abort();
      const error = new Error(`Official source returned ${response.status || "an error"}.`);
      error.status = Number(response.status || 0);
      throw error;
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (error?.name === "SyntaxError") throw payloadError("USDA returned malformed JSON.");
      throw error;
    }
    throwIfAborted(controller.signal);
    if (!isObject(data)) throw payloadError("USDA did not return a valid response object.");
    if (Object.hasOwn(data, "error")) {
      if (!isObject(data.error) || !Number.isSafeInteger(data.error.code)) throw payloadError("USDA returned an invalid error response.");
      const message = typeof data.error.message === "string" && data.error.message ? data.error.message : "Official source query failed.";
      const error = new Error(message);
      error.status = data.error.code;
      throw error;
    }
    return validate(data);
  };
  try {
    return await Promise.race([work(), interruption]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function jsonResponse(url, fetchImpl, signal, validate) {
  throwIfAborted(signal);
  if (Date.now() < usdaCircuit.openUntil) throw circuitError();

  let finalError = null;
  for (let attempt = 0; attempt <= SOURCE_RETRY_DELAYS_MS.length; attempt += 1) {
    throwIfAborted(signal);
    try {
      const result = await fetchAttempt(url, fetchImpl, signal, validate);
      throwIfAborted(signal);
      registerSourceSuccess();
      return result;
    } catch (error) {
      throwIfAborted(signal);
      finalError = error;
      const status = error?.status;
      const retryable = error?.retryable !== false && (status === undefined || isRetryableStatus(status));
      if (!retryable || attempt === SOURCE_RETRY_DELAYS_MS.length) break;
    }
    await sleep(SOURCE_RETRY_DELAYS_MS[attempt], signal);
  }

  throwIfAborted(signal);
  registerSourceFailure();
  throw finalError || new Error("Official source query failed.");
}

export async function fetchUsdaActiveCount({ date = new Date(), fetchImpl = fetch, signal } = {}) {
  return jsonResponse(buildUsdaActiveCountUrl(date), fetchImpl, signal, data => {
    if (!Number.isSafeInteger(data.count) || data.count < 0) throw payloadError("USDA did not return a valid active-site count.");
    return data.count;
  });
}

export async function fetchNearbyUsdaSites(location, { date = new Date(), fetchImpl = fetch, signal } = {}) {
  return jsonResponse(buildUsdaNearbyUrl(location, date), fetchImpl, signal, data => {
    if (!Array.isArray(data.features)) throw payloadError("USDA did not return a valid nearby-site list.");
    if (Object.hasOwn(data, "exceededTransferLimit") && data.exceededTransferLimit !== false) throw payloadError("USDA did not return a complete nearby-site list.");
    const resources = data.features.map(feature => usdaFeatureToResource(feature, date)).filter(Boolean);
    // Keep the existing exclusion of malformed records, but a nonempty source
    // with no usable records cannot establish that no nearby services exist.
    if (data.features.length && !resources.length) throw payloadError("USDA did not return usable nearby-site records.");
    if (new Set(resources.map(resource => resource.id)).size !== resources.length) throw payloadError("USDA returned duplicate nearby-site identities.");
    return resources;
  });
}
