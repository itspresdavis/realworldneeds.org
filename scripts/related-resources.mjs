import { distanceKm, isExactServiceSite } from "../src/utils/geo.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";
import { resourceScope, sameScopedMunicipality } from "../src/utils/resource-scope.js";

const types = (resource) => new Set([resource.category, ...(resource.secondaryCategories || [])]);
const physicalSite = (resource) => resource.kind === "direct" && isExactServiceSite(resource);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

// A country is a selection boundary, not a promise of local coverage or eligibility.
// Coverage markers and contact channels must never influence proximity ranking.
export function relatedResources(resource, catalog) {
  const country = String(resource.country || "").trim();
  if (!country) return [];
  const sourceTypes = types(resource);
  const sourceScope = resourceScope(resource);
  const candidates = catalog
    .filter((candidate) => candidate.id !== resource.id
      && String(candidate.country || "").trim() === country
      && !sourceClosureNotice(candidate)
      && (country !== "Global" || ["locator", "network"].includes(candidate.kind)))
    .map((candidate) => {
      const typeOverlap = [...types(candidate)].filter((type) => sourceTypes.has(type)).length;
      const distance = physicalSite(resource) && physicalSite(candidate)
        ? distanceKm(resource.lat, resource.lng, candidate.lat, candidate.lng)
        : Number.POSITIVE_INFINITY;
      const scope = resourceScope(candidate);
      const municipal = sameScopedMunicipality(sourceScope, scope);
      const nearby = sourceScope.type === "municipal" && distance <= 25;
      const regional = scope.type === "regional" && sourceScope.administrativeArea
        && scope.administrativeArea === sourceScope.administrativeArea;
      // National/global finders are useful fallbacks. Distant physical sites or
      // other cities' directories are not fallbacks merely because the country matches.
      const broad = ["national", "global"].includes(scope.type) && candidate.kind !== "direct";
      const band = municipal ? 0 : nearby ? 1 : regional ? 2 : broad ? 3 : 4;
      let score = typeOverlap * 45 + (candidate.kind === "direct" ? 8 : 0);
      if (distance <= 25) score += 70 - distance;
      else if (distance <= 100) score += 30 - distance * .18;
      else if (distance <= 250) score += 8;
      return { candidate, distance, score, typeOverlap, band, scope };
    })
    .filter(({ typeOverlap, band }) => typeOverlap > 0 && band < 4)
    .sort((a, b) => a.band - b.band || b.score - a.score || a.distance - b.distance
      || compareText(a.candidate.name, b.candidate.name) || compareText(a.candidate.id, b.candidate.id));

  const seen = new Set();
  return candidates.filter(({ candidate }) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).slice(0, 6);
}
