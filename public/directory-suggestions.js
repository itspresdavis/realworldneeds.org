import {
  RESOURCE_TOPICS_KEY, normalizeRememberedTopics,
} from "../src/utils/privacy.js";
import { createCatalogLoader } from "./catalog-request.js";

const topicNames = {
  food: "Food", water: "Water", shelter: "Shelter", hygiene: "Hygiene",
  clothing: "Clothing", health: "Health", referral: "Navigation",
};
const normalizePlace = (value) => String(value ?? "").trim().toLocaleLowerCase("en")
  .normalize("NFC").replace(/\s+/gu, " ");

export function parseSuggestionArea(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return {};
  if (/^\d{5}$/.test(raw)) return { zip: raw };
  const [city, country, ...extra] = raw.split(",").map(normalizePlace);
  const name = /^[\p{L}\p{M}][\p{L}\p{M}\s.\-'’()]*$/u;
  if (raw.length > 80 || extra.length || !name.test(city) || country !== undefined && !name.test(country)) return null;
  return { city, country };
}

export function matchDirectorySuggestions(records, chosen, area = {}, limit = 6) {
  const topics = new Set(chosen.filter((topic) => Object.hasOwn(topicNames, topic)));
  if (!topics.size || area === null) return [];
  const matched = [];
  for (const record of records) {
    if (record.sourceStatus || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(record.id || "")) continue;
    const reasons = [...new Set(record.categories || [])]
      .filter((topic) => topics.has(topic)).map((topic) => topicNames[topic]);
    if (!reasons.length) continue;
    if (area.city || area.zip) {
      // A locator's office city is not a service area. Match only public
      // site addresses; no geocoder, distance estimate, or ZIP inference.
      if (record.kind !== "direct" || record.locationPrecision === "contact-only") continue;
      if (area.zip) {
        const address = String(record.search ?? "").split("\n", 1)[0];
        if (record.country !== "United States" || !address.split(" ").includes(area.zip)) continue;
      } else {
        const country = normalizePlace(record.country);
        const place = normalizePlace(record.place);
        const suffix = `, ${country}`;
        if (!country || area.country && area.country !== country ||
            !place.endsWith(suffix) || place.slice(0, -suffix.length) !== area.city) continue;
      }
    } else if (record.country !== "Global" || !["locator", "network"].includes(record.kind)) {
      continue;
    }
    matched.push({ record, reasons });
  }
  return matched.sort((a, b) => b.reasons.length - a.reasons.length
    || a.record.name.localeCompare(b.record.name, "en")
    || a.record.id.localeCompare(b.record.id, "en")).slice(0, limit);
}

export function initDirectorySuggestions(panel) {
  const form = panel.querySelector("form");
  const topicInputs = [...form.querySelectorAll("[data-suggestion-topic]")];
  const areaInput = form.querySelector("[data-suggestion-area]");
  const remember = form.querySelector("[data-suggestion-remember]");
  const reset = form.querySelector("[data-suggestion-reset]");
  const status = panel.querySelector("[data-suggestion-status]");
  const results = panel.querySelector("[data-suggestion-results]");
  const error = form.querySelector("[data-suggestion-error]");
  const release = new URL(import.meta.url).searchParams.get("v");
  const load = createCatalogLoader(`/data/search-index.json${release ? `?v=${encodeURIComponent(release)}` : ""}`, true);
  let generation = 0;
  const clearResults = () => {
    generation++;
    results.replaceChildren();
    status.textContent = "";
    error.textContent = "";
    areaInput.removeAttribute("aria-invalid");
  };
  const hydrate = () => {
    let saved = [];
    try { saved = normalizeRememberedTopics(JSON.parse(localStorage.getItem(RESOURCE_TOPICS_KEY) || "[]")); } catch {}
    for (const input of topicInputs) input.checked = saved.includes(input.value);
    remember.checked = saved.length > 0;
    areaInput.value = "";
  };
  const forget = () => {
    try { localStorage.removeItem(RESOURCE_TOPICS_KEY); return true; } catch { return false; }
  };
  hydrate();
  form.addEventListener("input", clearResults);
  remember.addEventListener("change", () => {
    if (remember.checked) return;
    status.textContent = forget() ? "Remembered topics removed." : "This browser did not let us clear remembered topics.";
  });
  reset.addEventListener("click", () => {
    clearResults();
    form.reset();
    status.textContent = forget() ? "Topics and location cleared." : "This browser did not let us clear remembered topics.";
  });
  window.addEventListener("pagehide", () => { clearResults(); form.reset(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) hydrate(); });
  // Do not keep recommending records from a replaced offline release.
  const invalidateCatalog = () => { load.reset(); clearResults(); };
  navigator.serviceWorker?.addEventListener("controllerchange", invalidateCatalog);
  window.addEventListener("offline", invalidateCatalog);
  window.addEventListener("online", invalidateCatalog);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearResults();
    const topics = topicInputs.filter((input) => input.checked).map((input) => input.value);
    if (!topics.length) {
      status.textContent = "Choose at least one topic first.";
      topicInputs[0].focus();
      return;
    }
    const area = parseSuggestionArea(areaInput.value);
    if (!area) {
      error.textContent = "Enter just a city, city and country, or a 5-digit U.S. ZIP.";
      areaInput.setAttribute("aria-invalid", "true");
      areaInput.focus();
      return;
    }
    let saveNote = "";
    if (remember.checked) {
      const saved = normalizeRememberedTopics(topics);
      try {
        if (saved.length) localStorage.setItem(RESOURCE_TOPICS_KEY, JSON.stringify(saved));
        else localStorage.removeItem(RESOURCE_TOPICS_KEY);
        saveNote = saved.length ? " Topics remembered on this device." : " No selected topics can be remembered.";
      } catch { saveNote = " This browser did not let us remember topics."; }
    }
    if (navigator.onLine === false) {
      status.textContent = "Suggestions need a connection. You can still browse the directory." + saveNote;
      return;
    }
    const version = generation;
    status.textContent = "Finding suggestions…";
    try {
      const payload = await load();
      if (version !== generation) return;
      const matches = matchDirectorySuggestions(payload.records, topics, area);
      for (const { record, reasons } of matches) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `/service/${encodeURIComponent(record.id)}`;
        link.textContent = record.name;
        const context = document.createElement("span");
        const place = area.city || area.zip ? record.place : "Resource finder or network: check coverage";
        context.textContent = `${place} · Matches: ${reasons.join(", ")}`;
        item.append(link, context);
        results.append(item);
      }
      status.textContent = (matches.length
        ? `${matches.length} suggested ${matches.length === 1 ? "listing" : "listings"}.`
        : "No suggestions for these choices. Try other topics or use directory search.") + saveNote;
    } catch {
      if (version === generation) status.textContent = "Suggestions are unavailable right now. Browse the directory or try again." + saveNote;
    }
  });
  panel.hidden = false;
}

const panel = typeof document !== "undefined" && document.querySelector("[data-directory-suggestions]");
if (panel) initDirectorySuggestions(panel);
