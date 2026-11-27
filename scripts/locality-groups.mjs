import { isContactOnly } from "../src/utils/resource-location.js";
import { resourceScope } from "../src/utils/resource-scope.js";

// Build-only geography grouping shared by local pages and their search scopes.
// Retain unqualified records when the city/country has at most one known area.
// When it has multiple known areas, exclude unqualified records rather than
// guessing a state/province. This groups records without changing their facts.
function locality(resource) {
  // Coverage text and an optional city are never evidence of a service site.
  if (isContactOnly(resource)) return null;
  const { type, city, country, administrativeArea } = resourceScope(resource);
  if (type !== "municipal") return null;
  return { city, country, administrativeArea };
}

export function localitySignature({ city, country, administrativeArea }) {
  return `${country}\u0000${administrativeArea || ""}\u0000${city}`;
}

export function groupLocalities(resources) {
  const baseGroups = new Map();
  for (const resource of resources) {
    const info = locality(resource);
    if (!info) continue;
    const baseKey = `${info.city}\u0000${info.country}`;
    if (!baseGroups.has(baseKey)) baseGroups.set(baseKey, []);
    baseGroups.get(baseKey).push({ resource, info });
  }

  const groups = [];
  for (const [baseKey, entries] of baseGroups) {
    const knownAreas = [...new Set(entries.map(({ info }) => info.administrativeArea).filter(Boolean))];
    const ambiguousBase = knownAreas.length > 1;
    const byArea = new Map();

    for (const entry of entries) {
      const key = ambiguousBase ? entry.info.administrativeArea : "";
      if (ambiguousBase && !key) continue;
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key).push(entry);
    }

    for (const [, areaEntries] of byArea) {
      const info = { ...areaEntries[0].info };
      if (!ambiguousBase) info.administrativeArea = knownAreas.length === 1 ? knownAreas[0] : info.administrativeArea;
      groups.push({ baseKey, ambiguousBase, info, items: areaEntries.map(({ resource }) => resource) });
    }
  }

  return groups;
}
