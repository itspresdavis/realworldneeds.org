import { distanceKm, isExactServiceSite } from "../src/utils/geo.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

const types = (resource) => new Set([resource.category, ...(resource.secondaryCategories || [])]);
const physicalSite = (resource) => resource.kind === "direct" && isExactServiceSite(resource);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

// A country is a selection boundary, not a promise of local coverage or eligibility.
// Coverage markers and contact channels must never influence proximity ranking.
export function relatedResources(resource, catalog) {
  const country = String(resource.country || "").trim();
  if (!country) return [];
  const sourceTypes = types(resource);
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
      let score = typeOverlap * 45 + (candidate.kind === "direct" ? 8 : 0);
      if (distance <= 25) score += 70 - distance;
      else if (distance <= 100) score += 30 - distance * .18;
      else if (distance <= 250) score += 8;
      return { candidate, distance, score, typeOverlap };
    })
    .filter(({ typeOverlap }) => typeOverlap > 0)
    .sort((a, b) => b.score - a.score || a.distance - b.distance
      || compareText(a.candidate.name, b.candidate.name) || compareText(a.candidate.id, b.candidate.id));

  const seen = new Set();
  return candidates.filter(({ candidate }) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).slice(0, 6);
}
