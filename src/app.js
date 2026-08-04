import { categories, resourceTypes, resources, trustPrinciples } from "./data/resources.js";
import {
  allocationFields,
  launchGates,
  ledgerColumns,
  platformStatus,
  publicLedger,
  supportStages
} from "./data/platform.js";
import { createInitialTypeSet, distanceKm, matchesResource, toRad } from "./utils/geo.js";

const DEFAULT_RESOURCE = "whitechapel-mission";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  query: "",
  viewMode: "aid",
  accessMode: "all",
  activeTypes: createInitialTypeSet(),
  selectedId: DEFAULT_RESOURCE,
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
  landRings: []
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
  close: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`
};

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
        <a href="#operations">Operations</a>
        <a href="#transparency">Transparency</a>
        <a href="#standards">Standards</a>
      </nav>
      <a class="header-action" href="#funding">How funding works</a>
    </header>

    <main>
      <section class="finder" id="finder">
        <div class="finder__grid">
          <aside class="finder-sidebar">
            <div class="finder-intro">
              <span class="section-kicker">Find help</span>
              <h1>Real World Needs</h1>
              <p>Official-source services, mapped with their access conditions intact.</p>
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
              </label>
              <p class="sr-only" id="searchStatus" aria-live="polite"></p>

              <div class="filter-heading"><span>Aid layers</span><button type="button" id="toggleAll">Clear</button></div>
              <div class="layer-list" id="layerList" aria-label="Aid category filters"></div>

              <div class="filter-heading"><span>Access</span></div>
              <div class="access-switch" aria-label="Access type filter">
                <button class="is-active" type="button" data-access="all" aria-pressed="true">All</button>
                <button type="button" data-access="direct" aria-pressed="false">Direct sites</button>
                <button type="button" data-access="discovery" aria-pressed="false">Locators</button>
              </div>

              <button class="location-button" id="locateMe" type="button">${icon.locate}<span>Use my location</span></button>
            </div>
          </aside>

          <section class="globe-stage" aria-label="Interactive global aid resource globe">
            <div class="globe-meta">
              <div><span class="status-dot"></span><strong>Source-backed directory</strong></div>
              <span id="globeCount"></span>
            </div>
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

        <div class="results-section">
          <div class="results-heading">
            <div><span class="section-kicker">Directory</span><h2 id="resultTitle">Available help</h2></div>
            <p id="resultCount" aria-live="polite"></p>
          </div>
          <div class="resource-grid" id="resourceGrid"></div>
        </div>
      </section>

      <section class="source-band" id="standards">
        <div class="source-band__heading">
          <span class="section-kicker">Directory standard</span>
          <h2>Find help without losing the source.</h2>
          <p>Hours, inventory, capacity, and eligibility can change. Every listing keeps the official source and a review date visible so people can confirm before travel.</p>
        </div>
        <div class="principle-grid" id="principleGrid"></div>
      </section>

      <section class="operations" id="operations">
        <div class="section-heading">
          <span class="section-kicker">Operating model</span>
          <h2>One accountable chain.</h2>
          <p>Future RWN-managed support will remain disabled until each handoff has ownership, controls, and publishable evidence.</p>
        </div>
        <ol class="support-rail" id="supportRail"></ol>
        <p class="release-note">${icon.info} No RWN-managed needs or funds are published in this release.</p>
      </section>

      <section class="transparency" id="transparency">
        <div class="section-heading section-heading--row">
          <div><span class="section-kicker">Transparency</span><h2>Public ledger</h2></div>
          <strong>${publicLedger.length} managed records</strong>
        </div>
        <div class="ledger-wrap" role="region" aria-label="RWN public fund ledger" tabindex="0">
          <table class="ledger-table">
            <thead><tr id="ledgerHead"></tr></thead>
            <tbody id="ledgerBody"></tbody>
          </table>
        </div>
        <div class="ledger-note">
          <p>Donation processing remains disabled until legal identity, payment controls, policies, and reconciliation are verified.</p>
          <button class="outline-button" type="button" data-open-launch>Review launch requirements</button>
        </div>
      </section>

      <section class="funding" id="funding">
        <div class="funding__heading"><span class="section-kicker">Funding trace</span><h2>What every future contribution must show</h2></div>
        <div class="allocation-track" id="allocationTrack"></div>
        <div class="donation-status"><span>${icon.shield}</span><div><strong>Donations not enabled</strong><p>${platformStatus.statusNote}</p></div></div>
      </section>

      <section class="launch-controls">
        <div class="section-heading"><span class="section-kicker">Governance</span><h2>Launch controls</h2></div>
        <div class="launch-register" id="launchRows"></div>
      </section>
    </main>

    <footer class="site-footer">
      <a class="footer-brand" href="#top"><span class="brand__mark">${icon.globe}</span><span><strong>RWN</strong><small>Real World Needs</small></span></a>
      <p>Source-backed aid discovery. No donation processing or public need intake in this release.</p>
      <nav aria-label="Footer navigation"><a href="#finder">Find help</a><a href="#operations">Operations</a><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Map data: Natural Earth</a></nav>
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

  document.getElementById("ledgerHead").innerHTML = ledgerColumns.map((column) => `<th scope="col">${column}</th>`).join("");
  document.getElementById("ledgerBody").innerHTML = publicLedger.length
    ? publicLedger.map((entry) => `<tr>${ledgerColumns.map((column) => `<td>${entry[column] || ""}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${ledgerColumns.length}">No RWN-managed funds recorded.</td></tr>`;

  document.getElementById("allocationTrack").innerHTML = allocationFields.map(([label, description], index) => `
    <article><span>0${index + 1}</span><div><h3>${label}</h3><p>${description}</p></div></article>
  `).join("");

  document.getElementById("launchRows").innerHTML = launchGates.map(([label, description]) => `
    <div><strong>${label}</strong><p>${description}</p><span>Required</span></div>
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
  const accessFiltered = base.filter((resource) => {
    if (state.accessMode === "direct") return resource.kind === "direct";
    if (state.accessMode === "discovery") return resource.kind !== "direct";
    return true;
  });

  state.filtered = state.userLocation
    ? [...accessFiltered].sort((a, b) => distanceKm(state.userLocation.lat, state.userLocation.lng, a.lat, a.lng) - distanceKm(state.userLocation.lat, state.userLocation.lng, b.lat, b.lng))
    : accessFiltered;

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
  document.getElementById("locateMe").disabled = !aidMode;
  document.getElementById("toggleAll").disabled = !aidMode;
  document.getElementById("toggleAll").textContent = state.activeTypes.size === resourceTypes.length ? "Clear" : "Show all";
  document.getElementById("globeCount").textContent = aidMode ? `${state.filtered.length} visible` : "0 published";
  document.getElementById("searchStatus").textContent = aidMode ? `${state.filtered.length} matching resources` : "No verified needs published";

  document.getElementById("globeLegend").innerHTML = aidMode
    ? resourceTypes.filter((type) => state.activeTypes.has(type)).map((type) => `<span style="--legend:${categories[type].color}"><i></i>${categories[type].label}</span>`).join("")
    : `<span><i></i>Verified needs</span>`;

  const empty = document.getElementById("globeEmpty");
  empty.hidden = state.filtered.length > 0;
  empty.innerHTML = state.viewMode === "needs"
    ? `<strong>No verified needs published</strong><p>RWN does not infer need locations or publish unreviewed requests.</p>`
    : `<strong>No matching services</strong><p>Adjust the search, layers, or access filter.</p>`;
}

function serviceLayerTags(resource) {
  return allTypes(resource).map((type) => `<span style="--tag:${categories[type].color}"><i></i>${categories[type].label}</span>`).join("");
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
  const phoneHref = resource.phone ? resource.phone.replace(/[^+\d]/g, "") : "";
  panel.style.setProperty("--accent", category.color);
  panel.innerHTML = `
    <div class="panel-source"><span>${icon.check} ${resource.sourceKind}</span><strong>${kindLabel(resource)}</strong></div>
    <div class="panel-title"><span class="panel-pin">${icon.pin}</span><div><h2>${resource.name}</h2><p>${resource.city}, ${resource.country}</p></div></div>
    <p class="panel-summary">${resource.summary}</p>
    <div class="service-tags">${serviceLayerTags(resource)}</div>
    <dl class="panel-facts">
      <div><dt>Access</dt><dd>${resource.accessType}</dd></div>
      <div><dt>Cost</dt><dd>${resource.costNote}</dd></div>
      <div><dt>${resource.kind === "direct" ? "Address" : "Coverage"}</dt><dd>${resource.address}</dd></div>
      ${state.userLocation ? `<div><dt>Distance</dt><dd>${distanceLabel(resource)}</dd></div>` : ""}
      <div><dt>Reviewed</dt><dd><time datetime="${resource.lastChecked}">${checkedDate(resource.lastChecked)}</time></dd></div>
    </dl>
    <div class="panel-services"><h3>What they can help with</h3><ul>${resource.services.map((service) => `<li>${icon.check}<span>${service}</span></li>`).join("")}</ul></div>
    <div class="availability-note"><span>${icon.info}</span><p><strong>Confirm before travel</strong>${resource.availabilityNote}</p></div>
    <div class="panel-source-note"><span>${resource.sourceName}</span><p>${resource.sourceDetail}</p></div>
    <div class="panel-actions">
      <a class="primary-button" href="${resource.sourceUrl}" target="_blank" rel="noopener noreferrer">Open official source ${icon.external}</a>
      ${resource.kind === "direct" ? `<a class="icon-action" href="${directionsUrl(resource)}" target="_blank" rel="noopener noreferrer" title="Directions" aria-label="Directions to ${resource.name}">${icon.route}</a>` : ""}
      ${resource.phone ? `<a class="icon-action" href="tel:${phoneHref}" title="Call ${resource.phone}" aria-label="Call ${resource.name}">${icon.phone}</a>` : ""}
      <button class="icon-action" type="button" id="copyAddress" title="Copy address or coverage" aria-label="Copy address or coverage">${icon.copy}</button>
    </div>
  `;

  document.getElementById("copyAddress")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(resource.address);
    notify("Address copied");
  });
}

function resourceCard(resource) {
  const category = categories[resource.category];
  const selected = resource.id === state.selectedId;
  return `
    <article class="resource-card ${selected ? "is-selected" : ""}" style="--accent:${category.color}">
      <button type="button" data-resource-id="${resource.id}">
        <span class="resource-card__top"><span>${kindLabel(resource)}</span><i></i></span>
        <strong>${resource.name}</strong>
        <span class="resource-card__place">${resource.city}, ${resource.country}</span>
        <span class="resource-card__service">${resource.services.slice(0, 2).join(" · ")}</span>
        <span class="resource-card__foot"><span>${resource.accessType}</span>${state.userLocation ? `<b>${distanceLabel(resource)}</b>` : icon.arrow}</span>
      </button>
    </article>
  `;
}

function renderResults() {
  const count = document.getElementById("resultCount");
  const grid = document.getElementById("resourceGrid");
  document.getElementById("resultTitle").textContent = state.viewMode === "aid" ? "Available help" : "Verified needs";
  count.textContent = state.viewMode === "aid" ? `${state.filtered.length} of ${resources.length} records` : "0 published records";
  grid.innerHTML = state.filtered.length
    ? state.filtered.map(resourceCard).join("")
    : `<div class="results-empty"><strong>${state.viewMode === "needs" ? "No records are published in this layer." : "No services match these filters."}</strong><p>${state.viewMode === "needs" ? "Need intake and publication are not enabled in this release." : "Try another place, service, or access type."}</p></div>`;
}

function setSelected(id, focus = true) {
  state.selectedId = id;
  const resource = selectedResource();
  if (focus && resource) focusGlobeOn(resource);
  renderResourcePanel();
  renderResults();
  pinSignature = "";
  if (window.innerWidth < 900) document.getElementById("resourcePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusGlobeOn(resource) {
  state.targetLon = resource.lng;
  state.targetLat = Math.max(-46, Math.min(46, resource.lat * 0.62));
  state.targetZoom = 1.08;
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.interactionUntil = performance.now() + 5000;
}

function projectPoint(lat, lng, width, height) {
  const radius = Math.min(width, height) * 0.405 * state.zoom;
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
  const radius = Math.min(width, height) * 0.405 * state.zoom;
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
  ctx.strokeStyle = "rgba(160, 211, 204, 0.105)";
  ctx.lineWidth = 0.7;
  for (let lat = -60; lat <= 60; lat += 20) {
    const points = [];
    for (let lng = -180; lng <= 180; lng += 4) points.push([lng, lat]);
    drawVisiblePath(ctx, points, width, height);
    ctx.stroke();
  }
  for (let lng = -180; lng < 180; lng += 20) {
    const points = [];
    for (let lat = -88; lat <= 88; lat += 3) points.push([lng, lat]);
    drawVisiblePath(ctx, points, width, height);
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

function drawConnections(ctx, width, height, now) {
  const selected = selectedResource();
  if (!selected || state.viewMode !== "aid") return;
  const destinations = state.filtered
    .filter((resource) => resource.id !== selected.id && allTypes(resource).some((type) => allTypes(selected).includes(type)))
    .slice(0, 7);
  const start = vectorFor(selected);
  destinations.forEach((resource, index) => {
    const end = vectorFor(resource);
    ctx.beginPath();
    let drawing = false;
    for (let step = 0; step <= 42; step += 1) {
      const point = projectVector(slerp(start, end, step / 42), width, height);
      if (point.z <= 0.02) {
        drawing = false;
        continue;
      }
      if (!drawing) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
      drawing = true;
    }
    ctx.strokeStyle = `${categories[resource.category].color}40`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!reduceMotion) {
      const progress = ((now * 0.00008 + index * 0.17) % 1);
      const particle = projectVector(slerp(start, end, progress), width, height);
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
  drawConnections(ctx, width, height, now);

  const shade = ctx.createLinearGradient(centerX - radius, centerY, centerX + radius, centerY);
  shade.addColorStop(0, "rgba(0, 8, 17, 0.56)");
  shade.addColorStop(0.42, "rgba(0, 8, 17, 0.04)");
  shade.addColorStop(1, "rgba(0, 8, 17, 0.42)");
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
}

function renderPins(width, height) {
  const layer = document.getElementById("pinLayer");
  const selected = selectedResource();
  const signature = `${state.viewMode}:${state.filtered.map((resource) => resource.id).join("|")}:${state.selectedId}`;
  if (pinSignature !== signature) {
    layer.innerHTML = state.filtered.map((resource, index) => {
      const category = categories[resource.category];
      return `<button class="globe-pin ${resource.id === selected?.id ? "is-selected" : ""}" type="button" data-pin-id="${resource.id}" style="--pin:${category.color};--pin-glow:${category.glow};--delay:${(index % 8) * -0.22}s" aria-label="Select ${resource.name}"><span></span><strong>${resource.name}<small>${resource.city}, ${resource.country}</small></strong></button>`;
    }).join("");
    pinElements = new Map([...layer.querySelectorAll("[data-pin-id]")].map((button) => [button.dataset.pinId, button]));
    pinSignature = signature;
  }

  state.filtered.forEach((resource) => {
    const button = pinElements.get(resource.id);
    if (!button) return;
    const point = projectPoint(resource.lat, resource.lng, width, height);
    const visible = point.z > 0.03;
    button.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) scale(${0.72 + Math.max(0, point.z) * 0.3})`;
    button.style.opacity = visible ? String(0.46 + point.z * 0.54) : "0";
    button.style.pointerEvents = visible ? "auto" : "none";
    button.style.zIndex = String(Math.round(point.z * 100));
  });
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
    if (state.autoRotate && now > state.interactionUntil && Math.abs(state.velocityLon) < 0.12) {
      state.rotationLon = normalizeLongitude(state.rotationLon + dt * 2.35);
    }
  }
  state.zoom += (state.targetZoom - state.zoom) * Math.min(1, dt * 6);
}

function animateGlobe(now) {
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
  requestAnimationFrame(animateGlobe);
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
  document.getElementById("resourceSearch").addEventListener("input", (event) => {
    state.query = event.target.value;
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
    const button = event.target.closest("[data-pin-id]");
    if (button) setSelected(button.dataset.pinId);
  });

  document.getElementById("locateMe").addEventListener("click", () => {
    if (!navigator.geolocation) {
      notify("Location is not available in this browser");
      return;
    }
    const button = document.getElementById("locateMe");
    button.classList.add("is-loading");
    navigator.geolocation.getCurrentPosition((position) => {
      state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
      button.classList.remove("is-loading");
      button.querySelector("span").textContent = "Sorted by distance";
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
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 12 : 5;
    if (event.key === "ArrowLeft") state.rotationLon = normalizeLongitude(state.rotationLon - step);
    else if (event.key === "ArrowRight") state.rotationLon = normalizeLongitude(state.rotationLon + step);
    else if (event.key === "ArrowUp") state.rotationLat = Math.max(-58, state.rotationLat + step);
    else if (event.key === "ArrowDown") state.rotationLat = Math.min(58, state.rotationLat - step);
    else if (event.key === "+" || event.key === "=") state.targetZoom = Math.min(1.38, state.targetZoom + 0.1);
    else if (event.key === "-" || event.key === "_") state.targetZoom = Math.max(0.74, state.targetZoom - 0.1);
    else return;
    state.targetLon = null;
    state.targetLat = null;
    state.interactionUntil = performance.now() + 5000;
    event.preventDefault();
  });

  document.getElementById("zoomIn").addEventListener("click", () => { state.targetZoom = Math.min(1.38, state.targetZoom + 0.1); });
  document.getElementById("zoomOut").addEventListener("click", () => { state.targetZoom = Math.max(0.74, state.targetZoom - 0.1); });
  document.getElementById("resetGlobe").addEventListener("click", () => {
    state.targetLon = -8;
    state.targetLat = 12;
    state.targetZoom = 1;
    state.velocityLon = 0;
    state.velocityLat = 0;
  });
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
requestAnimationFrame(animateGlobe);
