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

export function distanceKm(fromLat, fromLng, toLat, toLng) {
  const earthRadiusKm = 6371;
  const latDelta = toRad(toLat - fromLat);
  const lngDelta = toRad(toLng - fromLng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchesResource(resource, query, activeTypes) {
  const serviceTypes = [resource.category, ...(resource.secondaryCategories || [])];
  const typeMatch = serviceTypes.some((type) => activeTypes.has(type));

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
    resource.sourceName,
    resource.accessType,
    resource.costNote
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
