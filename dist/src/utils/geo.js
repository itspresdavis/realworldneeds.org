import { resourceTypes } from "../data/resources.js?v=93bf6b9efaa9";

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
    // Keep common public-utility terms intact when punctuation would otherwise
    // split them into weak, ambiguous tokens (for example, “Wi-Fi” → “wi fi”).
    .replace(/wi[\s-]?fi\b/g, "wifi")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

const searchAliases = new Map(Object.entries({
  meal: "food", meals: "food", pantry: "food", pantries: "food", groceries: "food", grocery: "food", hunger: "food",
  comida: "food", comidas: "food", alimento: "food", alimentos: "food", nourriture: "food", repas: "food",
  drink: "water", drinking: "water", refill: "water", hydration: "water", agua: "water", eau: "water",
  housing: "shelter", homeless: "shelter", homelessness: "shelter", bed: "shelter", refuge: "shelter",
  albergue: "shelter", refugio: "shelter", alojamiento: "shelter", abrigo: "shelter", abri: "shelter",
  shower: "hygiene", showers: "hygiene", laundry: "hygiene", toilet: "hygiene", toilets: "hygiene", toiletries: "hygiene",
  ducha: "hygiene", duchas: "hygiene", bano: "hygiene", banos: "hygiene", lavanderia: "hygiene", banho: "hygiene", douche: "hygiene", douches: "hygiene",
  clothes: "clothing", coat: "clothing", coats: "clothing", shoes: "clothing", blanket: "clothing", blankets: "clothing",
  ropa: "clothing", roupas: "clothing", vetement: "clothing", vetements: "clothing",
  doctor: "health", doctors: "health", clinic: "health", clinics: "health", dental: "health", dentist: "health", medical: "health", mental: "health", healthcare: "health",
  salud: "health", saude: "health", sante: "health", medico: "health", medica: "health", clinica: "health", clinique: "health",
  directory: "referral", directories: "referral", locator: "referral", navigation: "referral", benefits: "referral", advice: "referral", casework: "referral",
  diapers: "diaper", chargers: "charging", charger: "charging", wifi: "wifi", nyc: "new york city"
}));

// Small, deliberate corrections for high-frequency need words. This is not a
// broad fuzzy matcher: ambiguous corrections can send someone seeking urgent
// help to the wrong category, so only obvious single-word slips are accepted.
const commonNeedTypos = new Map(Object.entries({
  foood: "food", shleter: "shelter", sheltor: "shelter", watre: "water", clohtes: "clothing", hygene: "hygiene"
}));

const queryNoise = new Set([
  "a", "an", "the", "for", "to", "of", "please", "find", "finding", "need", "needs", "help", "free",
  "near", "nearby", "me", "my", "local", "around",
  "ayuda", "gratis", "cerca", "mi",
  "aide", "gratuit", "gratuite", "pres",
  "ajuda", "gratuito", "gratuita", "perto"
]);

function rawTokens(value) {
  return normalizedText(value).split(/\s+/).filter(Boolean);
}

function searchTokens(value) {
  return rawTokens(value).map((token) => searchAliases.get(token) || token);
}

function querySearchTokens(value) {
  return rawTokens(value)
    .filter((token) => !queryNoise.has(token))
    .map((token) => commonNeedTypos.get(token) || searchAliases.get(token) || token);
}

const resourceSearchFieldCache = new WeakMap();
const queryTokenCache = new Map();
const QUERY_TOKEN_CACHE_LIMIT = 64;

function resourceSearchFields(resource) {
  const cached = resourceSearchFieldCache.get(resource);
  if (cached) return cached;
  const types = [resource.category, ...(resource.secondaryCategories || [])];
  const services = Array.isArray(resource.services) ? resource.services : [];
  const fields = {
    name: normalizedText(resource.name),
    place: normalizedText([resource.city, resource.country, resource.region, resource.address].join(" ")),
    source: normalizedText(resource.sourceName),
    primaryType: normalizedText(resource.category),
    types: new Set(searchTokens(types.join(" "))),
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
  resourceSearchFieldCache.set(resource, fields);
  return fields;
}

function cachedQueryTokens(query) {
  const key = normalizedText(query);
  const cached = queryTokenCache.get(key);
  if (cached) return cached;
  const tokens = querySearchTokens(key);
  if (queryTokenCache.size >= QUERY_TOKEN_CACHE_LIMIT) {
    queryTokenCache.delete(queryTokenCache.keys().next().value);
  }
  queryTokenCache.set(key, tokens);
  return tokens;
}

export function resourceSearchScore(resource, query) {
  const tokens = cachedQueryTokens(query);
  if (!tokens.length) return 0;
  const fields = resourceSearchFields(resource);
  if (!tokens.every((token) => fields.tokens.has(token) || fields.all.includes(token))) return -1;

  return tokens.reduce((score, token) => {
    // Category intent must outrank incidental text. A person typing “water”
    // should see water access before foodbanks named after Waterbeach.
    if (fields.primaryType === token) return score + 40;
    if (fields.types.has(token)) return score + 30;
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
  const ranked = resourceList.map((resource) => {
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
    return {
      resource,
      tier,
      distance: distance ?? Number.POSITIVE_INFINITY,
      score: resourceSearchScore(resource, query)
    };
  });

  ranked.sort((left, right) => left.tier - right.tier
    || right.score - left.score
    || left.distance - right.distance
    || left.resource.name.localeCompare(right.resource.name));
  return ranked.map((entry) => entry.resource);
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
