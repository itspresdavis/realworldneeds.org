import { categories, resourceTypes, resources, trustPrinciples } from "./data/resources.js";
import {
  allocationFields,
  launchGates,
  platformStatus,
  supportStages
} from "./data/platform.js";
import { createInitialTypeSet, distanceKm, matchesResource, toRad } from "./utils/geo.js";

const DEFAULT_RESOURCE = "whitechapel-mission";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function loadSavedResources() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("rwn-saved-resources") || "[]");
    return new Set(saved.filter((id) => resources.some((resource) => resource.id === id)));
  } catch {
    return new Set();
  }
}

const requestedResource = new URL(window.location.href).searchParams.get("resource");
const initialResource = resources.some((resource) => resource.id === requestedResource) ? requestedResource : DEFAULT_RESOURCE;

const state = {
  query: "",
  viewMode: "aid",
  accessMode: "all",
  activeTypes: createInitialTypeSet(),
  selectedId: initialResource,
  filtered: resources,
  userLocation: null,
  rotationLon: -8,
  rotationLat: 12,
  targetLon: null,
  targetLat: null,
  zoom: 1,
  targetZoom: 1,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  velocityLon: 0,
  velocityLat: 0,
  autoRotate: !reduceMotion,
  interactionUntil: 0,
  landRings: [],
  visibleResults: 12,
  globeVisible: true,
  ambientZoom: 1,
  savedIds: loadSavedResources(),
  savedOnly: false
};

const root = document.getElementById("root");
let pinSignature = "";
let pinElements = new Map();
let lastFrame = performance.now();

const icon = {
  globe: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
  search: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>`,
  external: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/></svg>`,
  check: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>`,
  pin: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>`,
  route: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19c4-9 10 0 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/></svg>`,
  locate: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
  copy: `<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
  arrow: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5"/></svg>`,
  info: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
  shield: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  pause: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>`,
  play: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>`,
  reset: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
  plus: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>`,
  phone: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L9 11a16 16 0 0 0 4 4l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/></svg>`,
  bookmark: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>`,
  share: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>`,
  print: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>`,
  download: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>`,
  close: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`
};

const regionViews = {
  world: { lon: -8, lat: 12, zoom: 1 },
  americas: { lon: -88, lat: 16, zoom: 1.06 },
  europeAfrica: { lon: 13, lat: 18, zoom: 1.06 },
  asia: { lon: 92, lat: 24, zoom: 1.04 },
  oceania: { lon: 145, lat: -23, zoom: 1.12 }
};

const regionGroups = {
  americas: ["North America", "South America"],
  europeAfrica: ["Europe", "Africa"],
  asia: ["Asia"],
  oceania: ["Oceania"]
};

const mapLabels = [
  { label: "NORTH AMERICA", lat: 43, lng: -105 },
  { label: "SOUTH AMERICA", lat: -17, lng: -60 },
  { label: "EUROPE", lat: 51, lng: 17 },
  { label: "AFRICA", lat: 6, lng: 21 },
  { label: "ASIA", lat: 43, lng: 88 },
  { label: "OCEANIA", lat: -24, lng: 138 }
];

function allTypes(resource) {
  return [resource.category, ...(resource.secondaryCategories || [])];
}

function categoryCount(type) {
  return resources.filter((resource) => allTypes(resource).includes(type)).length;
}

function checkedDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function latestReviewDate() {
  return [...resources].map((resource) => resource.lastChecked).sort().at(-1);
}

function directCount() {
  return resources.filter((resource) => resource.kind === "direct").length;
}

function selectedResource() {
  return state.filtered.find((resource) => resource.id === state.selectedId) || null;
}

function distanceLabel(resource) {
  if (!state.userLocation) return "";
  const distance = distanceKm(state.userLocation.lat, state.userLocation.lng, resource.lat, resource.lng);
  return distance < 10 ? `${distance.toFixed(1)} km away` : `${Math.round(distance).toLocaleString()} km away`;
}

function directionsUrl(resource) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resource.address)}`;
}

function shell() {
  root.innerHTML = `
    <a class="skip-link" href="#finder">Skip to find help</a>
    <header class="site-header" id="top">
      <a class="brand" href="#top" aria-label="Real World Needs home">
        <span class="brand__mark">${icon.globe}</span>
        <span class="brand__name"><strong>RWN</strong><small>Real World Needs</small></span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="#finder">Find help</a>
        <a href="#operations">How it works</a>
        <a href="#transparency">Transparency</a>
        <a href="#standards">Data standards</a>
      </nav>
      <a class="header-action" href="#funding">Accountability</a>
    </header>

    <main>
      <section class="finder" id="finder">
        <div class="finder__grid">
          <aside class="finder-sidebar">
            <div class="finder-intro">
              <span class="section-kicker">Find help</span>
              <h1>Real World Needs</h1>
              <p>Find free aid and services from official sources, with access conditions kept clear.</p>
            </div>

            <div class="mode-switch" aria-label="Map data mode">
              <button class="is-active" type="button" data-view-mode="aid" aria-pressed="true">Available aid</button>
              <button type="button" data-view-mode="needs" aria-pressed="false">Verified needs <span>${platformStatus.managedNeedsPublished}</span></button>
            </div>

            <div class="finder-controls" role="search">
              <label class="search-box">
                ${icon.search}
                <span class="sr-only">Search resources</span>
                <input id="resourceSearch" type="search" placeholder="Place, service, or organization" autocomplete="off">
                <button id="clearSearch" type="button" aria-label="Clear search" title="Clear search" hidden>${icon.close}</button>
              </label>
              <p class="sr-only" id="searchStatus" aria-live="polite"></p>

              <div class="filter-heading"><span>Aid layers</span><button type="button" id="toggleAll">Clear</button></div>
              <div class="layer-list" id="layerList" aria-label="Aid category filters"></div>

              <div class="filter-heading"><span>Resource type</span></div>
              <div class="access-switch" aria-label="Resource type filter">
                <button class="is-active" type="button" data-access="all" aria-pressed="true">All</button>
                <button type="button" data-access="direct" aria-pressed="false">Service sites</button>
                <button type="button" data-access="discovery" aria-pressed="false">Directories</button>
              </div>

              <button class="location-button" id="locateMe" type="button">${icon.locate}<span>Use my location</span></button>
              <p class="location-privacy">Location is used only in this browser to sort results.</p>
            </div>
          </aside>

          <section class="globe-stage" aria-label="Interactive global aid resource globe">
            <div class="globe-meta">
              <div><span class="status-dot"></span><strong>Source-backed directory</strong></div>
              <div class="globe-meta__tools">
                <span id="globeCount"></span>
                <label class="region-menu">
                  <span class="sr-only">Focus globe region</span>
                  <select id="regionFocus" aria-label="Focus globe region">
                    <option value="world">World view</option>
                    <option value="americas">Americas</option>
                    <option value="europeAfrica">Europe &amp; Africa</option>
                    <option value="asia">Asia</option>
                    <option value="oceania">Oceania</option>
                  </select>
                </label>
              </div>
            </div>
            <button class="globe-compass" id="northGlobe" type="button" title="Orient north" aria-label="Orient globe north"><span>N</span><i></i></button>
            <canvas id="globeCanvas" class="globe-canvas" tabindex="0" role="img" aria-describedby="globeHelp" aria-label="Interactive globe showing official-source aid resources"></canvas>
            <p class="sr-only" id="globeHelp">Rotate the globe by dragging or using arrow keys. Use plus and minus to zoom. Select any colored location marker for details.</p>
            <div class="globe-pin-layer" id="pinLayer"></div>
            <div class="globe-empty" id="globeEmpty" hidden></div>
            <div class="globe-controls" aria-label="Globe controls">
              <button type="button" id="toggleMotion" title="Pause globe rotation" aria-label="Pause globe rotation">${icon.pause}</button>
              <button type="button" id="resetGlobe" title="Reset globe view" aria-label="Reset globe view">${icon.reset}</button>
              <span></span>
              <button type="button" id="zoomOut" title="Zoom out" aria-label="Zoom out">${icon.minus}</button>
              <button type="button" id="zoomIn" title="Zoom in" aria-label="Zoom in">${icon.plus}</button>
            </div>
            <div class="globe-readout" id="globeReadout" aria-live="polite"></div>
            <div class="globe-legend" id="globeLegend" aria-label="Visible aid layers"></div>
          </section>

          <aside class="resource-panel" id="resourcePanel" aria-live="polite"></aside>
        </div>

        <div class="directory-status">
          <p><strong>${resources.length}</strong> source-backed records</p>
          <p><strong>${directCount()}</strong> direct service sites</p>
          <p><strong>${resourceTypes.length}</strong> aid layers</p>
          <p>Reviewed <strong>${checkedDate(latestReviewDate())}</strong></p>
        </div>

        <div class="service-boundary" role="note">
          ${icon.info}<p><strong>This directory is not emergency dispatch.</strong> If someone is in immediate danger, contact local emergency services.</p>
        </div>

        <div class="results-section">
          <div class="results-heading">
            <div><span class="section-kicker">Directory of available help</span><h2 id="resultTitle">Services you can verify</h2><p id="resultCount" aria-live="polite"></p></div>
            <div class="results-tools">
              <button class="directory-tool" type="button" id="toggleSaved" aria-pressed="false">${icon.bookmark}<span>Saved</span><b id="savedCount">0</b></button>
              <button class="directory-tool" type="button" id="downloadDirectory">${icon.download}<span>Download CSV</span></button>
            </div>
          </div>
          <div class="resource-list-head" aria-hidden="true"><span>Service</span><span>Location</span><span>Type</span><span>Aid</span><span>Access</span><span>Reviewed</span><span></span></div>
          <div class="resource-grid resource-list" id="resourceGrid" aria-label="Available aid directory"></div>
          <div class="results-actions"><button class="outline-button outline-button--dark" type="button" id="showMoreResults" hidden>Show more resources</button></div>
        </div>
      </section>

      <section class="source-band" id="standards">
        <div class="source-band__heading">
          <span class="section-kicker">Methodology</span>
          <h2>Every listing keeps its source.</h2>
          <p>The directory exists so people can act with confidence. Each entry is sourced, reviewed, and labeled for access.</p>
        </div>
        <div class="principle-grid" id="principleGrid"></div>
      </section>

      <section class="operations" id="operations">
        <div class="section-heading">
          <span class="section-kicker">Accountability process</span>
          <h2>Accountability before activity.</h2>
          <p>If and when RWN manages support, it will follow this published standard. Managed needs and funds are not live in this release.</p>
        </div>
        <ol class="support-rail" id="supportRail"></ol>
        <p class="release-note">${icon.info} No RWN-managed needs or funds are published in this release.</p>
      </section>

      <section class="transparency" id="transparency">
        <div class="transparency__intro">
          <span class="section-kicker">Transparency status</span>
          <h2>Public records start at zero.</h2>
          <p>There are no RWN-managed records yet. When activity begins, every public record must disclose the fields shown here.</p>
          <button class="text-button" type="button" data-open-launch>Why we start with zero ${icon.arrow}</button>
        </div>
        <div class="disclosure-register" aria-label="Future public record requirements">
          <div class="disclosure-register__head"><strong>Future public record must disclose</strong><span>Status</span></div>
          <div id="disclosureRows"></div>
          <p>${icon.info} Donation intake and processing are disabled in this release.</p>
        </div>
      </section>

      <section class="funding" id="funding">
        <div class="funding__heading"><span class="section-kicker">Funding controls</span><h2>Before RWN accepts money</h2><p>RWN will only process donations after these controls are live and independently verified.</p><button class="funding-button" type="button" data-open-launch>Review launch requirements ${icon.arrow}</button></div>
        <div class="allocation-track" id="allocationTrack"></div>
        <div class="donation-status"><span>${icon.shield}</span><div><strong>Donations not enabled</strong><p>${platformStatus.statusNote}</p></div></div>
      </section>

      <section class="launch-controls">
        <div class="section-heading"><span class="section-kicker">Governance register</span><h2>Required before launch</h2><p>These controls must be in place before RWN manages activity.</p></div>
        <div class="launch-register" id="launchRows"></div>
      </section>
    </main>

    <footer class="site-footer">
      <a class="footer-brand" href="#top"><span class="brand__mark">${icon.globe}</span><span><strong>RWN</strong><small>Real World Needs</small></span></a>
      <nav aria-label="Footer find help"><strong>Find help</strong><a href="#finder">Directory</a><a href="#finder">Map view</a><a href="#finder">Aid layers</a></nav>
      <nav aria-label="Footer methodology"><strong>Methodology</strong><a href="#standards">How sources are used</a><a href="#standards">Access labels</a><a href="#standards">Review policy</a></nav>
      <nav aria-label="Footer accountability"><strong>Accountability</strong><a href="#operations">Operating model</a><a href="#transparency">Transparency status</a><a href="#funding">Funding controls</a></nav>
      <nav aria-label="Footer map data"><strong>Map data</strong><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a></nav>
      <p><span class="status-dot"></span>Release boundary: ${resources.length} source-backed records · ${directCount()} direct service sites · ${resourceTypes.length} aid layers · zero RWN-managed needs or funds · donation processing disabled · no public need intake</p>
    </footer>

    <div class="status-toast" id="statusToast" role="status" aria-live="polite"></div>
    <dialog class="launch-dialog" id="launchDialog" aria-labelledby="launchDialogTitle">
      <button class="dialog-close" type="button" aria-label="Close launch requirements">${icon.close}</button>
      <div><span class="section-kicker">Current boundary</span><h2 id="launchDialogTitle">Requirements before RWN operations go live</h2><p>These are launch controls, not claims about RWN's current legal or operational status.</p><div class="dialog-requirements" id="dialogRequirements"></div></div>
    </dialog>
  `;
}

function notify(message) {
  const toast = document.getElementById("statusToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(notify.timeoutId);
  notify.timeoutId = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function renderStatic() {
  document.getElementById("layerList").innerHTML = resourceTypes.map((type) => {
    const category = categories[type];
    return `
      <button class="layer-toggle is-active" type="button" data-type="${type}" style="--layer:${category.color};--glow:${category.glow}" aria-pressed="true">
        <span class="layer-toggle__swatch"></span><span>${category.label}</span><strong>${categoryCount(type)}</strong><span class="layer-toggle__check">${icon.check}</span>
      </button>
    `;
  }).join("");

  document.getElementById("principleGrid").innerHTML = trustPrinciples.map((principle, index) => `
    <article><span>0${index + 1}</span><div><h3>${principle.title}</h3><p>${principle.text}</p></div></article>
  `).join("");

  document.getElementById("supportRail").innerHTML = supportStages.map((stage, index) => `
    <li><span>${index + 1}</span><div><h3>${stage.label}</h3><p>${stage.description}</p></div></li>
  `).join("");

  const disclosureFields = [...allocationFields, ["Review history", "Corrections and public review dates"]];
  document.getElementById("disclosureRows").innerHTML = disclosureFields.map(([label]) => `
    <div><strong>${label}</strong><span>Not live</span></div>
  `).join("");

  document.getElementById("allocationTrack").innerHTML = allocationFields.map(([label, description], index) => `
    <article><span>0${index + 1}</span><div><h3>${label}</h3><p>${description}</p></div></article>
  `).join("");

  document.getElementById("launchRows").innerHTML = launchGates.map(([label, description]) => `
    <div><strong>${label}</strong><p>${description}</p><span>Required before launch</span></div>
  `).join("");

  document.getElementById("dialogRequirements").innerHTML = launchGates.map(([label, description]) => `
    <section><h3>${label}</h3><p>${description}</p><span>Required</span></section>
  `).join("");
}

function kindLabel(resource) {
  if (resource.kind === "direct") return "Direct service site";
  if (resource.kind === "locator") return "Official locator";
  return "Partner network";
}

function updateFilters() {
  const base = state.viewMode === "aid"
    ? resources.filter((resource) => matchesResource(resource, state.query, state.activeTypes))
    : [];
  let accessFiltered = base.filter((resource) => {
    if (state.accessMode === "direct") return resource.kind === "direct";
    if (state.accessMode === "discovery") return resource.kind !== "direct";
    return true;
  });
  if (state.savedOnly) accessFiltered = accessFiltered.filter((resource) => state.savedIds.has(resource.id));

  state.filtered = state.userLocation
    ? [...accessFiltered].sort((a, b) => distanceKm(state.userLocation.lat, state.userLocation.lng, a.lat, a.lng) - distanceKm(state.userLocation.lat, state.userLocation.lng, b.lat, b.lng))
    : accessFiltered;
  state.visibleResults = 12;

  if (!state.filtered.some((resource) => resource.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }

  renderControls();
  renderResourcePanel();
  renderResults();
  pinSignature = "";
}

function renderControls() {
  const aidMode = state.viewMode === "aid";
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    const active = button.dataset.viewMode === state.viewMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-access]").forEach((button) => {
    const active = button.dataset.access === state.accessMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !aidMode;
  });
  document.querySelectorAll("[data-type]").forEach((button) => {
    const active = state.activeTypes.has(button.dataset.type);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !aidMode;
  });
  document.getElementById("resourceSearch").disabled = !aidMode;
  document.getElementById("clearSearch").hidden = !state.query;
  document.getElementById("locateMe").disabled = !aidMode;
  document.getElementById("toggleAll").disabled = !aidMode;
  document.getElementById("toggleAll").textContent = state.activeTypes.size === resourceTypes.length ? "Clear" : "Show all";
  document.getElementById("globeCount").textContent = aidMode ? `${state.filtered.length} visible` : "0 published";
  document.getElementById("searchStatus").textContent = aidMode ? `${state.filtered.length} matching resources` : "No verified needs published";
  const savedToggle = document.getElementById("toggleSaved");
  savedToggle.classList.toggle("is-active", state.savedOnly);
  savedToggle.setAttribute("aria-pressed", String(state.savedOnly));
  document.getElementById("savedCount").textContent = String(state.savedIds.size);

  document.getElementById("globeLegend").innerHTML = aidMode
    ? resourceTypes.filter((type) => state.activeTypes.has(type)).map((type) => `<span style="--legend:${categories[type].color}"><i></i>${categories[type].label}</span>`).join("")
    : `<span><i></i>Verified needs</span>`;

  const empty = document.getElementById("globeEmpty");
  empty.hidden = state.filtered.length > 0;
  empty.innerHTML = state.viewMode === "needs"
    ? `<strong>No verified needs published</strong><p>RWN does not infer need locations or publish unreviewed requests.</p>`
    : state.savedOnly
      ? `<strong>No saved services match</strong><p>Turn off Saved or adjust the current filters.</p>`
      : `<strong>No matching services</strong><p>Adjust the search, layers, or resource type.</p>`;
}

function serviceLayerTags(resource) {
  return allTypes(resource).map((type) => `<span style="--tag:${categories[type].color}" title="${categories[type].label}"><i></i><b>${categories[type].label}</b></span>`).join("");
}

function renderResourcePanel() {
  const panel = document.getElementById("resourcePanel");
  const resource = selectedResource();
  if (!resource) {
    panel.innerHTML = `
      <div class="panel-empty"><span>${icon.shield}</span><h2>${state.viewMode === "needs" ? "No verified needs published" : "No matching service"}</h2><p>${state.viewMode === "needs" ? "The needs layer remains empty until RWN review and safeguarding controls are operational." : "Adjust the current filters to continue searching."}</p></div>
    `;
    return;
  }

  const category = categories[resource.category];
  const saved = state.savedIds.has(resource.id);
  panel.style.setProperty("--accent", category.color);
  panel.innerHTML = `
    <div class="panel-source"><span>${icon.check} Official source linked</span><a href="#standards">About sources ${icon.arrow}</a></div>
    <div class="panel-title"><span class="panel-pin">${icon.pin}</span><div><h2>${resource.name}</h2><p>${resource.city}, ${resource.country}</p></div></div>
    <p class="panel-summary">${resource.summary}</p>
    <div class="service-tags">${serviceLayerTags(resource)}</div>
    <dl class="panel-facts">
      <div><dt>Access</dt><dd>${resource.accessType}</dd></div>
      <div><dt>Cost</dt><dd>${resource.costNote}</dd></div>
      <div><dt>${resource.kind === "direct" ? "Address" : "Coverage"}</dt><dd>${resource.address}</dd></div>
      ${resource.phone ? `<div><dt>Phone</dt><dd><a href="tel:${resource.phone.replace(/[^+\d]/g, "")}">${resource.phone}</a></dd></div>` : ""}
      ${state.userLocation ? `<div><dt>Distance</dt><dd>${distanceLabel(resource)}</dd></div>` : ""}
      <div><dt>Reviewed</dt><dd><time datetime="${resource.lastChecked}">${checkedDate(resource.lastChecked)}</time></dd></div>
      <div><dt>Source</dt><dd>${resource.sourceKind} · ${kindLabel(resource)}</dd></div>
    </dl>
    <div class="panel-services"><h3>What they can help with</h3><ul>${resource.services.map((service) => `<li>${icon.check}<span>${service}</span></li>`).join("")}</ul></div>
    <div class="availability-note"><span>${icon.info}</span><p><strong>Confirm before travel</strong>${resource.availabilityNote}</p></div>
    <div class="panel-source-note"><span>${resource.sourceName}</span><p>${resource.sourceDetail}</p></div>
    <div class="panel-actions panel-actions--primary">
      <a class="primary-button" href="${resource.sourceUrl}" target="_blank" rel="noopener noreferrer">Open official source ${icon.external}</a>
      ${resource.kind === "direct" ? `<a class="secondary-button" href="${directionsUrl(resource)}" target="_blank" rel="noopener noreferrer">${icon.route}<span>Directions</span></a>` : ""}
    </div>
    <div class="panel-utilities">
      <button type="button" id="saveResource" aria-pressed="${saved}">${icon.bookmark}<span>${saved ? "Saved" : "Save"}</span></button>
      <button type="button" id="shareResource">${icon.share}<span>Share</span></button>
      <button type="button" id="printResource">${icon.print}<span>Print</span></button>
      <button type="button" id="copyAddress">${icon.copy}<span>Copy</span></button>
    </div>
  `;

  document.getElementById("copyAddress")?.addEventListener("click", async () => {
    await copyText(resource.address);
    notify("Address copied");
  });
  document.getElementById("saveResource")?.addEventListener("click", () => toggleSavedResource(resource.id));
  document.getElementById("shareResource")?.addEventListener("click", () => shareResource(resource));
  document.getElementById("printResource")?.addEventListener("click", () => window.print());
}

function resourceCard(resource) {
  const category = categories[resource.category];
  const selected = resource.id === state.selectedId;
  const aidDots = allTypes(resource).map((type) => `<i style="--dot:${categories[type].color}" title="${categories[type].label}"></i>`).join("");
  return `
    <article class="resource-card resource-row ${selected ? "is-selected" : ""}" style="--accent:${category.color}">
      <button type="button" data-resource-id="${resource.id}">
        <span class="resource-row__service"><i></i><span><strong>${resource.name}</strong><small>${resource.sourceName}</small></span></span>
        <span class="resource-row__place">${resource.city}, ${resource.country}</span>
        <span class="resource-row__type">${kindLabel(resource)}</span>
        <span class="resource-row__aid">${aidDots}</span>
        <span class="resource-row__access">${state.userLocation ? distanceLabel(resource) : resource.accessType}</span>
        <time class="resource-row__reviewed" datetime="${resource.lastChecked}">${checkedDate(resource.lastChecked)}</time>
        <span class="resource-row__arrow">${icon.arrow}</span>
      </button>
    </article>
  `;
}

function renderResults() {
  const count = document.getElementById("resultCount");
  const grid = document.getElementById("resourceGrid");
  const showMore = document.getElementById("showMoreResults");
  const visibleResources = state.filtered.slice(0, state.visibleResults);
  document.getElementById("resultTitle").textContent = state.viewMode === "needs" ? "Verified needs" : state.savedOnly ? "Saved resources" : "Services you can verify";
  count.textContent = state.viewMode === "aid" ? `Showing ${visibleResources.length} of ${state.filtered.length} matching records` : "0 published records";
  grid.innerHTML = state.filtered.length
    ? visibleResources.map(resourceCard).join("")
    : `<div class="results-empty"><strong>${state.viewMode === "needs" ? "No records are published in this layer." : "No services match these filters."}</strong><p>${state.viewMode === "needs" ? "Need intake and publication are not enabled in this release." : "Try another place, service, or access type."}</p></div>`;
  showMore.hidden = state.visibleResults >= state.filtered.length;
}

function setSelected(id, focus = true) {
  state.selectedId = id;
  const resource = selectedResource();
  if (focus && resource) focusGlobeOn(resource);
  renderResourcePanel();
  renderResults();
  pinSignature = "";
  const url = new URL(window.location.href);
  url.searchParams.set("resource", id);
  window.history.replaceState({}, "", url);
  if (window.innerWidth < 900) document.getElementById("resourcePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function persistSavedResources() {
  try {
    window.localStorage.setItem("rwn-saved-resources", JSON.stringify([...state.savedIds]));
  } catch {
    notify("Saved resources are unavailable in this browser");
  }
}

function toggleSavedResource(id) {
  if (state.savedIds.has(id)) state.savedIds.delete(id);
  else state.savedIds.add(id);
  persistSavedResources();
  if (state.savedOnly) updateFilters();
  else {
    renderControls();
    renderResourcePanel();
    renderResults();
  }
  notify(state.savedIds.has(id) ? "Resource saved in this browser" : "Resource removed from saved");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement("textarea");
  input.value = value;
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

async function shareResource(resource) {
  const url = new URL(window.location.href);
  url.searchParams.set("resource", resource.id);
  const data = { title: resource.name, text: `${resource.name} · ${resource.city}, ${resource.country}`, url: url.toString() };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  await copyText(data.url);
  notify("Resource link copied");
}

function downloadDirectory() {
  const fields = ["Name", "City", "Country", "Type", "Aid", "Access", "Cost", "Address or coverage", "Reviewed", "Official source"];
  const rows = state.filtered.map((resource) => [
    resource.name,
    resource.city,
    resource.country,
    kindLabel(resource),
    allTypes(resource).map((type) => categories[type].label).join("; "),
    resource.accessType,
    resource.costNote,
    resource.address,
    resource.lastChecked,
    resource.sourceUrl
  ]);
  const csv = [fields, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rwn-source-backed-directory.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  notify(`Downloaded ${state.filtered.length} directory records`);
}

function focusGlobeOn(resource) {
  state.targetLon = resource.lng;
  state.targetLat = Math.max(-46, Math.min(46, resource.lat * 0.62));
  state.targetZoom = 1.14;
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.interactionUntil = performance.now() + 5000;
}

function projectPoint(lat, lng, width, height) {
  const radius = Math.min(width, height) * 0.405 * state.zoom * state.ambientZoom;
  const centerX = width * 0.5;
  const centerY = height * 0.51;
  const latitude = toRad(lat);
  const diff = toRad(lng - state.rotationLon);
  const centerLat = toRad(state.rotationLat);
  const cosLat = Math.cos(latitude);
  const z = Math.sin(centerLat) * Math.sin(latitude) + Math.cos(centerLat) * cosLat * Math.cos(diff);
  return {
    x: centerX + radius * cosLat * Math.sin(diff),
    y: centerY - radius * (Math.cos(centerLat) * Math.sin(latitude) - Math.sin(centerLat) * cosLat * Math.cos(diff)),
    z,
    radius,
    centerX,
    centerY
  };
}

function vectorFor(resource) {
  const lat = toRad(resource.lat);
  const lng = toRad(resource.lng);
  return { x: Math.cos(lat) * Math.cos(lng), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lng) };
}

function projectVector(vector, width, height) {
  const radius = Math.min(width, height) * 0.405 * state.zoom * state.ambientZoom;
  const lon = toRad(state.rotationLon);
  const lat = toRad(state.rotationLat);
  const equatorFront = vector.x * Math.cos(lon) + vector.z * Math.sin(lon);
  const z = Math.cos(lat) * equatorFront + Math.sin(lat) * vector.y;
  return {
    x: width * 0.5 + radius * (vector.z * Math.cos(lon) - vector.x * Math.sin(lon)),
    y: height * 0.51 - radius * (Math.cos(lat) * vector.y - Math.sin(lat) * equatorFront),
    z
  };
}

function slerp(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  if (omega < 0.0001) return a;
  const sinOmega = Math.sin(omega);
  const left = Math.sin((1 - t) * omega) / sinOmega;
  const right = Math.sin(t * omega) / sinOmega;
  return { x: a.x * left + b.x * right, y: a.y * left + b.y * right, z: a.z * left + b.z * right };
}

function drawVisiblePath(ctx, points, width, height, close = false) {
  let active = false;
  let visibleCount = 0;
  ctx.beginPath();
  for (const coordinate of points) {
    const point = projectPoint(coordinate[1], coordinate[0], width, height);
    if (point.z <= 0.015) {
      active = false;
      continue;
    }
    if (!active) {
      ctx.moveTo(point.x, point.y);
      active = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
    visibleCount += 1;
  }
  if (close && visibleCount > 3) ctx.closePath();
  return visibleCount;
}

function drawGraticule(ctx, width, height) {
  ctx.save();
  for (let lat = -60; lat <= 60; lat += 20) {
    const points = [];
    for (let lng = -180; lng <= 180; lng += 4) points.push([lng, lat]);
    drawVisiblePath(ctx, points, width, height);
    ctx.strokeStyle = lat === 0 ? "rgba(160, 221, 211, 0.19)" : "rgba(160, 211, 204, 0.09)";
    ctx.lineWidth = lat === 0 ? 0.9 : 0.6;
    ctx.stroke();
  }
  for (let lng = -180; lng < 180; lng += 20) {
    const points = [];
    for (let lat = -88; lat <= 88; lat += 3) points.push([lng, lat]);
    drawVisiblePath(ctx, points, width, height);
    ctx.strokeStyle = lng === 0 ? "rgba(160, 221, 211, 0.19)" : "rgba(160, 211, 204, 0.09)";
    ctx.lineWidth = lng === 0 ? 0.9 : 0.6;
    ctx.stroke();
  }
  ctx.restore();
}

function drawLand(ctx, width, height) {
  ctx.save();
  ctx.lineJoin = "round";
  for (const ring of state.landRings) {
    const visible = drawVisiblePath(ctx, ring, width, height, true);
    if (visible > 3) {
      ctx.fillStyle = "rgba(117, 157, 146, 0.2)";
      ctx.fill();
      ctx.strokeStyle = "rgba(187, 224, 211, 0.42)";
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMapLabels(ctx, width, height) {
  if (state.zoom < 0.9) return;
  ctx.save();
  ctx.fillStyle = "rgba(196, 224, 216, 0.28)";
  ctx.font = "700 9px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const item of mapLabels) {
    const point = projectPoint(item.lat, item.lng, width, height);
    if (point.z < 0.58) continue;
    ctx.globalAlpha = Math.min(1, (point.z - 0.52) * 2.2);
    ctx.fillText(item.label, point.x, point.y);
  }
  ctx.restore();
}

function connectionDestinations(selected) {
  return state.filtered
    .filter((resource) => resource.id !== selected.id && resource.category === selected.category)
    .sort((a, b) => distanceKm(selected.lat, selected.lng, a.lat, a.lng) - distanceKm(selected.lat, selected.lng, b.lat, b.lng))
    .slice(0, 6);
}

function drawConnections(ctx, width, height, now) {
  const selected = selectedResource();
  if (!selected || state.viewMode !== "aid") return;
  const destinations = connectionDestinations(selected);
  const start = vectorFor(selected);
  destinations.forEach((resource, index) => {
    const end = vectorFor(resource);
    ctx.beginPath();
    let drawing = false;
    for (let step = 0; step <= 52; step += 1) {
      const progress = step / 52;
      const vector = slerp(start, end, progress);
      const lift = 1 + Math.sin(progress * Math.PI) * 0.075;
      const point = projectVector({ x: vector.x * lift, y: vector.y * lift, z: vector.z * lift }, width, height);
      if (point.z <= 0.02) {
        drawing = false;
        continue;
      }
      if (!drawing) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
      drawing = true;
    }
    ctx.strokeStyle = `${categories[resource.category].color}52`;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    if (!reduceMotion) {
      const progress = ((now * 0.00008 + index * 0.17) % 1);
      const vector = slerp(start, end, progress);
      const lift = 1 + Math.sin(progress * Math.PI) * 0.075;
      const particle = projectVector({ x: vector.x * lift, y: vector.y * lift, z: vector.z * lift }, width, height);
      if (particle.z > 0.04) {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = categories[resource.category].color;
        ctx.shadowColor = categories[resource.category].color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  });
}

function drawUserLocation(ctx, width, height, now) {
  if (!state.userLocation) return;
  const point = projectPoint(state.userLocation.lat, state.userLocation.lng, width, height);
  if (point.z <= 0.03) return;
  const pulse = reduceMotion ? 12 : 10 + Math.sin(now * 0.004) * 2;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(point.x - 4, point.y);
  ctx.lineTo(point.x + 4, point.y);
  ctx.moveTo(point.x, point.y - 4);
  ctx.lineTo(point.x, point.y + 4);
  ctx.stroke();
  ctx.restore();
}

function subsolarPoint(date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return {
    lat: -23.44 * Math.cos(toRad((360 / 365.24) * (dayOfYear + 10))),
    lng: normalizeLongitude(180 - utcHours * 15)
  };
}

function drawSolarShading(ctx, width, height, centerX, centerY, radius) {
  const sun = subsolarPoint(new Date());
  const point = projectPoint(sun.lat, sun.lng, width, height);
  const dx = (point.x - centerX) / radius;
  const dy = (point.y - centerY) / radius;
  const directionLength = Math.hypot(dx, dy) || 1;
  const directionX = dx / directionLength;
  const directionY = dy / directionLength;
  const centerNight = Math.max(0, -point.z) * 0.24;
  const lightX = centerX + directionX * radius;
  const lightY = centerY + directionY * radius;
  const darkX = centerX - directionX * radius;
  const darkY = centerY - directionY * radius;
  const gradient = ctx.createLinearGradient(lightX, lightY, darkX, darkY);
  gradient.addColorStop(0, `rgba(0, 6, 14, ${0.08 + centerNight})`);
  gradient.addColorStop(0.46, `rgba(0, 7, 16, ${0.02 + centerNight})`);
  gradient.addColorStop(0.58, `rgba(0, 7, 16, ${0.18 + centerNight})`);
  gradient.addColorStop(1, `rgba(0, 5, 13, ${0.58 + centerNight})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
}

function drawGlobe(ctx, width, height, now) {
  const projected = projectPoint(0, state.rotationLon, width, height);
  const { radius, centerX, centerY } = projected;
  ctx.clearRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(centerX, centerY, radius * 0.8, centerX, centerY, radius * 1.22);
  glow.addColorStop(0, "rgba(38, 131, 146, 0.06)");
  glow.addColorStop(0.82, "rgba(33, 174, 160, 0.11)");
  glow.addColorStop(1, "rgba(33, 174, 160, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.23, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();

  const ocean = ctx.createRadialGradient(centerX - radius * 0.27, centerY - radius * 0.32, radius * 0.05, centerX, centerY, radius);
  ocean.addColorStop(0, "#17465a");
  ocean.addColorStop(0.48, "#0a2d41");
  ocean.addColorStop(1, "#031522");
  ctx.fillStyle = ocean;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  drawGraticule(ctx, width, height);
  drawLand(ctx, width, height);
  drawMapLabels(ctx, width, height);
  drawSolarShading(ctx, width, height, centerX, centerY, radius);
  drawConnections(ctx, width, height, now);
  drawUserLocation(ctx, width, height, now);

  const shade = ctx.createLinearGradient(centerX - radius, centerY, centerX + radius, centerY);
  shade.addColorStop(0, "rgba(0, 8, 17, 0.3)");
  shade.addColorStop(0.42, "rgba(0, 8, 17, 0.015)");
  shade.addColorStop(1, "rgba(0, 8, 17, 0.24)");
  ctx.fillStyle = shade;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(100, 219, 203, 0.42)";
  ctx.lineWidth = 1.4;
  ctx.shadowColor = "rgba(47, 210, 199, 0.3)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(111, 231, 212, 0.12)";
  ctx.lineWidth = 5;
  ctx.stroke();
}

function clusterVisibleResources(width, height) {
  const selected = selectedResource();
  const threshold = 34 - (state.zoom - 0.74) * 18;
  const entries = state.filtered
    .map((resource) => ({ resource, point: projectPoint(resource.lat, resource.lng, width, height) }))
    .filter((entry) => entry.point.z > 0.03)
    .sort((a, b) => Number(b.resource.id === selected?.id) - Number(a.resource.id === selected?.id));
  const clusters = [];

  for (const entry of entries) {
    const keepSeparate = entry.resource.id === selected?.id;
    const target = keepSeparate ? null : clusters.find((cluster) =>
      !cluster.selected && Math.hypot(cluster.x - entry.point.x, cluster.y - entry.point.y) < threshold
    );
    if (target) {
      target.members.push(entry.resource);
      target.x = target.members.reduce((sum, resource) => sum + projectPoint(resource.lat, resource.lng, width, height).x, 0) / target.members.length;
      target.y = target.members.reduce((sum, resource) => sum + projectPoint(resource.lat, resource.lng, width, height).y, 0) / target.members.length;
      target.z = Math.max(target.z, entry.point.z);
    } else {
      clusters.push({ members: [entry.resource], x: entry.point.x, y: entry.point.y, z: entry.point.z, selected: keepSeparate });
    }
  }
  return clusters;
}

function renderPins(width, height) {
  const layer = document.getElementById("pinLayer");
  const selected = selectedResource();
  const clusters = clusterVisibleResources(width, height);
  const clusterKeys = clusters.map((cluster) => cluster.members.map((resource) => resource.id).sort().join(","));
  const signature = `${state.viewMode}:${clusterKeys.join("|")}:${state.selectedId}`;
  if (pinSignature !== signature) {
    layer.innerHTML = clusters.map((cluster, index) => {
      const resource = cluster.members[0];
      const clustered = cluster.members.length > 1;
      const oneCategory = cluster.members.every((item) => item.category === resource.category);
      const color = oneCategory ? categories[resource.category].color : "#f5c45b";
      const glow = oneCategory ? categories[resource.category].glow : "rgba(245, 196, 91, 0.4)";
      const key = cluster.members.map((item) => item.id).sort().join(",");
      const kinds = [...new Set(cluster.members.map(kindLabel))].join(" and ");
      if (clustered) {
        return `<button class="globe-pin globe-cluster" type="button" data-globe-key="${key}" data-cluster-ids="${key}" style="--pin:${color};--pin-glow:${glow};--delay:${(index % 8) * -0.22}s" aria-label="Explore ${cluster.members.length} grouped resources"><span><b>${cluster.members.length}</b></span><strong>${cluster.members.length} resources in this area<small>${kinds}</small></strong></button>`;
      }
      const discoveryClass = resource.kind === "direct" ? "is-direct" : "is-discovery";
      return `<button class="globe-pin ${discoveryClass} ${resource.id === selected?.id ? "is-selected" : ""}" type="button" data-globe-key="${key}" data-pin-id="${resource.id}" style="--pin:${color};--pin-glow:${glow};--delay:${(index % 8) * -0.22}s" aria-label="Select ${resource.name}, ${kindLabel(resource)}"><span></span><strong>${resource.name}<small>${resource.city}, ${resource.country} · ${kindLabel(resource)}</small></strong></button>`;
    }).join("");
    pinElements = new Map([...layer.querySelectorAll("[data-globe-key]")].map((button) => [button.dataset.globeKey, button]));
    pinSignature = signature;
  }

  clusters.forEach((cluster) => {
    const key = cluster.members.map((resource) => resource.id).sort().join(",");
    const button = pinElements.get(key);
    if (!button) return;
    button.style.transform = `translate3d(${cluster.x}px, ${cluster.y}px, 0) scale(${0.74 + Math.max(0, cluster.z) * 0.28})`;
    button.style.opacity = String(0.5 + cluster.z * 0.5);
    button.style.pointerEvents = "auto";
    button.style.zIndex = String(Math.round(cluster.z * 100));
  });
}

function formatCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
}

function updateGlobeReadout() {
  const resource = selectedResource();
  const readout = document.getElementById("globeReadout");
  if (!readout) return;
  const content = resource
    ? `<strong>${resource.region}</strong><span>${formatCoordinate(resource.lat, "N", "S")}, ${formatCoordinate(resource.lng, "E", "W")}</span>`
    : `<strong>World view</strong><span>${state.filtered.length} visible resources</span>`;
  if (readout.innerHTML !== content) readout.innerHTML = content;
}

function normalizeLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function shortestLongitude(from, to) {
  return normalizeLongitude(to - from);
}

function advanceGlobe(now) {
  const dt = Math.min(0.04, (now - lastFrame) / 1000);
  lastFrame = now;
  let isIdle = false;
  if (state.targetLon !== null) {
    const lonGap = shortestLongitude(state.rotationLon, state.targetLon);
    const latGap = state.targetLat - state.rotationLat;
    state.rotationLon = normalizeLongitude(state.rotationLon + lonGap * Math.min(1, dt * 4.8));
    state.rotationLat += latGap * Math.min(1, dt * 4.8);
    if (Math.abs(lonGap) < 0.08 && Math.abs(latGap) < 0.08) {
      state.rotationLon = state.targetLon;
      state.rotationLat = state.targetLat;
      state.targetLon = null;
      state.targetLat = null;
    }
  } else if (!state.dragging) {
    state.rotationLon = normalizeLongitude(state.rotationLon + state.velocityLon * dt);
    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + state.velocityLat * dt));
    const friction = Math.pow(0.055, dt);
    state.velocityLon *= friction;
    state.velocityLat *= friction;
    isIdle = state.autoRotate && now > state.interactionUntil && Math.abs(state.velocityLon) < 0.12;
    if (isIdle) {
      state.rotationLon = normalizeLongitude(state.rotationLon + dt * 1.55);
      const idleLatitude = 10 + Math.sin(now * 0.000075) * 7;
      state.rotationLat += (idleLatitude - state.rotationLat) * Math.min(1, dt * 0.35);
      state.ambientZoom = 1 + Math.sin(now * 0.00016) * 0.008;
    }
  }
  if (!isIdle) state.ambientZoom += (1 - state.ambientZoom) * Math.min(1, dt * 3);
  state.zoom += (state.targetZoom - state.zoom) * Math.min(1, dt * 6);
}

function animateGlobe(now) {
  if (!state.globeVisible || document.hidden) {
    lastFrame = now;
    requestAnimationFrame(animateGlobe);
    return;
  }
  const canvas = document.getElementById("globeCanvas");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  advanceGlobe(now);
  drawGlobe(ctx, width, height, now);
  renderPins(width, height);
  updateGlobeReadout();
  requestAnimationFrame(animateGlobe);
}

function focusRegion(key, selectMatching = false) {
  const view = regionViews[key] || regionViews.world;
  state.targetLon = view.lon;
  state.targetLat = view.lat;
  state.targetZoom = view.zoom;
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.interactionUntil = performance.now() + 6000;
  if (selectMatching && regionGroups[key]) {
    const match = state.filtered.find((resource) => regionGroups[key].includes(resource.region));
    if (match) {
      state.selectedId = match.id;
      renderResourcePanel();
      renderResults();
      pinSignature = "";
    }
  }
}

function focusCluster(ids) {
  const members = ids.map((id) => resources.find((resource) => resource.id === id)).filter(Boolean);
  if (!members.length) return;
  const vector = members.reduce((sum, resource) => {
    const point = vectorFor(resource);
    return { x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z };
  }, { x: 0, y: 0, z: 0 });
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  const normalized = { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  state.targetLon = Math.atan2(normalized.z, normalized.x) * 180 / Math.PI;
  const latitude = Math.asin(normalized.y) * 180 / Math.PI;
  state.targetLat = Math.max(-48, Math.min(48, latitude * 0.68));
  state.targetZoom = Math.min(1.38, state.targetZoom + 0.2);
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.interactionUntil = performance.now() + 6000;
  notify(`Focused ${members.length} resources in this area`);
}

function extractRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

async function loadLandGeometry() {
  try {
    const response = await fetch("/data/countries.geojson");
    if (!response.ok) throw new Error(`Map data returned ${response.status}`);
    const data = await response.json();
    state.landRings = data.features.flatMap((feature) => extractRings(feature.geometry));
  } catch (error) {
    console.error("Natural Earth geometry could not be loaded.", error);
    notify("Base map could not be loaded; aid locations remain available.");
  }
}

function bindEvents() {
  const searchInput = document.getElementById("resourceSearch");
  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    updateFilters();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.query) return;
    state.query = "";
    searchInput.value = "";
    updateFilters();
  });
  document.getElementById("clearSearch").addEventListener("click", () => {
    state.query = "";
    searchInput.value = "";
    searchInput.focus();
    updateFilters();
  });

  document.getElementById("layerList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    if (state.activeTypes.has(type)) state.activeTypes.delete(type);
    else state.activeTypes.add(type);
    updateFilters();
  });

  document.getElementById("toggleAll").addEventListener("click", () => {
    state.activeTypes = state.activeTypes.size === resourceTypes.length ? new Set() : createInitialTypeSet();
    updateFilters();
  });

  document.querySelector(".access-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-access]");
    if (!button) return;
    state.accessMode = button.dataset.access;
    updateFilters();
  });

  document.querySelector(".mode-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-mode]");
    if (!button) return;
    state.viewMode = button.dataset.viewMode;
    state.selectedId = state.viewMode === "aid" ? DEFAULT_RESOURCE : null;
    updateFilters();
  });

  document.getElementById("resourceGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-resource-id]");
    if (button) setSelected(button.dataset.resourceId);
  });

  document.getElementById("pinLayer").addEventListener("click", (event) => {
    const cluster = event.target.closest("[data-cluster-ids]");
    if (cluster) {
      focusCluster(cluster.dataset.clusterIds.split(","));
      return;
    }
    const button = event.target.closest("[data-pin-id]");
    if (button) setSelected(button.dataset.pinId);
  });

  document.getElementById("showMoreResults").addEventListener("click", () => {
    state.visibleResults += 12;
    renderResults();
  });

  document.getElementById("toggleSaved").addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    updateFilters();
  });
  document.getElementById("downloadDirectory").addEventListener("click", downloadDirectory);

  document.getElementById("locateMe").addEventListener("click", () => {
    if (state.userLocation) {
      state.userLocation = null;
      const button = document.getElementById("locateMe");
      button.classList.remove("has-location");
      button.innerHTML = `${icon.locate}<span>Use my location</span>`;
      button.setAttribute("aria-label", "Use my location");
      updateFilters();
      notify("Location sorting cleared");
      return;
    }
    if (!navigator.geolocation) {
      notify("Location is not available in this browser");
      return;
    }
    const button = document.getElementById("locateMe");
    button.classList.add("is-loading");
    navigator.geolocation.getCurrentPosition((position) => {
      state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
      button.classList.remove("is-loading");
      button.classList.add("has-location");
      button.innerHTML = `${icon.check}<span>Sorted by distance</span>`;
      button.setAttribute("aria-label", "Clear location sorting");
      updateFilters();
      if (state.filtered[0]) setSelected(state.filtered[0].id);
      notify("Results sorted by approximate distance");
    }, () => {
      button.classList.remove("is-loading");
      notify("Location permission was not available");
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  });

  const canvas = document.getElementById("globeCanvas");
  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.targetLon = null;
    state.targetLat = null;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.velocityLon = 0;
    state.velocityLat = 0;
    state.interactionUntil = performance.now() + 6000;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    const lonDelta = -dx * 0.32 / state.zoom;
    const latDelta = dy * 0.24 / state.zoom;
    state.rotationLon = normalizeLongitude(state.rotationLon + lonDelta);
    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + latDelta));
    state.velocityLon = lonDelta * 35;
    state.velocityLat = latDelta * 35;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
  });
  const releasePointer = () => { state.dragging = false; };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.targetZoom = Math.max(0.74, Math.min(1.38, state.targetZoom - event.deltaY * 0.001));
    state.interactionUntil = performance.now() + 5000;
  }, { passive: false });
  canvas.addEventListener("dblclick", () => {
    state.targetZoom = Math.min(1.38, state.targetZoom + 0.16);
    state.interactionUntil = performance.now() + 5000;
  });
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 12 : 5;
    if (event.key === "ArrowLeft") state.rotationLon = normalizeLongitude(state.rotationLon - step);
    else if (event.key === "ArrowRight") state.rotationLon = normalizeLongitude(state.rotationLon + step);
    else if (event.key === "ArrowUp") state.rotationLat = Math.max(-58, state.rotationLat + step);
    else if (event.key === "ArrowDown") state.rotationLat = Math.min(58, state.rotationLat - step);
    else if (event.key === "+" || event.key === "=") state.targetZoom = Math.min(1.38, state.targetZoom + 0.1);
    else if (event.key === "-" || event.key === "_") state.targetZoom = Math.max(0.74, state.targetZoom - 0.1);
    else if (event.key === "Home") focusRegion("world");
    else if (event.key === " ") {
      state.autoRotate = !state.autoRotate;
      const motionButton = document.getElementById("toggleMotion");
      motionButton.innerHTML = state.autoRotate ? icon.pause : icon.play;
      motionButton.title = state.autoRotate ? "Pause globe rotation" : "Resume globe rotation";
      motionButton.setAttribute("aria-label", motionButton.title);
    }
    else return;
    state.targetLon = null;
    state.targetLat = null;
    state.interactionUntil = performance.now() + 5000;
    event.preventDefault();
  });

  document.getElementById("zoomIn").addEventListener("click", () => { state.targetZoom = Math.min(1.38, state.targetZoom + 0.1); state.interactionUntil = performance.now() + 5000; });
  document.getElementById("zoomOut").addEventListener("click", () => { state.targetZoom = Math.max(0.74, state.targetZoom - 0.1); state.interactionUntil = performance.now() + 5000; });
  document.getElementById("resetGlobe").addEventListener("click", () => {
    document.getElementById("regionFocus").value = "world";
    focusRegion("world");
  });
  document.getElementById("northGlobe").addEventListener("click", () => {
    state.targetLat = 0;
    state.velocityLat = 0;
    state.interactionUntil = performance.now() + 5000;
  });
  document.getElementById("regionFocus").addEventListener("change", (event) => focusRegion(event.target.value, true));
  document.getElementById("toggleMotion").addEventListener("click", (event) => {
    state.autoRotate = !state.autoRotate;
    event.currentTarget.innerHTML = state.autoRotate ? icon.pause : icon.play;
    event.currentTarget.title = state.autoRotate ? "Pause globe rotation" : "Resume globe rotation";
    event.currentTarget.setAttribute("aria-label", event.currentTarget.title);
    state.interactionUntil = 0;
  });

  const dialog = document.getElementById("launchDialog");
  document.querySelectorAll("[data-open-launch]").forEach((button) => button.addEventListener("click", () => dialog.showModal()));
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  if ("IntersectionObserver" in window) {
    const globeObserver = new IntersectionObserver(([entry]) => {
      state.globeVisible = entry.isIntersecting;
    }, { rootMargin: "160px" });
    globeObserver.observe(document.querySelector(".globe-stage"));
  }

  if (!reduceMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".source-band, .operations, .transparency, .funding, .launch-controls").forEach((element) => {
      element.classList.add("reveal");
      observer.observe(element);
    });
  }
}

shell();
renderStatic();
updateFilters();
bindEvents();
loadLandGeometry();
if (requestedResource === initialResource) focusGlobeOn(resources.find((resource) => resource.id === requestedResource));
requestAnimationFrame(animateGlobe);
