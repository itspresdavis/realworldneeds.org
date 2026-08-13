import { mkdir, readFile, writeFile } from "node:fs/promises";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const normalize = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9+]+/g, " ")
  .trim();

const slugify = (value) => String(value || "unknown")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "unknown";

const allTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];

function administrativeArea(resource) {
  const address = String(resource.address || "");
  if (resource.country === "United States") return address.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/)?.[1] || "";
  if (resource.country === "Canada") return address.match(/,\s*([A-Z]{2})\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i)?.[1]?.toUpperCase() || "";
  return "";
}

let localIndex = { cities: [] };
try {
  localIndex = JSON.parse(await readFile("dist/data/resources/local-index.json", "utf8"));
} catch {
  // The global/country/region/category search index remains useful without local SEO pages.
}

function scopesFor(resource, types) {
  const scopes = new Set([
    `/directory/${slugify(resource.country)}`,
    ...types.map((type) => `/directory/help/${slugify(type)}`)
  ]);
  if (resource.region) scopes.add(`/directory/region/${slugify(resource.region)}`);

  const area = administrativeArea(resource);
  for (const locality of localIndex.cities || []) {
    if (locality.city !== resource.city || locality.country !== resource.country) continue;
    if (locality.administrativeArea && locality.administrativeArea !== area) continue;
    scopes.add(locality.path);
    for (const category of locality.categories || []) {
      if (types.includes(category.type)) scopes.add(category.path);
    }
  }
  return scopes;
}

const scopes = Object.create(null);
const records = resources.map((resource, index) => {
  const types = allTypes(resource);
  const labels = types.map((type) => categories[type]?.label || type);
  const place = formatResourcePlace(resource);
  const search = normalize([
    resource.name,
    resource.city,
    resource.country,
    resource.region,
    resource.address,
    resource.sourceName,
    ...(resource.services || []),
    ...types,
    ...labels
  ].join(" "));

  for (const scope of scopesFor(resource, types)) {
    (scopes[scope] ||= []).push(index);
  }

  return {
    id: resource.id,
    name: resource.name,
    place,
    country: resource.country,
    category: resource.category,
    categories: types,
    categoryLabels: labels,
    kind: resource.kind,
    phone: resource.phone || "",
    lat: Number.isFinite(resource.lat) ? resource.lat : null,
    lng: Number.isFinite(resource.lng) ? resource.lng : null,
    checked: resource.lastChecked,
    search
  };
});

await mkdir("dist/data", { recursive: true });
await writeFile("dist/data/search-index.json", `${JSON.stringify({
  schemaVersion: "1.3",
  resourceCount: records.length,
  privacy: "Static search index. Search terms remain in the visitor's browser and are not included in requests.",
  records,
  scopes
})}\n`);
