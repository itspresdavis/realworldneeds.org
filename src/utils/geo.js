import { resourceTypes } from "../data/resources.js";

export function toRad(value) {
  return (value * Math.PI) / 180;
}

export function latLngToVector3(lat, lng, radius = 1) {
  const phi = toRad(90 - lat);
  const theta = toRad(lng + 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return { x, y, z };
}

export function matchesResource(resource, query, activeTypes) {
  const allTypes = [resource.category, ...(resource.secondaryCategories || [])];
  const typeMatch =
    activeTypes.size === 0 || allTypes.some((type) => activeTypes.has(type));

  if (!typeMatch) return false;
  if (!query.trim()) return true;

  const target = [
    resource.name,
    resource.city,
    resource.country,
    resource.region,
    resource.address,
    resource.summary,
    resource.services.join(" "),
    resource.sourceName
  ]
    .join(" ")
    .toLowerCase();

  return target.includes(query.trim().toLowerCase());
}

export function createInitialTypeSet() {
  return new Set(resourceTypes);
}

export function getVisibleTypeList(activeTypes) {
  return resourceTypes.filter((type) => activeTypes.has(type));
}
