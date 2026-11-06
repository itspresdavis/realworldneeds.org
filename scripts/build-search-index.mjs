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
    category: resource.category,
    categories: types,
    categoryLabels: labels,
    kind: resource.kind,
    phone: resource.phone || "",
    phoneLinks: phoneLinks(resource.phone),
    lat: !isContactOnly(resource) && Number.isFinite(resource.lat) ? resource.lat : null,
    lng: !isContactOnly(resource) && Number.isFinite(resource.lng) ? resource.lng : null,
    checked: resource.lastChecked,
    ...(resource.serviceAccess ? { serviceActions: serviceActions(resource), serviceAccessSummary: serviceAccessSummary(resource) } : {}),
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
  schemaVersion: "1.6",
  resourceCount: records.length,
  privacy: "Static search index. Search terms remain in the visitor's browser and are not included in requests.",
  records,
  scopes
})}\n`);
