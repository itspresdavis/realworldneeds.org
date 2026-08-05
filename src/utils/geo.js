import { resourceTypes } from "../data/resources.js";

export const THREE_SPHERE_TEXTURE_OFFSET = 0.25;

export function toRad(value) {
  return (value * Math.PI) / 180;
}

export function normalizeLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function coordinateVector(lat, lng) {
  const latitude = toRad(lat);
  const longitude = toRad(lng);
  const cosLat = Math.cos(latitude);
  return {
    x: cosLat * Math.sin(longitude),
    y: Math.sin(latitude),
    z: cosLat * Math.cos(longitude)
  };
}

function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.length ? [polygon[0]] : []);
  return [];
}

export function featureGlobeView(feature, fallback = { lat: 0, lng: 0 }) {
  const coordinates = outerRings(feature?.geometry).flatMap((ring) => {
    if (ring.length < 2) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  });
  if (!coordinates.length) return { lat: fallback.lat, lng: fallback.lng, zoom: 1.06, angularRadius: 0 };

  const average = coordinates.reduce((sum, [lng, lat]) => {
    const vector = coordinateVector(lat, lng);
    sum.x += vector.x;
    sum.y += vector.y;
    sum.z += vector.z;
    return sum;
  }, { x: 0, y: 0, z: 0 });
  const length = Math.hypot(average.x, average.y, average.z) || 1;
  const center = { x: average.x / length, y: average.y / length, z: average.z / length };
  const lat = Math.asin(Math.max(-1, Math.min(1, center.y))) * 180 / Math.PI;
  const lng = normalizeLongitude(Math.atan2(center.x, center.z) * 180 / Math.PI);
  const angularRadius = coordinates.reduce((largest, [coordinateLng, coordinateLat]) => {
    const vector = coordinateVector(coordinateLat, coordinateLng);
    const dot = Math.max(-1, Math.min(1, center.x * vector.x + center.y * vector.y + center.z * vector.z));
    return Math.max(largest, Math.acos(dot) * 180 / Math.PI);
  }, 0);
  const zoom = angularRadius > 55 ? 1.01
    : angularRadius > 32 ? 1.04
      : angularRadius > 18 ? 1.07
        : angularRadius > 8 ? 1.1
          : 1.13;

  return { lat, lng, zoom, angularRadius };
}

export function cameraDistanceForSphere(verticalFovDegrees, aspect, radius = 1.05, padding = 1.06) {
  const verticalFov = toRad(verticalFovDegrees);
  const safeAspect = Math.max(0.1, aspect || 1);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  return (radius / Math.sin(limitingFov / 2)) * padding;
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

export function isExactServiceSite(resource) {
  if (!resource) return false;
  if (resource.locationPrecision) return resource.locationPrecision === "exact";
  return resource.kind === "direct";
}

export function resourceDistanceKm(userLocation, resource) {
  if (!userLocation || !isExactServiceSite(resource)) return null;
  return distanceKm(userLocation.lat, userLocation.lng, resource.lat, resource.lng);
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

const searchAliases = new Map(Object.entries({
  meal: "food", meals: "food", pantry: "food", pantries: "food", groceries: "food", grocery: "food", hunger: "food",
  drink: "water", drinking: "water", refill: "water", hydration: "water",
  housing: "shelter", homeless: "shelter", homelessness: "shelter", bed: "shelter", refuge: "shelter",
  shower: "hygiene", showers: "hygiene", laundry: "hygiene", toilet: "hygiene", toilets: "hygiene", toiletries: "hygiene",
  clothes: "clothing", coat: "clothing", coats: "clothing", shoes: "clothing", blanket: "clothing", blankets: "clothing",
  doctor: "health", doctors: "health", clinic: "health", clinics: "health", dental: "health", medical: "health", mental: "health",
  directory: "referral", directories: "referral", locator: "referral", navigation: "referral", benefits: "referral", advice: "referral", casework: "referral"
}));

function searchTokens(value) {
  return normalizedText(value).split(/\s+/).filter(Boolean).map((token) => searchAliases.get(token) || token);
}

function resourceSearchFields(resource) {
  const types = [resource.category, ...(resource.secondaryCategories || [])];
  const services = Array.isArray(resource.services) ? resource.services : [];
  const fields = {
    name: normalizedText(resource.name),
    place: normalizedText([resource.city, resource.country, resource.region, resource.address].join(" ")),
    source: normalizedText(resource.sourceName),
    detail: normalizedText([
      resource.summary,
      services.join(" "),
      resource.accessType,
      resource.costNote,
      resource.coverageNote,
      resource.kind,
      ...types,
      ...types.map((type) => resourceTypes.includes(type) ? type : "")
    ].join(" "))
  };
  fields.all = `${fields.name} ${fields.place} ${fields.source} ${fields.detail}`;
  fields.tokens = new Set(searchTokens(fields.all));
  return fields;
}

export function resourceSearchScore(resource, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return 0;
  const fields = resourceSearchFields(resource);
  if (!tokens.every((token) => fields.tokens.has(token) || fields.all.includes(token))) return -1;

  return tokens.reduce((score, token) => {
    if (fields.name === token) return score + 20;
    if (fields.name.startsWith(token)) return score + 12;
    if (fields.name.includes(token)) return score + 8;
    if (fields.place.includes(token)) return score + 6;
    if (fields.source.includes(token)) return score + 4;
    return score + 2;
  }, 0);
}

export function rankResourcesForLocation(resourceList, userLocation, userCountry = "", query = "") {
  const country = normalizedText(userCountry);
  const rank = (resource) => {
    const exact = isExactServiceSite(resource);
    const distance = resourceDistanceKm(userLocation, resource);
    const sameCountry = Boolean(country && normalizedText(resource.country) === country);
    const globalCoverage = !exact && ["global", "worldwide"].includes(normalizedText(resource.country));
    let tier = 5;
    if (exact && distance <= 250) tier = 0;
    else if (!exact && sameCountry) tier = 1;
    else if (exact && sameCountry) tier = 2;
    else if (globalCoverage) tier = 3;
    else if (exact) tier = 4;
    return { tier, distance: distance ?? Number.POSITIVE_INFINITY, score: resourceSearchScore(resource, query) };
  };

  return [...resourceList].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    return a.tier - b.tier
      || b.score - a.score
      || a.distance - b.distance
      || left.name.localeCompare(right.name);
  });
}

export function formatResourcePlace(resource) {
  const city = String(resource?.city || "").trim();
  const country = String(resource?.country || "").trim();
  if (!city) return country;
  if (!country || city.toLocaleLowerCase() === country.toLocaleLowerCase()) return city;
  return `${city}, ${country}`;
}

export function matchesResource(resource, query, activeTypes) {
  const serviceTypes = [resource.category, ...(resource.secondaryCategories || [])];
  const typeMatch = serviceTypes.some((type) => activeTypes.has(type));

  if (!typeMatch) return false;
  if (!query.trim()) return true;
  return resourceSearchScore(resource, query) >= 0;
}

export function createInitialTypeSet() {
  return new Set(resourceTypes);
}

export function getVisibleTypeList(activeTypes) {
  return resourceTypes.filter((type) => activeTypes.has(type));
}
