import { categories, resources } from "../src/data/resources.js";
import { freeAccessModels } from "../src/data/free-access.js";
import { sourceRegistry } from "../src/data/live-sources.js";
import { platformStatus, publicLedger } from "../src/data/platform.js";

const required = [
  "id",
  "name",
  "city",
  "country",
  "region",
  "lat",
  "lng",
  "category",
  "address",
  "summary",
  "kind",
  "accessType",
  "costNote",
  "costModel",
  "availabilityNote",
  "sourceKind",
  "services",
  "sourceName",
  "sourceUrl",
  "sourceDetail",
  "lastChecked"
];

const ids = new Set();
const datasetRecords = new Set();
for (const resource of resources) {
  for (const field of required) {
    if (resource[field] === undefined || resource[field] === "") {
      throw new Error(`${resource.id || "Unknown resource"} is missing ${field}.`);
    }
  }

  if (ids.has(resource.id)) throw new Error(`Duplicate resource id: ${resource.id}`);
  ids.add(resource.id);

  if (!categories[resource.category]) throw new Error(`Unknown category: ${resource.category}`);
  if (!["direct", "locator", "network"].includes(resource.kind)) {
    throw new Error(`Unknown resource kind: ${resource.id}`);
  }
  for (const type of resource.secondaryCategories || []) {
    if (!categories[type]) throw new Error(`Unknown secondary category: ${type}`);
  }
  const secondary = resource.secondaryCategories || [];
  if (new Set(secondary).size !== secondary.length || secondary.includes(resource.category)) {
    throw new Error(`Resource categories must be unique and non-repeating: ${resource.id}`);
  }
  if (!freeAccessModels[resource.costModel]) {
    throw new Error(`Unknown free-access model: ${resource.id}`);
  }
  if (!/\bfree\b|\bno[- ]cost\b|\bwithout (?:a )?fee\b|\bwithout paying\b|including nothing/i.test(resource.costNote)) {
    throw new Error(`No-cost status is not explicit: ${resource.id}`);
  }
  if (resource.kind === "direct" && resource.costModel === "free-navigation") {
    throw new Error(`Direct sites cannot be classified only as free navigation: ${resource.id}`);
  }
  if (resource.costModel !== "free-navigation" && /\blow[- ]cost\b|\bsliding fee\b|\bprices? apply\b|\bcharges? apply\b/i.test(resource.costNote)) {
    throw new Error(`Paid-service language is not allowed in a free-service record: ${resource.id}`);
  }

  if (!resource.sourceUrl.startsWith("https://")) throw new Error(`Source must use HTTPS: ${resource.id}`);
  if (!Array.isArray(resource.services) || resource.services.length === 0) {
    throw new Error(`Services must be a non-empty array: ${resource.id}`);
  }
  if (resource.lat < -90 || resource.lat > 90 || resource.lng < -180 || resource.lng > 180) {
    throw new Error(`Invalid coordinates: ${resource.id}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resource.lastChecked)) {
    throw new Error(`Invalid review date: ${resource.id}`);
  }
  if (resource.kind === "direct" && resource.locationPrecision && resource.locationPrecision !== "exact") {
    throw new Error(`Direct site must have exact location semantics: ${resource.id}`);
  }
  if (resource.datasetId) {
    if (!resource.sourceRecordId || !resource.verificationMethod) {
      throw new Error(`Dataset record is missing provenance fields: ${resource.id}`);
    }
    const sourceKey = `${resource.datasetId}:${resource.sourceRecordId}`;
    if (datasetRecords.has(sourceKey)) throw new Error(`Duplicate dataset source record: ${sourceKey}`);
    datasetRecords.add(sourceKey);
  }
  for (const dateField of ["sourceUpdatedAt", "validFrom", "validThrough"]) {
    if (resource[dateField] && !/^\d{4}-\d{2}-\d{2}$/.test(resource[dateField])) {
      throw new Error(`Invalid ${dateField}: ${resource.id}`);
    }
  }
  if (resource.validFrom && resource.validThrough && resource.validThrough < resource.validFrom) {
    throw new Error(`Active date range is reversed: ${resource.id}`);
  }
}

console.log(`Validated ${resources.length} source-backed resources.`);

const sourceIds = new Set();
for (const source of sourceRegistry) {
  if (!source.id || !source.title || !source.owner || !source.sourceUrl?.startsWith("https://") || !source.mode || !source.auditedAt) {
    throw new Error(`Invalid source registry entry: ${source.id || "unknown"}`);
  }
  if (sourceIds.has(source.id)) throw new Error(`Duplicate source registry ID: ${source.id}`);
  sourceIds.add(source.id);
}
for (const datasetId of new Set(resources.map((resource) => resource.datasetId).filter(Boolean))) {
  if (!sourceIds.has(datasetId)) throw new Error(`Dataset has no source registry entry: ${datasetId}`);
}

console.log(`Validated ${sourceRegistry.length} provenance registry entries.`);

if (platformStatus.donationProcessingEnabled || publicLedger.length > 0) {
  throw new Error("Donation processing or ledger data cannot be enabled without verified operations.");
}

console.log("Validated truthful platform launch state.");
