const QUICK_TYPES = [
  ["food", "Food"],
  ["shelter", "Shelter"],
  ["health", "Health care"],
  ["hygiene", "Showers & hygiene"],
  ["clothing", "Clothing"],
  ["water", "Water"]
];

function layerButtons() {
  return [...document.querySelectorAll(".layer-toggle[data-type]")];
}

function setLayerSelection(type) {
  for (const button of layerButtons()) {
    const desired = type === "all" || button.dataset.type === type;
    const active = button.getAttribute("aria-pressed") === "true";
    if (active !== desired) button.click();
  }
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
  input.placeholder = "Search a service or place";
  input.setAttribute("aria-label", "Search by service, place, ZIP or postcode, or organization");
  input.setAttribute("enterkeyhint", "search");
  input.setAttribute("spellcheck", "false");

  const search = input.closest(".finder-search");
  if (search && !search.querySelector(".search-helper")) {
    const helper = document.createElement("p");
    helper.className = "search-helper";
    helper.textContent = "Try a service, city, ZIP or postcode, or organization name.";
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
  container.setAttribute("aria-label", "Quick service filters");
  container.innerHTML = `
    <p class="quick-needs__label">Browse by need</p>
    ${QUICK_TYPES.map(([type, label]) => `<button class="quick-need" type="button" data-quick-type="${type}" aria-pressed="false">${label}</button>`).join("")}
    <button class="quick-need" type="button" data-quick-type="all" aria-pressed="true">All services</button>
  `;
  search.insertAdjacentElement("afterend", container);

  container.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-need");
    if (!button) return;
    setLayerSelection(button.dataset.quickType);
    syncQuickNeeds(container);
  });

  layerList.addEventListener("click", () => queueMicrotask(() => syncQuickNeeds(container)));
  syncQuickNeeds(container);
}

function installFinderTrustBar() {
  const intro = document.querySelector(".finder-intro");
  if (!intro || document.querySelector(".finder-trustbar")) return;
  const trust = document.createElement("div");
  trust.className = "finder-trustbar";
  trust.setAttribute("aria-label", "Real World Needs directory principles");
  trust.innerHTML = `
    <span>No account</span>
    <span>No paywall</span>
    <span>Original sources</span>
    <a href="/editorial-policy">Review policy</a>
  `;
  intro.append(trust);
}

function compactFinderNotes() {
  const locationStatus = document.getElementById("locationStatus");
  const liveSourceStatus = document.getElementById("liveSourceStatus");
  const privacy = document.querySelector(".location-privacy");
  const safety = document.querySelector(".finder-safety");
  if (!locationStatus || !liveSourceStatus || !privacy || !safety) {
    throw new Error("Finder note refinement prerequisites are missing.");
  }
  if (document.querySelector(".finder-notes")) return;

  const details = document.createElement("details");
  details.className = "finder-notes";
  details.innerHTML = `<summary>Location, privacy and safety</summary><div class="finder-notes__body"></div>`;
  const body = details.querySelector(".finder-notes__body");
  locationStatus.insertAdjacentElement("afterend", details);
  body.append(liveSourceStatus, privacy, safety);
}

function improveFilterSummary() {
  const disclosure = document.querySelector(".filter-disclosure");
  const summary = disclosure?.querySelector("summary");
  if (!disclosure || !summary) throw new Error("Detailed filter disclosure is missing.");
  summary.setAttribute("aria-label", "Open detailed service filters");
}

function hasRequestedResource() {
  const url = new URL(window.location.href);
  return url.searchParams.has("resource") || /(?:^|[&#])resource=/.test(url.hash);
}

function startFinderCalm() {
  if (hasRequestedResource()) return;
  const panel = document.getElementById("resourcePanel");
  const grid = document.querySelector(".finder__grid");
  const inspectorToggle = document.getElementById("openInspector");
  if (!panel || !grid) throw new Error("Finder panel prerequisites are missing.");

  panel.hidden = true;
  grid.classList.add("is-panel-collapsed", "rwn-initial-calm");
  if (inspectorToggle) inspectorToggle.hidden = true;
}

export function installRefinements() {
  improveSearch();
  installFinderTrustBar();
  installQuickNeeds();
  compactFinderNotes();
  improveFilterSummary();
  startFinderCalm();
  document.documentElement.classList.add("rwn-refined");
}
