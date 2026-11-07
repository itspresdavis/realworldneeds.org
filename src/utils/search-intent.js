import { resourceScope } from "./resource-scope.js";
import {
  normalizeSearch,
  searchTimeIntent,
  resourceMatchesManualPlace,
} from "./search.js";
// Download this bounded local reference only when a postal query needs it.
let postalAreas = {},
  postalStatus = "idle",
  postalRequest;
export function loadPostalAreas(fetcher = fetch) {
  if (postalStatus === "ready") return Promise.resolve();
  if (postalRequest) return postalRequest;
  postalStatus = "loading";
  const controller = new AbortController();
  let active = true,
    timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      active = false;
      controller.abort();
      reject(new Error("Postal reference unavailable"));
    }, 8000);
  });
  postalRequest = Promise.race([
    (async () => {
      const response = await fetcher("/data/postal-areas.json", {
        credentials: "same-origin",
        cache: "reload",
        signal: controller.signal,
      });
      if (
        !response.ok ||
        Number(response.headers.get("Content-Length")) > 64000
      )
        throw new Error("Postal reference unavailable");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Postal reference body unavailable");
      const chunks = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 64000) {
          await reader.cancel();
          throw new Error("Postal reference too large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (!active) throw new Error("Postal reference expired");
      const entries = Object.entries(payload.areas || {});
      if (
        payload.schemaVersion !== "1.0" ||
        entries.length < 600 ||
        entries.length > 1200 ||
        entries.some(
          ([key, point]) =>
            !/^\d{5}$/.test(key) ||
            !Array.isArray(point) ||
            point.length !== 2 ||
            !point.every(Number.isFinite) ||
            Math.abs(point[0]) > 90 ||
            Math.abs(point[1]) > 180,
        )
      )
        throw new Error("Invalid postal reference");
      postalAreas = payload.areas;
      postalStatus = "ready";
    })(),
    deadline,
  ])
    .catch((error) => {
      postalStatus = "error";
      throw error;
    })
    .finally(() => {
      active = false;
      clearTimeout(timer);
      postalRequest = null;
    });
  return postalRequest;
}

const bounded = (value) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 180);
export function distanceFromArea(a, b) {
  const radians = (value) => (value * Math.PI) / 180,
    dLat = radians(b[0] - a[0]),
    dLng = radians(b[1] - a[1]);
  return (
    6371 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(dLat / 2) ** 2 +
            Math.cos(radians(a[0])) *
              Math.cos(radians(b[0])) *
              Math.sin(dLng / 2) ** 2,
        ),
      ),
    )
  );
}
export function resolveSearchIntent(query, place = "", selection = null) {
  const original = bounded(query),
    manualPlace = bounded(place),
    combined = [original, manualPlace].filter(Boolean).join(" ");
  const postal = normalizeSearch(combined).match(/(?:^| )(\d{5})(?= |$)/)?.[1];
  // A published ZIP reference is a choice, not permission to infer a country.
  const supported =
    postal &&
    postalAreas[postal] &&
    !/\b(?:mexico|mexican|espana|spain|uk|united kingdom|canada)\b/.test(
      normalizeSearch(combined),
    );
  const area =
    supported &&
    selection?.postal === postal &&
    [10, 25, 50].includes(selection.radius) &&
    postalAreas[postal]
      ? {
          postal,
          radius: selection.radius,
          point: postalAreas[postal],
          country: "United States",
        }
      : null;
  return {
    original,
    place: manualPlace,
    postal: postal || "",
    postalSupported: Boolean(supported),
    postalStatus,
    area,
    query: area
      ? combined.replace(new RegExp(`\\b${postal}\\b`), " ").trim()
      : combined,
    time: searchTimeIntent(combined),
    foodChoice:
      /\b(?:food|comida|alimentos)\b/.test(normalizeSearch(combined)) &&
      !/\b(?:meals?|pantr(?:y|ies)|grocer(?:y|ies)|wic|snap|benefits?)\b/.test(
        normalizeSearch(combined),
      ),
  };
}
export function resourceMatchesArea(resource, area) {
  if (!area) return true;
  if (resource.country !== area.country) return false;
  if (resource.kind !== "direct")
    return (resource.coverageScope || resourceScope(resource).type) === "national";
  const point =
    Number.isFinite(resource.lat) && Number.isFinite(resource.lng)
      ? [resource.lat, resource.lng]
      : postalAreas[
          (resource.address || resource.search?.split("\n")[0] || "").match(
            /\b[a-z]{2}[,\s]+(\d{5})\b/i,
          )?.[1]
        ];
  return Boolean(point && distanceFromArea(area.point, point) <= area.radius);
}
export function replaceFoodIntent(query, intent) {
  if (!["meals", "groceries", "food benefits"].includes(intent))
    return bounded(query);
  const text = bounded(query);
  return /\b(?:food|comida|alimentos)\b/i.test(text)
    ? text.replace(/\b(?:food|comida|alimentos)\b/i, intent)
    : `${intent} ${text}`.trim();
}

export function resourceMatchesIntent(resource, intent) {
  return (
    resourceMatchesArea(resource, intent.area) &&
    (intent.area || resourceMatchesManualPlace(resource, intent.place))
  );
}
