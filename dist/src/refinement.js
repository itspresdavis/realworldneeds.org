import { installPageInteractions } from "./page-interactions.js?v=32eafdd55a02";

const QUICK_TYPES = [
  ["food", "Food"],
  ["water", "Water"],
  ["shelter", "Shelter"],
  ["clothing", "Clothing"],
  ["hygiene", "Hygiene"],
  ["health", "Health care"]
];

function layerButtons() {
  return [...document.querySelectorAll(".layer-toggle[data-type]")];
}

function setLayerSelection(type) {
  document.getElementById("layerList").dispatchEvent(new CustomEvent("rwn:select-need", { detail: { type } }));
}

function syncQuickNeeds(container) {
  const buttons = layerButtons();
  const active = buttons.filter((button) => button.getAttribute("aria-pressed") === "true");
  const activeTypes = new Set(active.map((button) => button.dataset.type));
  const allActive = active.length > 0 && active.length === buttons.length;

  for (const button of container.querySelectorAll(".quick-need")) {
    const type = button.dataset.quickType;
    const pressed = type === "all" ? allActive : activeTypes.size === 1 && activeTypes.has(type);
    button.setAttribute("aria-pressed", String(pressed));
  }
}

function improveSearch() {
  const input = document.getElementById("resourceSearch");
  if (!input) throw new Error("Finder search input is missing.");
  input.placeholder = "Search by service or place";
  input.setAttribute("aria-label", "What do you need? Search by need, service, place, ZIP or postcode, or organization");
  input.setAttribute("enterkeyhint", "search");
  input.setAttribute("spellcheck", "false");

  const search = input.closest(".finder-search");
  if (search && !search.querySelector(".search-helper")) {
    const helper = document.createElement("p");
    helper.className = "search-helper";
    helper.textContent = "Need, service, city, ZIP or postcode, or organization name.";
    search.append(helper);
  }
}

function installQuickNeeds() {
  const search = document.querySelector(".finder-search");
  const layerList = document.getElementById("layerList");
  if (!search || !layerList) throw new Error("Finder refinement prerequisites are missing.");
  if (document.querySelector(".quick-needs")) return;

  const container = document.createElement("div");
  container.className = "quick-needs";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Common service filters");
  container.innerHTML = `
    <p class="quick-needs__label">Core needs</p>
    <button class="quick-need quick-need--all" type="button" data-quick-type="all" aria-pressed="true">All</button>
    ${QUICK_TYPES.map(([type, label]) => `<button class="quick-need" type="button" data-quick-type="${type}" aria-pressed="false">${label}</button>`).join("")}
  `;
  search.insertAdjacentElement("afterend", container);

  container.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-need");
    if (!button) return;
    setLayerSelection(button.dataset.quickType);
  });

  document.addEventListener("rwn:filters-updated", () => syncQuickNeeds(container));
  syncQuickNeeds(container);
}

function compactLocationNotes() {
  const locationStatus = document.getElementById("locationStatus");
  const liveSourceStatus = document.getElementById("liveSourceStatus");
  const privacy = document.querySelector(".location-privacy");
  if (!locationStatus || !liveSourceStatus || !privacy || document.querySelector(".finder-location-notes")) return;

  const details = document.createElement("details");
  details.className = "finder-location-notes";
  details.innerHTML = `<summary>About location</summary><div class="finder-location-notes__body"></div>`;
  const body = details.querySelector(".finder-location-notes__body");
  locationStatus.insertAdjacentElement("afterend", details);
  body.append(liveSourceStatus, privacy);
}

function groupFinderDisclosures() {
  const location = document.querySelector(".finder-location-notes");
  const filters = document.querySelector(".filter-disclosure");
  if (!location || !filters || document.querySelector(".finder-disclosures")) return;
  // Move existing nodes, preserving their event listeners and disclosure state.
  const group = document.createElement("div");
  group.className = "finder-disclosures";
  location.before(group);
  group.append(location, filters);
}

function composeFinderSurface() {
  const search = document.querySelector(".finder-search");
  const sidebar = document.querySelector(".finder-sidebar");
  if (!search || !sidebar || sidebar.querySelector(".finder-surface")) return;
  const focused = document.activeElement;
  const selection = typeof focused?.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  const surface = document.createElement("div");
  surface.className = "finder-surface";
  const label = document.createElement("label");
  label.className = "finder-search-label";
  label.htmlFor = "resourceSearch";
  label.textContent = "What do you need?";
  search.before(surface);
  surface.append(label);
  // Reuse the live controls. Moving a focused node can blur it in older browsers.
  for (const selector of [".finder-search", ".quick-needs", ".jump-results", ".location-actions", "#locationStatus", "#locationRecovery", ".finder-disclosures"]) {
    const node = sidebar.querySelector(selector);
    if (node) surface.append(node);
  }
  if (focused && surface.contains(focused) && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
    if (selection) focused.setSelectionRange(...selection);
  }
}

function improveFilterSummary() {
  const disclosure = document.querySelector(".filter-disclosure");
  const summary = disclosure?.querySelector("summary");
  if (!disclosure || !summary) throw new Error("Detailed filter disclosure is missing.");
  summary.setAttribute("aria-label", "Open all service filters");
}

function refineGlobeInstructions() {
  const help = document.getElementById("globeHelp");
  if (help) help.textContent = "Drag or use arrow keys to rotate. Zoom by double-clicking, pinching, pressing plus and minus, or holding Control or Command while scrolling. Ordinary scrolling always moves the page. Select a country or service point for details.";

  const hint = document.querySelector(".globe-gesture-hint");
  if (hint) hint.textContent = "Drag to rotate · Double-click, pinch or + / − to zoom";

  const stage = document.querySelector(".globe-stage");
  if (stage) stage.setAttribute("data-map-version", "2");
}

export function installRefinements() {
  improveSearch();
  installQuickNeeds();
  compactLocationNotes();
  groupFinderDisclosures();
  composeFinderSurface();
  improveFilterSummary();
  refineGlobeInstructions();
  document.documentElement.classList.add("rwn-refined");
  installPageInteractions();
}
