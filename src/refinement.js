const QUICK_TYPES = [
  ["food", "Food"],
  ["shelter", "Shelter"],
  ["health", "Health"],
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
  input.placeholder = "Search food, shelter, city, ZIP/postcode or organization";
  input.setAttribute("aria-label", "Search by service, place, ZIP or postcode, or organization");
  input.setAttribute("enterkeyhint", "search");
  input.setAttribute("spellcheck", "false");

  const search = input.closest(".finder-search");
  if (search && !search.querySelector(".search-helper")) {
    const helper = document.createElement("p");
    helper.className = "search-helper";
    helper.innerHTML = `<span>Try “food pantry”, “Boston”, “showers”, or an organization name.</span><kbd>/</kbd><span>to search</span>`;
    search.append(helper);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    event.preventDefault();
    input.focus({ preventScroll: false });
    input.select();
  });
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
    <p class="quick-needs__label">What do you need?</p>
    ${QUICK_TYPES.map(([type, label]) => `<button class="quick-need" type="button" data-quick-type="${type}" aria-pressed="false">${label}</button>`).join("")}
    <button class="quick-need" type="button" data-quick-type="all" aria-pressed="true">All help</button>
  `;
  search.insertAdjacentElement("afterend", container);

  container.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-need");
    if (!button) return;
    setLayerSelection(button.dataset.quickType);
    syncQuickNeeds(container);
    document.getElementById("resourceGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    <span><b aria-hidden="true">✓</b>No account</span>
    <span><b aria-hidden="true">✓</b>No paywall</span>
    <span><b aria-hidden="true">✓</b>Original sources</span>
    <a href="/editorial-policy">How listings are checked</a>
  `;
  intro.append(trust);
}

function installBrowseByNeed() {
  const results = document.querySelector(".results-section");
  if (!results || document.querySelector(".browse-needs")) return;
  const section = document.createElement("section");
  section.className = "browse-needs";
  section.setAttribute("aria-labelledby", "browse-needs-title");
  section.innerHTML = `
    <div class="browse-needs__heading">
      <div><span class="section-kicker">Browse without the map</span><h2 id="browse-needs-title">Find help by need.</h2></div>
      <a href="/directory">Open the full text directory</a>
    </div>
    <div class="browse-needs__links">
      <a href="/directory/help/food"><strong>Food assistance</strong><span>Meals, groceries and food pantries</span></a>
      <a href="/directory/help/shelter"><strong>Shelter & housing help</strong><span>Emergency shelter and safe places to stay</span></a>
      <a href="/directory/help/health"><strong>Health services</strong><span>Medical, dental, mental health and recovery</span></a>
      <a href="/directory/help/hygiene"><strong>Showers & hygiene</strong><span>Showers, laundry, toilets and toiletries</span></a>
      <a href="/directory/help/clothing"><strong>Clothing & essentials</strong><span>Clothes, shoes, blankets and basic items</span></a>
      <a href="/directory/help/water"><strong>Drinking water</strong><span>Water access and heat-relief services</span></a>
    </div>
  `;
  results.insertAdjacentElement("beforebegin", section);
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
  details.innerHTML = `<summary>Location, privacy & safety</summary><div class="finder-notes__body"></div>`;
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

function installGlobeGuide() {
  const stage = document.querySelector(".globe-stage");
  const results = document.querySelector(".results-section");
  if (!stage || !results) throw new Error("Globe guidance prerequisites are missing.");
  if (stage.querySelector(".globe-guide")) return;

  results.id ||= "results";
  const guide = document.createElement("div");
  guide.className = "globe-guide";
  guide.setAttribute("aria-hidden", "true");
  guide.innerHTML = `<span>Drag to explore</span><i></i><span>Tap a glow for details</span><i></i><a href="#results" tabindex="-1">Prefer a list?</a>`;
  stage.append(guide);

  const dismiss = () => stage.classList.add("has-used-globe");
  stage.addEventListener("pointerdown", dismiss, { once: true, passive: true });
  stage.addEventListener("wheel", dismiss, { once: true, passive: true });
  stage.addEventListener("click", (event) => {
    if (event.target.closest(".globe-pin, .globe-cluster, canvas")) dismiss();
  }, { once: true });
}

export function installRefinements() {
  improveSearch();
  installFinderTrustBar();
  installQuickNeeds();
  compactFinderNotes();
  improveFilterSummary();
  startFinderCalm();
  installGlobeGuide();
  installBrowseByNeed();
  document.documentElement.classList.add("rwn-refined");
}