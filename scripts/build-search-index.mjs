import { resourceScope } from "../src/utils/resource-scope.js";
import { postalAreas } from "../src/data/generated/postal-areas.js";
import { SEARCH_CATALOG_SCHEMA } from "../public/catalog-request.js";
import { serviceActions, serviceAccessSummary } from "../src/utils/service-access.js";
import { isContactOnly, contactOnlyNotice } from "../src/utils/resource-location.js";
import { resourceSearchText } from "../src/utils/search.js";
import { phoneLinks } from "../src/utils/phone.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace } from "../src/utils/geo.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";
import { groupLocalities, localitySignature } from "./locality-groups.mjs";

const slugify = (value) => String(value || "unknown")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "unknown";

const allTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];

let localIndex = { cities: [] };
try {
  localIndex = JSON.parse(await readFile("dist/data/resources/local-index.json", "utf8"));
} catch {
  // The global/country/region/category search index remains useful without local SEO pages.
}

// Use the same reviewed city membership as the static pages. A group label
// must not become a stricter per-record geography test in the search index.
const localGroups = new Map(groupLocalities(resources).map(group => [localitySignature(group.info), group.items]));
const localScopes = new Map();
for (const locality of localIndex.cities || []) {
  for (const resource of localGroups.get(localitySignature(locality)) || []) {
    const paths = [locality.path, ...(locality.categories || [])
      .filter(category => allTypes(resource).includes(category.type))
      .map(category => category.path)];
    localScopes.set(resource.id, [...(localScopes.get(resource.id) || []), ...paths]);
  }
}

function scopesFor(resource, types) {
  const scopes = new Set([
    `/directory/${slugify(resource.country)}`,
    ...types.map((type) => `/directory/help/${slugify(type)}`)
  ]);
  if (resource.region) scopes.add(`/directory/region/${slugify(resource.region)}`);

  for (const path of localScopes.get(resource.id) || []) scopes.add(path);
  return scopes;
}

const scopes = Object.create(null);
const records = resources.map((resource, index) => {
  const types = allTypes(resource);
  const labels = types.map((type) => categories[type]?.label || type);
  const place = formatResourcePlace(resource);
  const search = resourceSearchText(resource);

  for (const scope of scopesFor(resource, types)) {
    (scopes[scope] ||= []).push(index);
  }

  return {
    id: resource.id,
    name: resource.name,
    place,
    country: resource.country,
    categories: types,
    categoryLabels: labels,
    kind: resource.kind,
    ...(resource.kind !== "direct" ? { coverageScope: resourceScope(resource).type } : {}),
    ...(resource.phone ? { phone: resource.phone } : {}),
    phoneLinks: phoneLinks(resource.phone),
    lat: !Object.hasOwn(resource, "serviceAccess") && !isContactOnly(resource) && Number.isFinite(resource.lat) ? resource.lat : null,
    lng: !Object.hasOwn(resource, "serviceAccess") && !isContactOnly(resource) && Number.isFinite(resource.lng) ? resource.lng : null,
    checked: resource.lastChecked,
    ...(resource.serviceAccess ? { serviceActions: serviceActions(resource).map(({ label, href, kind }) => ({ label, href, kind })), serviceAccessSummary: serviceAccessSummary(resource) } : {}),
    ...(isContactOnly(resource) ? {
      locationPrecision: "contact-only",
      coverageNote: resource.coverageNote,
      eligibility: resource.eligibility,
      locationNotice: contactOnlyNotice(resource),
      ...(resource.phone ? { phoneAccess: resource.phoneAccess } : {}),
      ...(resource.accessUrl ? { accessUrl: resource.accessUrl } : {})
    } : {}),
    ...(sourceClosureNotice(resource) ? { sourceStatus: sourceClosureNotice(resource) } : {}),
    search
  };
});

await mkdir("dist/data", { recursive: true });
await writeFile("dist/data/search-index.json", `${JSON.stringify({
  schemaVersion: SEARCH_CATALOG_SCHEMA,
  resourceCount: records.length,
  privacy: "Static search index. Search terms remain in the visitor's browser and are not included in requests.",
  records,
  scopes
})}\n`);

// Postal reference is optional and fetched only after postal input, never as a
// provider lookup. The offline versioner addresses these exact bytes separately.
await writeFile("dist/data/postal-areas.json", `${JSON.stringify({schemaVersion: "1.0", source: "US Census 2025 Gazetteer ZCTA", areas: postalAreas})}\n`);
