import { categories, resources } from "../src/data/resources.js";

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
  "services",
  "sourceName",
  "sourceUrl",
  "sourceDetail",
  "lastChecked"
];

const ids = new Set();
for (const resource of resources) {
  for (const field of required) {
    if (resource[field] === undefined || resource[field] === "") {
      throw new Error(`${resource.id || "Unknown resource"} is missing ${field}.`);
    }
  }

  if (ids.has(resource.id)) throw new Error(`Duplicate resource id: ${resource.id}`);
  ids.add(resource.id);

  if (!categories[resource.category]) throw new Error(`Unknown category: ${resource.category}`);
  for (const type of resource.secondaryCategories || []) {
    if (!categories[type]) throw new Error(`Unknown secondary category: ${type}`);
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
}

console.log(`Validated ${resources.length} source-backed resources.`);
