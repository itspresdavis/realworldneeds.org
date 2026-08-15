import * as THREE from "/vendor/three.module.js";
import { createGlobePointLayer, replaceGlobePointResources, updateGlobePointLayer } from "./globe-points.js";
import { clusterProjectedEntries } from "./utils/globe-clustering.js";
import { categories, resourceTypes, resources, trustPrinciples } from "./data/resources.js";
import { freeAccessLabel, freeAccessModels } from "./data/free-access.js";
import { fetchNearbyUsdaSites, fetchUsdaActiveCount } from "./data/live-sources.js";
import {
  cameraDistanceForSphere,
  createInitialTypeSet,
  distanceKm,
  featureGlobeView,
  formatResourcePlace,
  isExactServiceSite,
  matchesResource,
  normalizeLongitude,
  rankResourcesForLocation,
  resourceDistanceKm,
  resourceSearchScore,
  THREE_SPHERE_TEXTURE_OFFSET,
  toRad
} from "./utils/geo.js";
import {
  classifyGlobeDragIntent,
  globeViewProfile,
  pinchZoom,
  pointPickThresholdWorld,
  pointerDistance
} from "./utils/gesture.js";
import {
  clearResourceFromUrl,
  privateResourceUrl,
  resourceIdFromUrl,
  SAVED_RESOURCES_KEY
} from "./utils/privacy.js";

const DEFAULT_RESOURCE = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN_GLOBE_ZOOM = 0.82;

function maxGlobeZoom() {
  return window.innerWidth <= 600 ? 8.0 : 12.0;
}

function initialResultCount() {
  if (window.innerWidth <= 600) return 5;
  if (window.innerWidth <= 900) return 6;
  return 8;
}

function loadSavedResources() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SAVED_RESOURCES_KEY) || "[]");
    return new Set(saved.filter((id) => resources.some((resource) => resource.id === id)));
  } catch {
    return new Set();
  }
}

const requestedResource = resourceIdFromUrl(window.location.href);
const initialResource = resources.some((resource) => resource.id === requestedResource) ? requestedResource : null;

if (requestedResource && new URL(window.location.href).searchParams.has("resource")) {
  window.history.replaceState({}, "", privateResourceUrl(window.location.href, requestedResource));
}

const state = {
  query: "",
  viewMode: "aid",
  accessMode: "all",
  activeTypes: createInitialTypeSet(),
  selectedId: initialResource,
  filtered: resources,
  liveResources: [],
  liveSourceStatus: "idle",
  liveSourceError: "",
  liveNearbyAvailable: 0,
  liveNationalCount: null,
  userLocation: null,
  userLocationAccuracy: null,
  userCountry: null,
  rotationLon: -8,
  rotationLat: 12,
  targetLon: null,
  targetLat: null,
  zoom: 1,
  targetZoom: 1,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  pointerStartX: 0,
  pointerStartY: 0,
  pointerMoved: false,
  pinching: false,
  velocityLon: 0,
  velocityLat: 0,
  autoRotate: false,
  interactionUntil: 0,
  landRings: [],
  countryFeatures: [],
  detailLandRings: [],
  detailCountryFeatures: [],
  detailGeometryRequested: false,
  detailGeometryReady: false,
  focusedCountry: null,
  focusPoint: null,
  focusedRegion: null,
  visibleResults: initialResultCount(),
  globeVisible: true,
  ambientZoom: 1,
  savedIds: loadSavedResources(),
  savedOnly: false,
  inspectorOpen: Boolean(initialResource),
  clusterIds: []
};

const activeGlobePointers = new Map();
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let globeGestureHadMultiplePointers = false;

const root = document.getElementById("root");
let pinSignature = "";
let pinElements = new Map();
let lastFrame = performance.now();
let globeRenderer = null;
let globeScene = null;
let globeCamera = null;
let globeWorld = null;
let globeSurface = null;
let globeBorders = null;
let globeCountryHighlight = null;
let globeGraticule = null;
let globeAtmosphere = null;
let globeLight = null;
let globeFocusLight = null;
let globeBaseCameraDistance = 3.2;
let earthTextureImage = null;
let earthDetailTextureImage = null;
let earthDetailTextureRequested = false;
let earthDetailTextureReady = false;
let connectionGroup = null;
let connectionSignature = "";
let connectionParticles = [];
let liveSourceController = null;
let globeCanvasElement = null;
let globeStageElement = null;
let globePinLayerElement = null;
let globeReadoutElement = null;
let globeViewportWidth = 1;
let globeViewportHeight = 1;
let globeLastPinUpdate = 0;
let globeLastReadoutUpdate = 0;
let globeCloseViewActive = false;
let globePageScrollUntil = 0;
let globeLastScrollFrame = 0;
let globeServicePoints = null;
let globePointSignature = "";
const globeRaycaster = new THREE.Raycaster();
const globePointerNdc = new THREE.Vector2();
const globeProjectionVector = new THREE.Vector3();
const globeInverseWorldMatrix = new THREE.Matrix4();
const globeResourceVectorCache = new WeakMap();

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
  filter: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>`,
  menu: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  close: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`
};

const regionViews = {
  world: { label: "World view", lon: -8, lat: 12, zoom: 1 },
  americas: { label: "Americas", lon: -88, lat: 16, zoom: 1.02 },
  europeAfrica: { label: "Europe & Africa", lon: 13, lat: 18, zoom: 1.02 },
  asia: { label: "Asia", lon: 92, lat: 24, zoom: 1.02 },
  oceania: { label: "Oceania", lon: 145, lat: -23, zoom: 1.04 }
};

const countryNameAliases = {
  "South Sudan": "S. Sudan",
  "Türkiye": "Turkey",
  "United States": "United States of America"
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

function availableResources() {
  return [...resources, ...state.liveResources];
}

function isLikelyUnitedStatesPoint(location) {
  if (!location) return false;
  const { lat, lng } = location;
  return (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66)
    || (lat >= 51 && lat <= 72 && lng >= -180 && lng <= -129)
    || (lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154);
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

function reviewLabel(resource) {
  return resource.verificationMethod === "live-official-feed" ? `Live ${checkedDate(resource.lastChecked)}` : checkedDate(resource.lastChecked);
}

function distanceLabel(resource) {
  if (!state.userLocation) return "";
  const distance = resourceDistanceKm(state.userLocation, resource);
  if (distance === null) return resource.coverageNote || "Area-wide resource finder — not a service location";
  return distance < 10 ? `${distance.toFixed(1)} km away` : `${Math.round(distance).toLocaleString()} km away`;
}

function locationResultLabel(resource) {
  if (!state.userLocation) return resource.accessType;
  if (isExactServiceSite(resource)) return distanceLabel(resource);
  if (["global", "worldwide"].includes(String(resource.country).toLowerCase())) return "Worldwide resource finder";
  if (state.userCountry && resource.country === state.userCountry) return `${state.userCountry} resource finder`;
  return "Resource finder for this area";
}

function googleMapsUrl(resource, directions = false) {
  const coordinate = `${resource.lat},${resource.lng}`;
  return directions
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinate)}`;
}

function appleMapsUrl(resource, directions = false) {
  const coordinate = `${resource.lat},${resource.lng}`;
  const params = directions
    ? `daddr=${encodeURIComponent(coordinate)}&dirflg=d`
    : `q=${encodeURIComponent(resource.name)}&ll=${encodeURIComponent(coordinate)}`;
  return `https://maps.apple.com/?${params}`;
}

function directionsUrl(resource) {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    ? appleMapsUrl(resource, true)
    : googleMapsUrl(resource, true);
}

function shell() {
  root.innerHTML = `
    <a class="skip-link" href="#finder">Skip to find help</a>
    <header class="site-header" id="top">
      <a class="brand" href="#top" aria-label="Real World Needs home">
        <span class="brand__mark">${icon.globe}</span>
        <span class="brand__name"><strong>RWN</strong><small>Real World Needs</small></span>
      </a>
      <nav class="primary-nav" aria-label="Primary navigation">
        <a href="#finder" data-section-link="finder" aria-current="location">Find help</a>
        <a href="#about" data-section-link="about">How it works</a>
        <a href="#standards" data-section-link="standards">How we check</a>
        <a href="/transparency">Transparency</a>
      </nav>
      <details class="site-menu">
        <summary aria-label="Open site navigation" title="Menu">${icon.menu}</summary>
        <nav aria-label="Mobile navigation">
          <a href="#finder" data-section-link="finder" aria-current="location">Find help</a>
          <a href="#about" data-section-link="about">How it works</a>
          <a href="#standards" data-section-link="standards">How we check</a>
          <a href="/transparency">Transparency</a>
        </nav>
      </details>
      <a class="header-action" href="#finder" data-section-link="finder">Find help</a>
    </header>

    <main>
      <section class="finder" id="finder">
        <div class="finder__grid">
          <aside class="finder-sidebar">
            <div class="finder-intro">
              <h1>Find free help near you.</h1>
              <p>Search for food, shelter, health care, showers, clothing, drinking water, and other essentials. Every listing links to the organization offering the service.</p>
            </div>

            <div class="finder-search" role="search">
              <label class="search-box">
                ${icon.search}
                <span class="sr-only">Search resources</span>
                <input id="resourceSearch" type="search" placeholder="Search a place or service" autocomplete="off">
                <button id="clearSearch" type="button" aria-label="Clear search" title="Clear search" hidden>${icon.close}</button>
              </label>
              <p class="sr-only" id="searchStatus" aria-live="polite"></p>
            </div>

            <div class="location-actions">
              <button class="location-button" id="locateMe" type="button">${icon.locate}<span>Use my location</span></button>
              <button class="location-clear" id="clearLocation" type="button" hidden>Clear</button>
            </div>
            <p class="location-status" id="locationStatus" aria-live="polite">Nearby service locations appear first. Regional resource finders appear after them.</p>
            <p class="live-source-status" id="liveSourceStatus">In the United States, location search also includes current USDA summer meal sites.</p>
            <p class="location-privacy">Your exact location stays on your device. For U.S. meal searches, the USDA receives only an approximate area. <a href="/privacy#location">How location works</a></p>
            <p class="finder-safety"><strong>Immediate danger?</strong> Contact local emergency services. RWN does not provide emergency response. <a href="/terms#urgent-help">Safety notice</a></p>

            <details class="filter-disclosure">
              <summary>${icon.filter}<strong>Filters</strong><span id="filterSummary">All 7 types of help</span></summary>
              <div class="finder-controls">
                <div class="filter-heading"><span>Types of help</span><button type="button" id="toggleAll">Clear</button></div>
                <div class="layer-list" id="layerList" aria-label="Aid category filters"></div>

                <div class="filter-heading"><span>Listing type</span></div>
                <div class="access-switch" aria-label="Resource type filter">
                  <button class="is-active" type="button" data-access="all" aria-pressed="true">All</button>
                  <button type="button" data-access="direct" aria-pressed="false">Service sites</button>
                  <button type="button" data-access="discovery" aria-pressed="false">Resource finders</button>
                </div>
              </div>
            </details>

          </aside>

          <section class="globe-stage" aria-label="Interactive globe of free essential services">
            <div class="globe-meta">
              <div><span class="status-dot"></span><strong>Service map</strong></div>
              <div class="globe-meta__tools">
                <span id="globeCount"></span>
                <span class="globe-detail-status" id="globeDetailStatus">Standard boundaries</span>
                <button class="globe-inspector-toggle" id="openInspector" type="button" hidden>Service details</button>
                <label class="region-menu">
                  <span class="sr-only">Focus globe region</span>
                  <select id="regionFocus" aria-label="Focus globe region">
                    <option value="focus" hidden>Focused view</option>
                    <option value="world" selected>World view</option>
                    <option value="americas">Americas</option>
                    <option value="europeAfrica">Europe &amp; Africa</option>
                    <option value="asia">Asia</option>
                    <option value="oceania">Oceania</option>
                  </select>
                </label>
              </div>
            </div>
            <canvas id="globeCanvas" class="globe-canvas" tabindex="0" role="img" aria-describedby="globeHelp" aria-label="Interactive globe showing free essential services and resource finders"></canvas>
            <p class="sr-only" id="globeHelp">Drag left or right to rotate. On touch screens, vertical swipes keep scrolling the page and two fingers zoom the globe. Use plus and minus, or hold Control or Command while scrolling, for precise zoom. Select a service point for details. Higher-detail boundaries and imagery load as you move closer.</p>
            <div class="globe-pin-layer" id="pinLayer"></div>
            <div class="globe-cluster-tray" id="globeClusterTray" hidden></div>
            <div class="globe-empty" id="globeEmpty" hidden></div>
            <div class="globe-controls" aria-label="Globe controls">
              <button class="globe-compass" id="northGlobe" type="button" title="Orient north" aria-label="Orient globe north"><span>N</span><i></i></button>
              <button type="button" id="zoomIn" title="Zoom in" aria-label="Zoom in">${icon.plus}</button>
              <button type="button" id="zoomOut" title="Zoom out" aria-label="Zoom out">${icon.minus}</button>
              <button type="button" id="resetGlobe" title="Reset globe view" aria-label="Reset globe view">${icon.reset}</button>
              <button type="button" id="toggleMotion" title="Resume globe rotation" aria-label="Resume globe rotation">${icon.play}</button>
            </div>
            <div class="globe-readout" id="globeReadout" aria-live="polite"></div>
            <div class="globe-legend" id="globeLegend" aria-label="Visible aid layers"></div>
            <p class="globe-gesture-hint" aria-hidden="true">Drag to explore · Pinch or scroll to zoom</p>
          </section>

          <aside class="resource-panel" id="resourcePanel" aria-live="polite"></aside>
        </div>

        <div class="directory-strip">
          <p id="catalogReach"><strong>${resources.length}</strong> listings checked against original sources <span>${directCount()} service locations</span> <span>17,442 active USDA summer meal sites in the latest data review</span> <a href="/directory">Use the text directory</a></p>
          <p role="note">${icon.info}<span>If someone is in immediate danger, contact local emergency services. RWN does not provide emergency response.</span></p>
        </div>

        <div class="results-section">
          <div class="results-heading">
            <div><span class="section-kicker">Search results</span><h2 id="resultTitle">Find a service</h2><p id="resultCount" aria-live="polite"></p></div>
            <div class="results-tools">
              <button class="directory-tool" type="button" id="toggleSaved" aria-pressed="false">${icon.bookmark}<span>Saved</span><b id="savedCount">0</b></button>
              <button class="directory-tool" type="button" id="downloadDirectory">${icon.download}<span>Download CSV</span></button>
            </div>
          </div>
          <div class="resource-list-head" aria-hidden="true"><span>Service</span><span>Location</span><span>Help offered</span><span>Access</span><span>Checked</span><span></span></div>
          <div class="resource-grid resource-list" id="resourceGrid" aria-label="Available aid directory"></div>
          <div class="results-actions"><button class="outline-button outline-button--dark" type="button" id="showMoreResults" hidden>Show more resources</button></div>
        </div>
      </section>

      <section class="about-rwn" id="about">
        <div class="about-rwn__heading">
          <span class="section-kicker">How it works</span>
          <h2>One place to find the basics.</h2>
          <p>Real World Needs brings together public information about free essential services. Find a service, check the details, and contact the organization directly.</p>
        </div>
        <div class="mission-steps">
          <article><span>01</span><h3>Find</h3><p>Search by place or need. You can also use your location to see nearby services first.</p></article>
          <article><span>02</span><h3>Check</h3><p>Review the hours, cost, eligibility, contact details, and the date we last checked the source.</p></article>
          <article><span>03</span><h3>Contact</h3><p>Call the organization, visit its website, or open directions in Apple Maps or Google Maps.</p></article>
        </div>
      </section>

      <section class="source-band" id="standards">
        <div class="source-band__heading">
          <span class="section-kicker">How we check listings</span>
          <h2>Information you can check for yourself.</h2>
          <p>Each listing links to its original source and shows when we last checked it. We include cost and eligibility details whenever they apply.</p>
        </div>
        <div class="principle-grid" id="principleGrid"></div>
      </section>

      <section class="accountability" id="accountability">
        <div class="accountability__heading">
          <span class="section-kicker">About the directory</span>
          <h2>Made to help you take the next step.</h2>
          <p>RWN helps people find essential services and contact the organizations that provide them. We do not decide eligibility, reserve services, or accept donations or personal requests through this website.</p>
        </div>
        <div class="accountability-status">
          <article class="is-live"><span>${icon.search}</span><div><small>Find</small><h3>Search by need or place</h3><p>Browse service locations, regional resource finders, and recognized support networks.</p></div></article>
          <article><span>${icon.shield}</span><div><small>Check</small><h3>See the original source</h3><p>Every listing names its source, shows when it was checked, and links to the organization’s current information.</p></div></article>
          <article><span>${icon.info}</span><div><small>Contact</small><h3>Confirm before you go</h3><p>Hours, availability, and eligibility can change. Contact the organization before making a long trip.</p></div></article>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <a class="footer-brand" href="#top"><span class="brand__mark">${icon.globe}</span><span><strong>RWN</strong><small>Real World Needs</small></span></a>
      <nav aria-label="Footer explore"><strong>Explore</strong><a href="#finder">Find services</a><a href="/directory">Text directory</a><a href="#about">How it works</a></nav>
      <nav aria-label="Footer standards"><strong>About RWN</strong><a href="/transparency">Transparency</a><a href="/editorial-policy">How listings are checked</a><a href="#accountability">About the directory</a></nav>
      <nav aria-label="Footer legal"><strong>Legal &amp; trust</strong><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a><button class="footer-data-button" id="clearBrowserData" type="button">Clear browser data</button></nav>
      <nav aria-label="Footer map and imagery"><strong>Map &amp; imagery</strong><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a><a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noopener noreferrer">NASA Blue Marble</a></nav>
      <p><span class="status-dot"></span>${resources.length} listings checked against original sources · This website does not accept donations or personal requests.</p>
    </footer>

    <div class="status-toast" id="statusToast" role="status" aria-live="polite"></div>
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

}

function kindLabel(resource) {
  if (resource.kind === "direct") return "Service location";
  if (resource.kind === "locator") return "Resource finder";
  return "Service network";
}

function updateFilters() {
  const base = state.viewMode === "aid"
    ? availableResources().filter((resource) => matchesResource(resource, state.query, state.activeTypes))
    : [];
  let accessFiltered = base.filter((resource) => {
    if (state.accessMode === "direct") return resource.kind === "direct";
    if (state.accessMode === "discovery") return resource.kind !== "direct";
    return true;
  });
  if (state.savedOnly) accessFiltered = accessFiltered.filter((resource) => state.savedIds.has(resource.id));

  state.filtered = state.userLocation
    ? rankResourcesForLocation(accessFiltered, state.userLocation, state.userCountry, state.query)
    : state.query
      ? [...accessFiltered].sort((a, b) => resourceSearchScore(b, state.query) - resourceSearchScore(a, state.query) || a.name.localeCompare(b.name))
      : accessFiltered;
  state.visibleResults = initialResultCount();
  state.clusterIds = [];

  if (state.selectedId && !state.filtered.some((resource) => resource.id === state.selectedId)) {
    state.selectedId = null;
    state.inspectorOpen = false;
  }

  syncGlobePointLayer();
  renderControls();
  renderResourcePanel();
  renderResults();
  renderClusterTray();
  pinSignature = "";
}

function nearbyExactCount(maximumKm = 250) {
  if (!state.userLocation) return 0;
  return state.filtered.filter((resource) => {
    const distance = resourceDistanceKm(state.userLocation, resource);
    return distance !== null && distance <= maximumKm;
  }).length;
}

function renderLocationState() {
  const button = document.getElementById("locateMe");
  const clear = document.getElementById("clearLocation");
  const status = document.getElementById("locationStatus");
  if (!button || !clear || !status) return;
  const active = Boolean(state.userLocation);
  button.classList.toggle("has-location", active);
  button.innerHTML = active ? `${icon.locate}<span>Recenter near me</span>` : `${icon.locate}<span>Use my location</span>`;
  button.setAttribute("aria-label", active ? "Recenter the globe near my location" : "Use my location to show nearby service locations first");
  clear.hidden = !active;
  if (!active) {
    status.textContent = "Nearby service locations appear first. Regional resource finders appear after them.";
    return;
  }
  const accuracy = state.userLocationAccuracy ? `Location accuracy about ${Math.round(state.userLocationAccuracy).toLocaleString()} m.` : "";
  const country = state.userCountry ? ` Resource finders for ${state.userCountry} appear after nearby locations.` : "";
  status.textContent = `${nearbyExactCount()} service ${nearbyExactCount() === 1 ? "location" : "locations"} listed within 250 km. ${accuracy}${country}`.trim();
}

function renderLiveSourceState() {
  const status = document.getElementById("liveSourceStatus");
  const reach = document.getElementById("catalogReach");
  if (!status) return;
  if (state.liveSourceStatus === "loading") {
    status.textContent = "Checking USDA for current summer meal sites in an approximate 160 km search area…";
  } else if (state.liveSourceStatus === "loaded") {
    const visible = state.liveResources.length;
    const available = state.liveNearbyAvailable;
    const national = state.liveNationalCount ? ` · ${state.liveNationalCount.toLocaleString()} active nationally today` : "";
    status.textContent = available > visible
      ? `Showing the closest ${visible.toLocaleString()} of ${available.toLocaleString()} current USDA meal sites nearby${national}.`
      : `Showing ${visible.toLocaleString()} current USDA meal ${visible === 1 ? "site" : "sites"} nearby${national}.`;
  } else if (state.liveSourceStatus === "unavailable") {
    status.textContent = state.liveSourceError || "USDA meal-site information is temporarily unavailable. The rest of the directory is still available.";
  } else if (state.userLocation && state.userCountry !== "United States") {
    status.textContent = "USDA meal-site information covers the United States. Other services and resource finders remain available.";
  } else {
    status.textContent = "In the United States, location search also includes current USDA summer meal sites, dates, and meal times.";
  }
  if (reach && state.liveNationalCount) {
    reach.innerHTML = `<strong>${resources.length.toLocaleString()}</strong> listings checked against original sources <span>${directCount().toLocaleString()} service locations</span> <span>${state.liveNationalCount.toLocaleString()} USDA meal sites active today</span> <a href="/directory">Use the text directory</a>`;
  }
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
  renderLocationState();
  document.getElementById("toggleAll").disabled = !aidMode;
  document.getElementById("toggleAll").textContent = state.activeTypes.size === resourceTypes.length ? "Clear" : "Show all";
  const typeCount = state.activeTypes.size;
  document.getElementById("filterSummary").textContent = typeCount === resourceTypes.length
    ? `All ${resourceTypes.length} types of help`
    : `${typeCount} of ${resourceTypes.length} types of help`;
  document.getElementById("globeCount").textContent = aidMode ? `${state.filtered.length} listings` : "0 listings";
  document.getElementById("searchStatus").textContent = aidMode ? `${state.filtered.length} matching services` : "No public requests are listed";
  const savedToggle = document.getElementById("toggleSaved");
  savedToggle.classList.toggle("is-active", state.savedOnly);
  savedToggle.setAttribute("aria-pressed", String(state.savedOnly));
  document.getElementById("savedCount").textContent = String(state.savedIds.size);
  renderLiveSourceState();

  document.getElementById("globeLegend").innerHTML = aidMode
    ? resourceTypes.filter((type) => state.activeTypes.has(type)).map((type) => `<span style="--legend:${categories[type].color}"><i></i>${categories[type].label}</span>`).join("")
    : `<span><i></i>Public requests</span>`;

  const empty = document.getElementById("globeEmpty");
  empty.hidden = state.filtered.length > 0;
  empty.innerHTML = state.viewMode === "needs"
    ? `<strong>No public requests are listed</strong><p>RWN does not guess where help is needed or publish requests that have not been reviewed.</p>`
    : state.savedOnly
      ? `<strong>No saved services match</strong><p>Turn off Saved or adjust the current filters.</p>`
      : `<strong>No matching services</strong><p>Adjust the search, layers, or resource type.</p>`;
}

function serviceLayerTags(resource) {
  return allTypes(resource).map((type) => `<span style="--tag:${categories[type].color}" title="${categories[type].label}"><i></i><b>${categories[type].label}</b></span>`).join("");
}

function renderResourcePanel() {
  const panel = document.getElementById("resourcePanel");
  const grid = document.querySelector(".finder__grid");
  const inspectorToggle = document.getElementById("openInspector");
  const resource = selectedResource();
  const inspectorVisible = Boolean(resource && state.inspectorOpen);
  panel.hidden = !inspectorVisible;
  grid?.classList.toggle("is-panel-collapsed", !inspectorVisible);
  if (inspectorToggle) inspectorToggle.hidden = !resource || inspectorVisible;
  if (!resource) {
    panel.innerHTML = "";
    return;
  }
  if (!inspectorVisible) {
    panel.innerHTML = "";
    return;
  }

  const category = categories[resource.category];
  const saved = state.savedIds.has(resource.id);
  const exact = isExactServiceSite(resource);
  const resourceIndex = state.filtered.findIndex((item) => item.id === resource.id);
  const previous = resourceIndex > 0 ? state.filtered[resourceIndex - 1] : null;
  const next = resourceIndex >= 0 ? state.filtered[resourceIndex + 1] : null;
  const live = resource.verificationMethod === "live-official-feed";
  const freeModel = freeAccessModels[resource.costModel];
  const actionUrl = resource.providerUrl || resource.sourceUrl;
  const sourceAction = resource.providerUrl ? "Visit organization website" : exact ? "Visit service website" : "Find a local service";
  panel.style.setProperty("--accent", category.color);
  panel.innerHTML = `
    <div class="panel-source"><span class="panel-source__verification">${icon.check} ${live ? "Current agency data" : "Source checked"}<b>· ${freeAccessLabel(resource, true)}</b></span><span class="panel-source__actions"><a href="#standards">Review process ${icon.arrow}</a><button id="closeInspector" type="button" title="Close service details" aria-label="Close service details">${icon.close}</button></span></div>
    <div class="panel-navigation" aria-label="Move through matching resources"><button id="previousResource" type="button" ${previous ? "" : "disabled"} aria-label="Previous matching resource">${icon.arrow}</button><span>${resourceIndex + 1} of ${state.filtered.length}</span><button id="nextResource" type="button" ${next ? "" : "disabled"} aria-label="Next matching resource">${icon.arrow}</button></div>
    <div class="panel-title"><span class="panel-pin">${icon.pin}</span><div><h2>${resource.name}</h2><p>${formatResourcePlace(resource)}</p></div></div>
    <p class="panel-precision ${exact ? "is-exact" : "is-coverage"}">${exact ? `${icon.check}<span><strong>Service location</strong> — directions use the published street address.</span>` : `${icon.info}<span><strong>Resource finder</strong> — this marker shows the area served, not a place to walk in.</span>`}</p>
    <p class="panel-summary">${resource.summary}</p>
    <div class="service-tags">${serviceLayerTags(resource)}</div>
    <details class="panel-detail-disclosure" ${window.innerWidth > 1220 ? "open" : ""}>
      <summary><strong>Service details</strong><span>Cost, contact, and eligibility</span><i>${icon.plus}</i></summary>
      <div class="panel-detail-content">
        <dl class="panel-facts">
          <div><dt>Access</dt><dd>${resource.accessType}</dd></div>
          <div><dt>Cost</dt><dd><strong class="free-cost">${freeAccessLabel(resource)}</strong><span class="cost-note">${resource.costNote}</span>${freeModel ? `<small class="cost-scope">${freeModel.description}</small>` : ""}</dd></div>
          <div><dt>${exact ? "Address" : "Coverage"}</dt><dd>${resource.address}</dd></div>
          ${resource.hours ? `<div><dt>Hours</dt><dd>${resource.hours}</dd></div>` : ""}
          ${resource.phone ? `<div><dt>Phone</dt><dd><a href="tel:${resource.phone.replace(/[^+\d]/g, "")}">${resource.phone}</a></dd></div>` : ""}
          ${resource.eligibility ? `<div><dt>Eligibility</dt><dd>${resource.eligibility}</dd></div>` : ""}
          ${resource.validFrom && resource.validThrough ? `<div><dt>Active dates</dt><dd>${checkedDate(resource.validFrom)}–${checkedDate(resource.validThrough)}</dd></div>` : ""}
          ${state.userLocation && exact ? `<div><dt>Distance</dt><dd>${distanceLabel(resource)}</dd></div>` : ""}
          ${!exact && resource.coverageNote ? `<div><dt>Map note</dt><dd>${resource.coverageNote}</dd></div>` : ""}
        </dl>
        <div class="panel-services"><h3>Services offered</h3><ul>${resource.services.map((service) => `<li>${icon.check}<span>${service}</span></li>`).join("")}</ul></div>
      </div>
    </details>
    <div class="availability-note"><span>${icon.info}</span><p><strong>Confirm before you go</strong>${resource.availabilityNote}</p></div>
    <details class="panel-source-note"><summary>Where this information came from</summary><p><strong>${resource.sourceName}</strong> · ${resource.sourceKind} · ${kindLabel(resource)}</p><p>${resource.sourceDetail}</p>${resource.coordinateNote ? `<p>${resource.coordinateNote}</p>` : ""}${resource.providerUrl ? `<p><a href="${resource.sourceUrl}" target="_blank" rel="noopener noreferrer">View the original public data ${icon.external}</a></p>` : ""}<p>${live ? "Updated" : "Last checked"} <time datetime="${resource.lastChecked}">${checkedDate(resource.lastChecked)}</time></p></details>
    <div class="panel-actions panel-actions--primary">
      ${exact ? `<a class="primary-button" href="${directionsUrl(resource)}" target="_blank" rel="noopener noreferrer">${icon.route}<span>Directions</span></a>` : ""}
      <a class="secondary-button" href="${actionUrl}" target="_blank" rel="noopener noreferrer">${sourceAction} ${icon.external}</a>
    </div>
    ${exact ? `<div class="panel-map-actions"><a href="${appleMapsUrl(resource)}" target="_blank" rel="noopener noreferrer">Apple Maps</a><a href="${googleMapsUrl(resource)}" target="_blank" rel="noopener noreferrer">Google Maps</a></div>` : ""}
    <div class="panel-utilities">
      ${live ? "" : `<button type="button" id="saveResource" aria-label="${saved ? "Remove saved service" : "Save service"}" aria-pressed="${saved}">${icon.bookmark}<span>${saved ? "Saved" : "Save"}</span></button>`}
      <button type="button" id="shareResource" aria-label="Share service">${icon.share}<span>Share</span></button>
      <button type="button" id="copyAddress" aria-label="${exact ? "Copy address" : "Copy coverage"}">${icon.copy}<span>${exact ? "Copy address" : "Copy coverage"}</span></button>
    </div>
  `;

  document.getElementById("copyAddress")?.addEventListener("click", async () => {
    await copyText(resource.address);
    notify("Address copied");
  });
  document.getElementById("saveResource")?.addEventListener("click", () => toggleSavedResource(resource.id));
  document.getElementById("shareResource")?.addEventListener("click", () => shareResource(resource));
  document.getElementById("previousResource")?.addEventListener("click", () => previous && setSelected(previous.id));
  document.getElementById("nextResource")?.addEventListener("click", () => next && setSelected(next.id));
  document.getElementById("closeInspector")?.addEventListener("click", () => {
    state.inspectorOpen = false;
    renderResourcePanel();
  });
}

function resourceCard(resource) {
  const category = categories[resource.category];
  const selected = resource.id === state.selectedId;
  const aidDots = allTypes(resource).map((type) => `<i style="--dot:${categories[type].color}" title="${categories[type].label}"></i>`).join("");
  return `
    <article class="resource-card resource-row ${selected ? "is-selected" : ""}" style="--accent:${category.color}">
      <button type="button" data-resource-id="${resource.id}">
        <span class="resource-row__service"><i></i><span><strong>${resource.name}</strong><small>${resource.sourceName} · ${isExactServiceSite(resource) ? "Service location" : "Resource finder"} · <b>${freeAccessLabel(resource, true)}</b></small></span></span>
        <span class="resource-row__place">${formatResourcePlace(resource)}</span>
        <span class="resource-row__aid">${aidDots}</span>
        <span class="resource-row__access">${locationResultLabel(resource)}</span>
        <time class="resource-row__reviewed" datetime="${resource.lastChecked}">${reviewLabel(resource)}</time>
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
  document.getElementById("resultTitle").textContent = state.viewMode === "needs" ? "Public requests" : state.savedOnly ? "Saved services" : state.userLocation ? "Help near you" : "Find a service";
  count.textContent = state.viewMode === "aid"
    ? `${state.userLocation ? `${nearbyExactCount()} service locations within 250 km · ` : ""}Showing ${visibleResources.length} of ${state.filtered.length} listings`
    : "No public requests are listed";
  grid.innerHTML = state.filtered.length
    ? visibleResources.map(resourceCard).join("")
    : `<div class="results-empty"><strong>${state.viewMode === "needs" ? "No public requests are listed." : "No services match these filters."}</strong><p>${state.viewMode === "needs" ? "RWN does not accept or publish personal requests through this website." : "Try another place, service, or listing type."}</p></div>`;
  showMore.hidden = state.visibleResults >= state.filtered.length;
}

function setSelected(id, focus = true, reveal = "panel") {
  state.selectedId = id;
  state.inspectorOpen = true;
  state.clusterIds = [];
  const resource = selectedResource();
  if (focus && resource) focusGlobeOn(resource, reveal === "map");
  renderResourcePanel();
  renderResults();
  renderClusterTray();
  pinSignature = "";
  window.history.replaceState({}, "", privateResourceUrl(window.location.href, id));
  if (reveal) {
    const target = reveal === "map" ? document.querySelector(".globe-stage") : document.getElementById("resourcePanel");
    const bounds = target?.getBoundingClientRect();
    const headerOffset = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
    if (target && bounds && (bounds.top < headerOffset || bounds.bottom > window.innerHeight)) {
      if (reveal === "map") state.globeVisible = true;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    }
  }
}

function persistSavedResources() {
  try {
    window.localStorage.setItem(SAVED_RESOURCES_KEY, JSON.stringify([...state.savedIds]));
  } catch {
    notify("Saved services are unavailable in this browser");
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
  notify(state.savedIds.has(id) ? "Service saved in this browser" : "Service removed from saved");
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
  const url = resource.verificationMethod === "live-official-feed" ? new URL(googleMapsUrl(resource)) : privateResourceUrl(window.location.href, resource.id);
  const data = { title: resource.name, text: `${resource.name} · ${formatResourcePlace(resource)}`, url: url.toString() };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  await copyText(data.url);
  notify("Service link copied");
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
  anchor.download = "rwn-service-directory.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  notify(`Downloaded ${state.filtered.length} listings`);
}

function focusGlobeOn(resource, immediate = false) {
  const exact = isExactServiceSite(resource);
  const view = exact
    ? { lat: resource.lat, lng: resource.lng, zoom: window.innerWidth <= 600 ? 3.8 : 4.8 }
    : featureGlobeView(countryFeatureByName(resource.country), { lat: resource.lat, lng: resource.lng });
  state.targetLon = view.lng;
  state.targetLat = Math.max(-70, Math.min(70, view.lat));
  const serviceZoom = exact ? (window.innerWidth <= 600 ? 3.8 : 4.8) : 1.55;
  state.targetZoom = Math.min(maxGlobeZoom(), Math.max(view.zoom, serviceZoom));
  if (immediate) {
    state.rotationLon = state.targetLon;
    state.rotationLat = state.targetLat;
    state.zoom = state.targetZoom;
    state.targetLon = null;
    state.targetLat = null;
  }
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.focusPoint = { lat: resource.lat, lng: resource.lng };
  state.focusedRegion = null;
  setCountryHighlight(resource.country);
  const regionSelect = document.getElementById("regionFocus");
  if (regionSelect) regionSelect.value = "focus";
  state.interactionUntil = performance.now() + 7000;
}

function focusGlobeNearUser() {
  if (!state.userLocation) return;
  state.targetLon = state.userLocation.lng;
  state.targetLat = Math.max(-70, Math.min(70, state.userLocation.lat));
  state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 3.4 : 4.2);
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.focusPoint = { ...state.userLocation };
  state.focusedRegion = null;
  setCountryHighlight(state.userCountry);
  const regionSelect = document.getElementById("regionFocus");
  if (regionSelect) regionSelect.value = "focus";
  state.interactionUntil = performance.now() + 7000;
}

function clearUserLocation() {
  liveSourceController?.abort();
  liveSourceController = null;
  state.userLocation = null;
  state.userLocationAccuracy = null;
  state.userCountry = null;
  state.liveResources = [];
  state.liveNearbyAvailable = 0;
  state.liveNationalCount = null;
  state.liveSourceStatus = "idle";
  state.liveSourceError = "";
  document.getElementById("locateMe")?.classList.remove("has-location", "is-loading");
  updateFilters();
}

async function loadLiveResourcesNearUser() {
  if (!state.userLocation || state.userCountry !== "United States") return;
  liveSourceController?.abort();
  liveSourceController = new AbortController();
  state.liveSourceStatus = "loading";
  state.liveSourceError = "";
  renderLiveSourceState();
  const options = { signal: liveSourceController.signal };
  const [nearbyResult, countResult] = await Promise.allSettled([
    fetchNearbyUsdaSites(state.userLocation, options),
    fetchUsdaActiveCount(options)
  ]);
  if (liveSourceController?.signal.aborted) return;

  if (countResult.status === "fulfilled") state.liveNationalCount = countResult.value;
  if (nearbyResult.status === "rejected") {
    state.liveResources = [];
    state.liveNearbyAvailable = 0;
    state.liveSourceStatus = "unavailable";
    state.liveSourceError = "USDA meal-site information could not be loaded. The rest of the directory is still available.";
    updateFilters();
    return;
  }

  const ranked = nearbyResult.value
    .map((resource) => ({ resource, distance: resourceDistanceKm(state.userLocation, resource) }))
    .filter(({ distance }) => distance !== null && distance <= 250)
    .sort((a, b) => a.distance - b.distance || a.resource.name.localeCompare(b.resource.name));
  state.liveNearbyAvailable = ranked.length;
  state.liveResources = ranked.slice(0, 300).map(({ resource }) => resource);
  state.liveSourceStatus = "loaded";
  updateFilters();
}

function latLngVector(lat, lng, radius = 1) {
  const latitude = toRad(lat);
  const longitude = toRad(lng);
  const cosLat = Math.cos(latitude);
  return new THREE.Vector3(
    radius * cosLat * Math.sin(longitude),
    radius * Math.sin(latitude),
    radius * cosLat * Math.cos(longitude)
  );
}

function cachedResourceVector(resource) {
  let vector = globeResourceVectorCache.get(resource);
  if (vector) return vector;
  vector = latLngVector(resource.lat, resource.lng, 1.009);
  globeResourceVectorCache.set(resource, vector);
  return vector;
}

function projectResourceGlobePoint(resource, width, height) {
  if (!globeWorld || !globeCamera) return projectPoint(resource.lat, resource.lng, width, height);
  globeProjectionVector.copy(cachedResourceVector(resource)).applyMatrix4(globeWorld.matrixWorld);
  const scale = globeWorld.scale.x || 1;
  const depth = globeProjectionVector.z / scale;
  globeProjectionVector.project(globeCamera);
  return {
    x: (globeProjectionVector.x * 0.5 + 0.5) * width,
    y: (-globeProjectionVector.y * 0.5 + 0.5) * height,
    z: depth
  };
}

function syncGlobePointLayer() {
  if (!globeWorld || !globeRenderer) return;
  const nextSignature = state.filtered.map((resource) => resource.id).join("|");
  if (!globeServicePoints) {
    globeServicePoints = createGlobePointLayer(state.filtered, categories, {
      pixelRatio: globeRenderer.getPixelRatio?.() || 1
    });
    globePointSignature = nextSignature;
    globeWorld.add(globeServicePoints);
    globeStageElement?.classList.add("has-gpu-points");
    return;
  }
  if (nextSignature === globePointSignature) return;
  replaceGlobePointResources(globeServicePoints, state.filtered, categories);
  globePointSignature = nextSignature;
}

function texturePoint(lng, lat, width, height) {
  return {
    x: ((lng + 180) / 360) * width,
    y: ((90 - lat) / 180) * height
  };
}

function drawTextureRing(ctx, ring, width, height, fill, stroke) {
  if (ring.length < 3) return;
  const unwrapped = [];
  let previous = ring[0][0];
  let offset = 0;
  for (const [longitude, latitude] of ring) {
    const delta = longitude - previous;
    if (delta > 180) offset -= 360;
    if (delta < -180) offset += 360;
    unwrapped.push([longitude + offset, latitude]);
    previous = longitude;
  }
  for (const copy of [-360, 0, 360]) {
    ctx.beginPath();
    unwrapped.forEach(([longitude, latitude], index) => {
      const point = texturePoint(longitude + copy, latitude, width, height);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function createGlobeTexture() {
  const canvas = document.createElement("canvas");
  const activeEarthImage = earthDetailTextureImage?.complete && earthDetailTextureImage.naturalWidth > 0
    ? earthDetailTextureImage
    : earthTextureImage;
  const hasEarthImagery = activeEarthImage?.complete && activeEarthImage.naturalWidth > 0;
  const maximumTextureSize = globeRenderer?.capabilities.maxTextureSize || 4096;
  const preferredWidth = earthDetailTextureReady ? (window.innerWidth <= 600 ? 4096 : 8192) : 4096;
  canvas.width = hasEarthImagery
    ? Math.min(preferredWidth, maximumTextureSize, activeEarthImage.naturalWidth)
    : 2048;
  canvas.height = Math.round(canvas.width / 2);
  const ctx = canvas.getContext("2d");

  if (hasEarthImagery) {
    ctx.drawImage(activeEarthImage, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(1, 8, 14, 0.035)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
    ocean.addColorStop(0, "#061827");
    ocean.addColorStop(0.5, "#082538");
    ocean.addColorStop(1, "#041623");
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!hasEarthImagery) {
    state.landRings.forEach((ring, index) => {
      const palette = ["#28514f", "#2d5854", "#244a4b", "#315b55"];
      drawTextureRing(ctx, ring, canvas.width, canvas.height, palette[index % palette.length], "rgba(176, 218, 203, 0.24)");
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.offset.x = THREE_SPHERE_TEXTURE_OFFSET;
  texture.anisotropy = globeRenderer?.capabilities.getMaxAnisotropy() || 1;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function loadEarthImagery() {
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    earthTextureImage = image;
    if (globeSurface) {
      globeSurface.material.emissive.setHex(0xffffff);
      globeSurface.material.emissiveIntensity = 0.2;
      globeSurface.material.roughness = 0.94;
    }
    refreshGlobeSurface();
  };
  image.src = "/media/earth-blue-marble.jpg";
}

function loadDetailEarthImagery() {
  if (earthDetailTextureRequested || navigator.connection?.saveData || document.visibilityState === "hidden") return;
  const connectionType = String(navigator.connection?.effectiveType || "").toLowerCase();
  if (connectionType === "slow-2g" || connectionType === "2g") return;
  if ((globeRenderer?.capabilities.maxTextureSize || 0) < 4096) return;
  earthDetailTextureRequested = true;
  const status = document.getElementById("globeDetailStatus");
  if (status && state.detailGeometryReady) status.textContent = "1:10m · loading HD surface…";
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    earthDetailTextureImage = image;
    earthDetailTextureReady = true;
    refreshGlobeSurface();
    if (status) status.textContent = state.detailGeometryReady ? "1:10m · HD NASA" : "HD NASA surface";
    updateGlobeReadout();
  };
  image.onerror = () => {
    if (status && state.detailGeometryReady) status.textContent = "1:10m boundaries";
  };
  image.src = "/media/earth-blue-marble-detail.jpg";
}

function createStarField() {
  const positions = [];
  let seed = 3187;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < 180; index += 1) {
    const radius = 10 + random() * 18;
    const longitude = random() * Math.PI * 2;
    const latitude = Math.acos(2 * random() - 1);
    positions.push(
      radius * Math.sin(latitude) * Math.cos(longitude),
      radius * Math.cos(latitude),
      radius * Math.sin(latitude) * Math.sin(longitude)
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xd7eeee,
    size: 0.014,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.2,
    depthWrite: false
  }));
}

function createGraticule() {
  const positions = [];
  const addLine = (points) => {
    for (let index = 1; index < points.length; index += 1) {
      positions.push(...points[index - 1].toArray(), ...points[index].toArray());
    }
  };
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const points = [];
    for (let longitude = -180; longitude <= 180; longitude += 3) points.push(latLngVector(latitude, longitude, 1.003));
    addLine(points);
  }
  for (let longitude = -180; longitude < 180; longitude += 30) {
    const points = [];
    for (let latitude = -87; latitude <= 87; latitude += 3) points.push(latLngVector(latitude, longitude, 1.003));
    addLine(points);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xa8c9c5, transparent: true, opacity: 0.045 }));
}

function rebuildCountryBorders() {
  const rings = state.detailGeometryReady ? state.detailLandRings : state.landRings;
  if (!globeWorld || !rings.length) return;
  if (globeBorders) {
    globeBorders.geometry.dispose();
    globeBorders.material.dispose();
    globeWorld.remove(globeBorders);
  }
  const positions = [];
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index += 1) {
      const start = latLngVector(ring[index - 1][1], ring[index - 1][0], 1.006);
      const end = latLngVector(ring[index][1], ring[index][0], 1.006);
      positions.push(...start.toArray(), ...end.toArray());
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  globeBorders = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0xd8e7e1,
    transparent: true,
    opacity: state.detailGeometryReady ? 0.3 : 0.22,
    depthWrite: false
  }));
  globeWorld.add(globeBorders);
}

function featureNameForCountry(name) {
  return countryNameAliases[name] || name;
}

function resourceCountryForFeature(name) {
  return Object.entries(countryNameAliases).find(([, featureName]) => featureName === name)?.[0] || name;
}

function countryFeatureByName(name) {
  const featureName = featureNameForCountry(name);
  const features = state.detailGeometryReady ? state.detailCountryFeatures : state.countryFeatures;
  return features.find((feature) => feature.properties?.NAME === featureName) || null;
}

function setCountryHighlight(name) {
  state.focusedCountry = name || null;
  if (!globeWorld) return;
  if (globeCountryHighlight) {
    globeCountryHighlight.geometry.dispose();
    globeCountryHighlight.material.dispose();
    globeWorld.remove(globeCountryHighlight);
    globeCountryHighlight = null;
  }

  const feature = name ? countryFeatureByName(name) : null;
  if (!feature) return;
  const positions = [];
  for (const ring of extractRings(feature.geometry)) {
    for (let index = 1; index < ring.length; index += 1) {
      const start = latLngVector(ring[index - 1][1], ring[index - 1][0], 1.012);
      const end = latLngVector(ring[index][1], ring[index][0], 1.012);
      positions.push(...start.toArray(), ...end.toArray());
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  globeCountryHighlight = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0xa8ffd2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  }));
  globeCountryHighlight.renderOrder = 4;
  globeWorld.add(globeCountryHighlight);
}

function updateGlobeTexture() {
  if (!globeSurface) return;
  const previousTexture = globeSurface.material.map;
  const texture = createGlobeTexture();
  globeSurface.material.map = texture;
  globeSurface.material.emissiveMap = texture;
  globeSurface.material.needsUpdate = true;
  previousTexture?.dispose();
}

function refreshGlobeSurface() {
  if (!globeSurface) return;
  updateGlobeTexture();
  rebuildCountryBorders();
}

function initThreeGlobe() {
  const canvas = document.getElementById("globeCanvas");
  globeCanvasElement = canvas;
  globeStageElement = canvas?.closest(".globe-stage") || null;
  globePinLayerElement = document.getElementById("pinLayer");
  globeReadoutElement = document.getElementById("globeReadout");
  const updateGlobeViewport = () => {
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    globeViewportWidth = Math.max(1, rect.width);
    globeViewportHeight = Math.max(1, rect.height);
  };
  updateGlobeViewport();
  if ("ResizeObserver" in window && canvas) {
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      globeViewportWidth = Math.max(1, box.width);
      globeViewportHeight = Math.max(1, box.height);
    });
    observer.observe(canvas);
  }
  try {
    globeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    console.error("WebGL globe could not be initialized.", error);
    globeRenderer = null;
    return;
  }
  globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  globeRenderer.outputColorSpace = THREE.SRGBColorSpace;
  globeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  globeRenderer.toneMappingExposure = 1.02;
  globeRenderer.setClearColor(0x02131f, 0);

  globeScene = new THREE.Scene();
  globeCamera = new THREE.PerspectiveCamera(42, 1, 0.02, 100);
  globeCamera.position.set(0, 0, 3.2);

  globeWorld = new THREE.Group();
  globeWorld.rotation.order = "XYZ";
  globeScene.add(globeWorld);
  globeScene.add(createStarField());

  const surfaceTexture = createGlobeTexture();
  globeSurface = new THREE.Mesh(
    new THREE.SphereGeometry(1, window.innerWidth <= 600 ? 160 : 288, window.innerWidth <= 600 ? 112 : 180),
    new THREE.MeshStandardMaterial({
      map: surfaceTexture,
      emissiveMap: surfaceTexture,
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
      metalness: 0,
      roughness: 0.94
    })
  );
  globeWorld.add(globeSurface);
  syncGlobePointLayer();
  globeGraticule = createGraticule();
  globeWorld.add(globeGraticule);

  globeAtmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, window.innerWidth <= 600 ? 48 : 64, window.innerWidth <= 600 ? 32 : 40),
    new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(0x76b8cf) } },
      vertexShader: `varying vec3 vNormal; varying vec3 vEye; void main(){vec4 viewPosition=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vEye=normalize(-viewPosition.xyz);gl_Position=projectionMatrix*viewPosition;}`,
      fragmentShader: `uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vEye; void main(){float fresnel=pow(1.0-max(0.0,dot(normalize(vNormal),normalize(vEye))),4.0);gl_FragColor=vec4(glowColor,fresnel*0.16);}`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
  globeWorld.add(globeAtmosphere);

  globeScene.add(new THREE.AmbientLight(0xb9c6ca, 0.88));
  globeScene.add(new THREE.HemisphereLight(0xbad5d8, 0x0a1b23, 0.82));
  const fill = new THREE.DirectionalLight(0x7ba6b6, 0.48);
  fill.position.set(-3, 1, 4);
  globeScene.add(fill);
  globeLight = new THREE.DirectionalLight(0xf2f8ef, 1.7);
  globeScene.add(globeLight);
  globeScene.add(globeLight.target);
  globeFocusLight = new THREE.DirectionalLight(0xe5fff7, 0);
  globeScene.add(globeFocusLight);
  globeScene.add(globeFocusLight.target);

  connectionGroup = new THREE.Group();
  globeWorld.add(connectionGroup);
}

function slerpVector(start, end, progress) {
  const dot = THREE.MathUtils.clamp(start.dot(end), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 0.0001) return start.clone();
  const sinOmega = Math.sin(omega);
  return start.clone().multiplyScalar(Math.sin((1 - progress) * omega) / sinOmega)
    .add(end.clone().multiplyScalar(Math.sin(progress * omega) / sinOmega));
}

function clearConnections() {
  if (!connectionGroup) return;
  for (const child of [...connectionGroup.children]) {
    child.geometry?.dispose();
    child.material?.dispose();
    connectionGroup.remove(child);
  }
  connectionParticles = [];
}

function rebuildConnections() {
  if (!connectionGroup) return;
  const selected = selectedResource();
  const signature = selected ? `${selected.id}:${state.filtered.map((resource) => resource.id).join(",")}` : "none";
  if (signature === connectionSignature) return;
  connectionSignature = signature;
  clearConnections();
  if (!selected || !state.focusPoint || state.viewMode !== "aid") return;

  const start = latLngVector(selected.lat, selected.lng);
  connectionDestinations(selected).forEach((resource, index) => {
    const end = latLngVector(resource.lat, resource.lng);
    const points = [];
    for (let step = 0; step <= 48; step += 1) {
      const progress = step / 48;
      const lift = 1.016 + Math.sin(progress * Math.PI) * 0.075;
      points.push(slerpVector(start, end, progress).normalize().multiplyScalar(lift));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)),
      new THREE.LineBasicMaterial({ color: categories[resource.category].color, transparent: true, opacity: 0.32, depthWrite: false })
    );
    connectionGroup.add(line);
    if (!reduceMotion) {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 10, 8),
        new THREE.MeshBasicMaterial({ color: categories[resource.category].color })
      );
      connectionGroup.add(particle);
      connectionParticles.push({ particle, curve, offset: index / Math.max(1, connectionDestinations(selected).length) });
    }
  });
}

function renderThreeGlobe(width, height, now) {
  if (!globeRenderer) return false;
  const canvas = globeRenderer.domElement;
  const dprCap = width < 720 ? (state.zoom > 2.5 ? 1.6 : 1.4) : (state.zoom > 2.5 ? 2 : 1.75);
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  updateGlobePointLayer(globeServicePoints, { zoom: state.zoom, pixelRatio: dpr, opacity: 0.96 });
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    globeRenderer.setPixelRatio(dpr);
    globeRenderer.setSize(width, height, false);
    globeCamera.aspect = width / height;
    globeBaseCameraDistance = cameraDistanceForSphere(42, globeCamera.aspect, 1.055, 1.07);
    globeCamera.updateProjectionMatrix();
  }

  globeWorld.rotation.y = -toRad(state.rotationLon);
  globeWorld.rotation.x = toRad(state.rotationLat);
  globeWorld.scale.setScalar(1);
  globeWorld.updateMatrixWorld(true);
  const viewProfile = globeViewProfile(state.zoom * state.ambientZoom, { mobile: window.innerWidth <= 600 });
  if (Math.abs(globeCamera.fov - viewProfile.fov) > 0.02) {
    globeCamera.fov = viewProfile.fov;
    globeCamera.updateProjectionMatrix();
  }
  globeCamera.position.z = Math.max(viewProfile.minimumCameraDistance, globeBaseCameraDistance / viewProfile.opticalZoom);
  globeCamera.updateMatrixWorld(true);

  if (globeBorders) {
    const detailBoost = state.detailGeometryReady ? 0.12 : 0;
    globeBorders.material.opacity = Math.min(0.52, 0.18 + detailBoost + Math.max(0, state.zoom - 1) * 0.12);
  }
  if (globeGraticule) {
    globeGraticule.material.opacity = Math.min(0.12, 0.035 + Math.max(0, state.zoom - 1) * 0.025);
  }
  if (globeAtmosphere) {
    const atmosphereScale = 1 + Math.min(0.006, Math.max(0, state.zoom - 1) * 0.002);
    globeAtmosphere.scale.setScalar(atmosphereScale);
  }

  const sun = subsolarPoint(new Date());
  const sunPosition = latLngVector(sun.lat, sun.lng, 5).applyEuler(globeWorld.rotation);
  globeLight.position.copy(sunPosition);
  globeLight.target.position.set(0, 0, 0);
  globeLight.target.updateMatrixWorld();

  if (state.focusPoint && globeFocusLight) {
    const focusPosition = latLngVector(state.focusPoint.lat, state.focusPoint.lng, 4).applyEuler(globeWorld.rotation);
    globeFocusLight.position.copy(focusPosition);
    globeFocusLight.intensity = 0.3;
    globeFocusLight.target.position.set(0, 0, 0);
    globeFocusLight.target.updateMatrixWorld();
  } else if (globeFocusLight) {
    globeFocusLight.intensity = 0;
  }

  globeRenderer.render(globeScene, globeCamera);
  return true;
}

function projectGlobePoint(lat, lng, width, height) {
  if (!globeWorld || !globeCamera) return projectPoint(lat, lng, width, height);
  const worldPoint = latLngVector(lat, lng, 1.009).applyMatrix4(globeWorld.matrixWorld);
  const scale = globeWorld.scale.x || 1;
  const depth = worldPoint.z / scale;
  worldPoint.project(globeCamera);
  return {
    x: (worldPoint.x * 0.5 + 0.5) * width,
    y: (-worldPoint.y * 0.5 + 0.5) * height,
    z: depth
  };
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
    .slice(0, 3);
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
  const minimumThreshold = state.zoom > 8 ? 6 : state.zoom > 5 ? 8 : 12;
  const threshold = Math.max(minimumThreshold, (width < 600 ? 48 : 38) - Math.max(0, state.zoom - 0.86) * (state.zoom > 5 ? 5 : 7));
  const entries = [];
  let selectedEntry = null;

  for (const resource of state.filtered) {
    const point = projectResourceGlobePoint(resource, width, height);
    if (point.z <= 0.03 || point.x <= 12 || point.x >= width - 12 || point.y <= 12 || point.y >= height - 12) continue;
    const entry = { resource, point };
    if (resource.id === selected?.id) selectedEntry = entry;
    else entries.push(entry);
  }
  if (selectedEntry) entries.unshift(selectedEntry);
  return clusterProjectedEntries(entries, threshold, selected?.id || null);
}

function renderPins(width, height, now = performance.now()) {
  const ambientMotion = state.autoRotate && now > state.interactionUntil && !state.dragging && !state.pinching;
  const moving = ambientMotion || state.dragging || state.pinching || Math.abs(state.velocityLon) > 0.18 || Math.abs(state.velocityLat) > 0.18 || Math.abs(state.targetZoom - state.zoom) > 0.008 || state.targetLon !== null;
  const gpuPointsActive = Boolean(globeServicePoints);
  globeStageElement?.classList.toggle("is-globe-moving", gpuPointsActive && moving);
  if (gpuPointsActive && moving) return;
  const minInterval = gpuPointsActive ? 90 : moving ? 42 : 70;
  if (now - globeLastPinUpdate < minInterval) return;
  globeLastPinUpdate = now;
  const layer = globePinLayerElement || document.getElementById("pinLayer");
  const selected = selectedResource();
  const clusters = clusterVisibleResources(width, height);
  const clusterKeys = clusters.map((cluster) => cluster.members.map((resource) => resource.id).join(","));
  const signature = `${state.viewMode}:${clusterKeys.join("|")}:${state.selectedId}`;
  if (pinSignature !== signature) {
    layer.innerHTML = clusters.map((cluster) => {
      const resource = cluster.members[0];
      const clustered = cluster.members.length > 1;
      const oneCategory = cluster.members.every((item) => item.category === resource.category);
      const color = oneCategory ? categories[resource.category].color : "#f5c45b";
      const glow = oneCategory ? categories[resource.category].glow : "rgba(245, 196, 91, 0.4)";
      const key = cluster.members.map((item) => item.id).join(",");
      const kinds = [...new Set(cluster.members.map(kindLabel))].join(" and ");
      if (clustered) {
        return `<button class="globe-pin globe-cluster" type="button" data-globe-key="${key}" data-cluster-ids="${key}" style="--pin:${color};--pin-glow:${glow}" aria-label="Explore ${cluster.members.length} grouped listings"><span><b>${cluster.members.length}</b></span><strong>${cluster.members.length} listings in this area<small>${kinds}</small></strong></button>`;
      }
      const discoveryClass = resource.kind === "direct" ? "is-direct" : "is-discovery";
      return `<button class="globe-pin ${discoveryClass} ${resource.id === selected?.id ? "is-selected" : ""}" type="button" data-globe-key="${key}" data-pin-id="${resource.id}" style="--pin:${color};--pin-glow:${glow}" aria-label="Select ${resource.name}, ${kindLabel(resource)}" aria-current="${resource.id === selected?.id ? "true" : "false"}"><span></span><strong>${resource.name}<small>${formatResourcePlace(resource)} · ${isExactServiceSite(resource) ? "Exact site" : kindLabel(resource)}</small></strong></button>`;
    }).join("");
    pinElements = new Map([...layer.querySelectorAll("[data-globe-key]")].map((button) => [button.dataset.globeKey, button]));
    pinSignature = signature;
  }

  clusters.forEach((cluster) => {
    const key = cluster.members.map((resource) => resource.id).join(",");
    const button = pinElements.get(key);
    if (!button) return;
    button.style.transform = `translate3d(${cluster.x}px, ${cluster.y}px, 0) scale(${0.74 + Math.max(0, cluster.z) * 0.28})`;
    button.style.opacity = String(0.5 + cluster.z * 0.5);
    button.style.pointerEvents = "auto";
    button.style.zIndex = String(cluster.members.some((resource) => resource.id === selected?.id) ? 1000 : Math.round(cluster.z * 100));
  });
}

function formatCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
}

function updateGlobeReadout(now = performance.now()) {
  if (now - globeLastReadoutUpdate < 110) return;
  globeLastReadoutUpdate = now;
  const resource = selectedResource();
  const readout = globeReadoutElement || document.getElementById("globeReadout");
  if (!readout) return;
  const zoomLabel = `${state.zoom.toFixed(state.zoom < 2 ? 1 : 2)}×`;
  const detailLabel = earthDetailTextureReady
    ? "1:10m + HD NASA"
    : state.detailGeometryReady ? "high-detail boundaries" : "standard boundaries";
  const content = state.focusedRegion
    ? `<strong>${state.focusedRegion}</strong><span>${state.filtered.length} visible · ${zoomLabel} · ${detailLabel}</span>`
    : resource && state.focusPoint
    ? `<strong>${resource.country === "Global" ? resource.region : resource.country}</strong><span>${formatCoordinate(resource.lat, "N", "S")}, ${formatCoordinate(resource.lng, "E", "W")} · ${zoomLabel}</span>`
    : state.focusedCountry && state.focusPoint
      ? `<strong>${state.focusedCountry}</strong><span>${formatCoordinate(state.focusPoint.lat, "N", "S")}, ${formatCoordinate(state.focusPoint.lng, "E", "W")} · ${zoomLabel}</span>`
    : `<strong>World view</strong><span>${state.filtered.length} visible · ${zoomLabel} · ${detailLabel}</span>`;
  if (readout.innerHTML !== content) readout.innerHTML = content;
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
    const focusEase = 1 - Math.exp(-dt * 6.2);
    state.rotationLon = normalizeLongitude(state.rotationLon + lonGap * focusEase);
    state.rotationLat += latGap * focusEase;
    if (Math.abs(lonGap) < 0.08 && Math.abs(latGap) < 0.08) {
      state.rotationLon = state.targetLon;
      state.rotationLat = state.targetLat;
      state.targetLon = null;
      state.targetLat = null;
    }
  } else if (!state.dragging && !state.pinching) {
    state.rotationLon = normalizeLongitude(state.rotationLon + state.velocityLon * dt);
    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + state.velocityLat * dt));
    const friction = Math.pow(0.055, dt);
    state.velocityLon *= friction;
    state.velocityLat *= friction;
    isIdle = state.autoRotate && now > state.interactionUntil && Math.abs(state.velocityLon) < 0.12;
    if (isIdle) {
      state.rotationLon = normalizeLongitude(state.rotationLon + dt * 0.55);
      state.rotationLat += (10 - state.rotationLat) * Math.min(1, dt * 0.22);
      state.ambientZoom = 1;
    }
  }
  if (!isIdle) state.ambientZoom += (1 - state.ambientZoom) * (1 - Math.exp(-dt * 4));
  state.zoom += (state.targetZoom - state.zoom) * (1 - Math.exp(-dt * 8));
}

function animateGlobe(now) {
  if (!state.globeVisible || document.hidden) {
    lastFrame = now;
    requestAnimationFrame(animateGlobe);
    return;
  }
  const canvas = globeCanvasElement || document.getElementById("globeCanvas");
  const width = globeViewportWidth;
  const height = globeViewportHeight;
  const pageScrolling = now < globePageScrollUntil && !state.dragging && !state.pinching;
  if (pageScrolling && now - globeLastScrollFrame < 52) {
    lastFrame = now;
    requestAnimationFrame(animateGlobe);
    return;
  }
  if (pageScrolling) globeLastScrollFrame = now;
  advanceGlobe(now);

  const interactionSettled = !state.dragging
    && !state.pinching
    && Math.abs(state.velocityLon) < 0.22
    && Math.abs(state.velocityLat) < 0.22
    && Math.abs(state.targetZoom - state.zoom) < 0.025
    && state.targetLon === null;
  const deepBoundaryIntent = state.targetZoom > (window.innerWidth <= 600 ? 3.4 : 3.0);
  if ((interactionSettled || deepBoundaryIntent) && (state.zoom > 1.35 || state.targetZoom > 1.35)) loadDetailGeometry();
  const detailTextureZoom = window.innerWidth <= 600 ? 2.7 : 2.15;
  const deepTextureIntent = state.targetZoom > (window.innerWidth <= 600 ? 4.2 : 3.6);
  if ((interactionSettled || deepTextureIntent) && (state.zoom > detailTextureZoom || state.targetZoom > detailTextureZoom)) loadDetailEarthImagery();

  const closeView = state.zoom > 1.9;
  if (closeView !== globeCloseViewActive) {
    globeCloseViewActive = closeView;
    (globeStageElement || document.querySelector(".globe-stage"))?.classList.toggle("is-close-view", closeView);
  }

  if (!renderThreeGlobe(width, height, now)) {
    const dprCap = width < 720 ? (state.zoom > 2.5 ? 1.6 : 1.4) : (state.zoom > 2.5 ? 2 : 1.75);
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGlobe(ctx, width, height, now);
  }
  renderPins(width, height, now);
  updateGlobeReadout(now);
  requestAnimationFrame(animateGlobe);
}

function focusRegion(key, selectMatching = false) {
  const view = regionViews[key] || regionViews.world;
  state.targetLon = view.lon;
  state.targetLat = view.lat;
  state.targetZoom = view.zoom;
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.focusPoint = null;
  state.focusedRegion = view.label;
  setCountryHighlight(null);
  document.getElementById("regionFocus").value = key in regionViews ? key : "world";
  state.interactionUntil = performance.now() + 6000;
  if (selectMatching) {
    state.selectedId = null;
    state.inspectorOpen = false;
    renderResourcePanel();
    renderResults();
    pinSignature = "";
    window.history.replaceState({}, "", clearResourceFromUrl(window.location.href));
  }
}

function renderClusterTray() {
  const tray = document.getElementById("globeClusterTray");
  if (!tray) return;
  const members = state.clusterIds
    .map((id) => state.filtered.find((resource) => resource.id === id))
    .filter(Boolean);
  tray.hidden = !members.length;
  if (!members.length) {
    tray.innerHTML = "";
    return;
  }
  const visible = members.slice(0, 12);
  tray.innerHTML = `
    <div class="globe-cluster-tray__heading"><div><strong>${members.length} listings here</strong><span>Choose a service or resource finder</span></div><button type="button" data-close-cluster aria-label="Close grouped listings">${icon.close}</button></div>
    <div class="globe-cluster-tray__list">${visible.map((resource) => `
      <button type="button" data-cluster-resource="${resource.id}" style="--cluster-accent:${categories[resource.category].color}">
        <i></i><span><strong>${resource.name}</strong><small>${formatResourcePlace(resource)} · ${isExactServiceSite(resource) ? "Exact site" : "Official locator"}</small></span>${icon.arrow}
      </button>
    `).join("")}</div>
    ${members.length > visible.length ? `<p>${members.length - visible.length} more become visible as you zoom closer.</p>` : ""}
  `;
}

function focusCluster(ids) {
  const members = ids.map((id) => state.filtered.find((resource) => resource.id === id)).filter(Boolean);
  if (!members.length) return;
  state.clusterIds = members.map((resource) => resource.id);
  const vector = members.reduce((sum, resource) => {
    const point = vectorFor(resource);
    return { x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z };
  }, { x: 0, y: 0, z: 0 });
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  const normalized = { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  state.targetLon = Math.atan2(normalized.z, normalized.x) * 180 / Math.PI;
  const latitude = Math.asin(normalized.y) * 180 / Math.PI;
  state.targetLat = Math.max(-65, Math.min(65, latitude));
  state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 2.8 : 3.4);
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.focusPoint = { lat: latitude, lng: state.targetLon };
  state.focusedRegion = null;
  setCountryHighlight(null);
  document.getElementById("regionFocus").value = "focus";
  state.interactionUntil = performance.now() + 6000;
  renderClusterTray();
  notify(`Showing ${members.length} listings in this area`);
}

function extractRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function ringContainsCoordinate(ring, lat, lng) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const currentLng = lng + normalizeLongitude(ring[current][0] - lng);
    const previousLng = lng + normalizeLongitude(ring[previous][0] - lng);
    const currentLat = ring[current][1];
    const previousLat = ring[previous][1];
    const crossesLatitude = (currentLat > lat) !== (previousLat > lat);
    const boundaryLng = ((previousLng - currentLng) * (lat - currentLat)) / ((previousLat - currentLat) || Number.EPSILON) + currentLng;
    if (crossesLatitude && lng < boundaryLng) inside = !inside;
  }
  return inside;
}

function geometryContainsCoordinate(geometry, lat, lng) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.coordinates || [];
  return polygons.some((polygon) => {
    if (!polygon.length || !ringContainsCoordinate(polygon[0], lat, lng)) return false;
    return !polygon.slice(1).some((hole) => ringContainsCoordinate(hole, lat, lng));
  });
}

function countryAtCoordinate(lat, lng) {
  const features = state.detailGeometryReady ? state.detailCountryFeatures : state.countryFeatures;
  return features.find((feature) => geometryContainsCoordinate(feature.geometry, lat, lng)) || null;
}

function selectCountryFromPointer(event) {
  if (!globeRenderer || !globeCamera || !globeWorld || !globeSurface || !state.countryFeatures.length) return;
  const rect = globeRenderer.domElement.getBoundingClientRect();
  globePointerNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  globeWorld.updateMatrixWorld(true);
  globeCamera.updateMatrixWorld(true);
  globeRaycaster.params.Points.threshold = pointPickThresholdWorld({
    pointerType: event.pointerType,
    zoom: state.zoom,
    cameraDistance: globeCamera.position.z,
    fov: globeCamera.fov,
    viewportHeight: rect.height
  });
  globeRaycaster.setFromCamera(globePointerNdc, globeCamera);
  const surfaceHit = globeRaycaster.intersectObject(globeSurface, false)[0];
  const pointHit = globeServicePoints ? globeRaycaster.intersectObject(globeServicePoints, false)[0] : null;

  if (pointHit && (!surfaceHit || pointHit.distance <= surfaceHit.distance + 0.06)) {
    const resource = globeServicePoints.userData.resources?.[pointHit.index];
    if (resource) {
      const cluster = clusterVisibleResources(globeViewportWidth, globeViewportHeight)
        .find((candidate) => candidate.members.some((member) => member.id === resource.id));
      if (cluster?.members.length > 1) focusCluster(cluster.members.map((member) => member.id));
      else setSelected(resource.id, true, "panel");
      return;
    }
  }

  if (!surfaceHit) return;
  globeInverseWorldMatrix.copy(globeWorld.matrixWorld).invert();
  globeProjectionVector.copy(surfaceHit.point).applyMatrix4(globeInverseWorldMatrix).normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(globeProjectionVector.y, -1, 1)) * 180 / Math.PI;
  const lng = Math.atan2(globeProjectionVector.x, globeProjectionVector.z) * 180 / Math.PI;
  const country = countryAtCoordinate(lat, lng);
  if (!country) return;

  const featureName = country.properties.NAME;
  const displayName = resourceCountryForFeature(featureName);
  const matches = rankResourcesForLocation(
    state.filtered.filter((resource) => featureNameForCountry(resource.country) === featureName),
    { lat, lng },
    displayName,
    state.query
  );

  document.getElementById("regionFocus").value = "focus";
  if (matches.length) {
    setSelected(matches[0].id, false, false);
    focusGlobeOn(matches[0]);
    notify(`${displayName}: ${matches.length} ${matches.length === 1 ? "listed service" : "listed services"}`);
    return;
  }

  state.selectedId = null;
  state.inspectorOpen = false;
  const countryView = featureGlobeView(country, { lat, lng });
  state.targetLon = countryView.lng;
  state.targetLat = Math.max(-70, Math.min(70, countryView.lat));
  state.targetZoom = window.innerWidth <= 600 ? Math.min(1.06, countryView.zoom) : countryView.zoom;
  state.velocityLon = 0;
  state.velocityLat = 0;
  state.focusPoint = { lat: countryView.lat, lng: countryView.lng };
  state.focusedRegion = null;
  setCountryHighlight(displayName);
  state.interactionUntil = performance.now() + 7000;
  renderResourcePanel();
  renderResults();
  pinSignature = "";
  window.history.replaceState({}, "", clearResourceFromUrl(window.location.href));
  notify(`No listed services in ${displayName} match the current filters`);
}

async function loadDetailGeometry() {
  if (state.detailGeometryRequested) return;
  state.detailGeometryRequested = true;
  const status = document.getElementById("globeDetailStatus");
  if (navigator.connection?.saveData) {
    if (status) status.textContent = "Standard boundaries · Data Saver";
    return;
  }
  if (status) status.textContent = "Loading 1:10m boundaries…";
  try {
    const response = await fetch("/data/countries-detail.geojson", { cache: "force-cache" });
    if (!response.ok) throw new Error(`Detailed map data returned ${response.status}`);
    const data = await response.json();
    state.detailCountryFeatures = data.features;
    state.detailLandRings = data.features.flatMap((feature) => extractRings(feature.geometry));
    state.detailGeometryReady = true;
    rebuildCountryBorders();
    if (state.focusedCountry) setCountryHighlight(state.focusedCountry);
    if (status) status.textContent = earthDetailTextureReady ? "1:10m · HD NASA" : "1:10m boundaries";
    updateGlobeReadout();
  } catch (error) {
    console.warn("High-detail Natural Earth geometry could not be loaded.", error);
    if (status) status.textContent = "Standard boundaries";
  }
}

async function loadLandGeometry() {
  try {
    const response = await fetch("/data/countries.geojson");
    if (!response.ok) throw new Error(`Map data returned ${response.status}`);
    const data = await response.json();
    state.countryFeatures = data.features;
    state.landRings = data.features.flatMap((feature) => extractRings(feature.geometry));
    refreshGlobeSurface();
    if (state.userLocation && !state.userCountry) {
      const feature = countryAtCoordinate(state.userLocation.lat, state.userLocation.lng);
      state.userCountry = feature ? resourceCountryForFeature(feature.properties.NAME) : null;
      updateFilters();
    }
    const resource = selectedResource();
    if (resource && state.focusPoint) focusGlobeOn(resource);
  } catch (error) {
    console.error("Natural Earth geometry could not be loaded.", error);
    notify("Base map could not be loaded; aid locations remain available.");
  }
}

function bindEvents() {
  const searchInput = document.getElementById("resourceSearch");
  let pendingSearchValue = state.query;
  let searchFilterFrame = null;
  const flushSearchFilter = () => {
    searchFilterFrame = null;
    if (pendingSearchValue === state.query) return;
    state.query = pendingSearchValue;
    updateFilters();
  };
  const scheduleSearchFilter = (value) => {
    pendingSearchValue = value;
    if (searchFilterFrame !== null) return;
    searchFilterFrame = requestAnimationFrame(flushSearchFilter);
  };
  searchInput.addEventListener("input", (event) => {
    scheduleSearchFilter(event.target.value);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || (!state.query && !pendingSearchValue)) return;
    if (searchFilterFrame !== null) cancelAnimationFrame(searchFilterFrame);
    searchFilterFrame = null;
    pendingSearchValue = "";
    state.query = "";
    searchInput.value = "";
    updateFilters();
  });
  document.getElementById("clearSearch").addEventListener("click", () => {
    if (searchFilterFrame !== null) cancelAnimationFrame(searchFilterFrame);
    searchFilterFrame = null;
    pendingSearchValue = "";
    state.query = "";
    searchInput.value = "";
    searchInput.focus();
    updateFilters();
  });

  let catalogFilterFrame = null;
  const scheduleCatalogFilterUpdate = () => {
    if (catalogFilterFrame !== null) return;
    catalogFilterFrame = requestAnimationFrame(() => {
      catalogFilterFrame = null;
      updateFilters();
    });
  };

  document.getElementById("layerList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    if (state.activeTypes.has(type)) state.activeTypes.delete(type);
    else state.activeTypes.add(type);
    scheduleCatalogFilterUpdate();
  });

  document.getElementById("toggleAll").addEventListener("click", () => {
    state.activeTypes = state.activeTypes.size === resourceTypes.length ? new Set() : createInitialTypeSet();
    scheduleCatalogFilterUpdate();
  });

  document.querySelector(".access-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-access]");
    if (!button) return;
    state.accessMode = button.dataset.access;
    scheduleCatalogFilterUpdate();
  });

  document.getElementById("openInspector").addEventListener("click", () => {
    if (!selectedResource()) return;
    state.inspectorOpen = true;
    renderResourcePanel();
  });

  document.getElementById("resourceGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-resource-id]");
    if (button) setSelected(button.dataset.resourceId, true, "map");
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

  document.getElementById("globeClusterTray").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-cluster]")) {
      state.clusterIds = [];
      renderClusterTray();
      return;
    }
    const button = event.target.closest("[data-cluster-resource]");
    if (button) setSelected(button.dataset.clusterResource);
  });

  document.getElementById("showMoreResults").addEventListener("click", () => {
    state.visibleResults = Math.min(state.filtered.length, state.visibleResults + initialResultCount());
    renderResults();
  });

  document.getElementById("toggleSaved").addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    updateFilters();
  });
  document.getElementById("downloadDirectory").addEventListener("click", downloadDirectory);
  document.getElementById("clearBrowserData").addEventListener("click", () => {
    window.localStorage.removeItem(SAVED_RESOURCES_KEY);
    state.savedIds.clear();
    state.savedOnly = false;
    clearUserLocation();
    notify("Saved services and location sorting cleared");
  });

  document.getElementById("clearLocation").addEventListener("click", () => {
    clearUserLocation();
    notify("Location sorting cleared");
  });

  document.getElementById("locateMe").addEventListener("click", () => {
    const button = document.getElementById("locateMe");
    if (button.classList.contains("is-loading")) return;
    if (state.userLocation) {
      focusGlobeNearUser();
      notify("Globe recentered on your approximate location");
      return;
    }
    if (!navigator.geolocation) {
      notify("Location is not available in this browser");
      return;
    }
    button.classList.add("is-loading");
    button.innerHTML = `${icon.locate}<span>Finding your location…</span>`;
    navigator.geolocation.getCurrentPosition(async (position) => {
      state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.userLocationAccuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
      const feature = countryAtCoordinate(state.userLocation.lat, state.userLocation.lng);
      state.userCountry = feature ? resourceCountryForFeature(feature.properties.NAME) : isLikelyUnitedStatesPoint(state.userLocation) ? "United States" : null;
      updateFilters();
      focusGlobeNearUser();
      if (state.userCountry === "United States") {
        button.innerHTML = `${icon.locate}<span>Loading current services…</span>`;
        await loadLiveResourcesNearUser();
      }
      button.classList.remove("is-loading");
      renderLocationState();
      const nearest = state.filtered.find((resource) => {
        const distance = resourceDistanceKm(state.userLocation, resource);
        return distance !== null && distance <= 250;
      }) || state.filtered.find((resource) => !isExactServiceSite(resource) && resource.country === state.userCountry) || state.filtered[0];
      if (nearest) setSelected(nearest.id, false, false);
      focusGlobeNearUser();
      const nearby = nearbyExactCount();
      notify(nearby ? `Found ${nearby.toLocaleString()} service ${nearby === 1 ? "location" : "locations"} within 250 km` : "No service location is listed nearby yet. Showing regional resource finders next.");
    }, (error) => {
      button.classList.remove("is-loading");
      renderLocationState();
      notify(error.code === 1 ? "Location permission was not granted" : "A precise location was not available; try again or check browser settings");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });

  const canvas = document.getElementById("globeCanvas");
  const globeStage = canvas.closest(".globe-stage");
  const isGlobeChrome = (target) => target instanceof Element && Boolean(target.closest(".globe-meta, .globe-controls, .globe-readout, .globe-legend, .globe-cluster-tray"));

  const prepareGlobeInteraction = () => {
    state.clusterIds = [];
    renderClusterTray();
    state.targetLon = null;
    state.targetLat = null;
    state.velocityLon = 0;
    state.velocityLat = 0;
    state.focusPoint = null;
    state.focusedRegion = null;
    setCountryHighlight(null);
    document.getElementById("regionFocus").value = "focus";
    state.interactionUntil = performance.now() + 6000;
  };

  const beginPinch = () => {
    if (activeGlobePointers.size < 2) return;
    state.dragging = false;
    state.pinching = true;
    state.pointerMoved = true;
    globeGestureHadMultiplePointers = true;
    for (const pointerId of activeGlobePointers.keys()) {
      try { globeStage.setPointerCapture(pointerId); } catch {}
    }
    pinchStartDistance = pointerDistance(activeGlobePointers.values());
    pinchStartZoom = state.targetZoom;
    prepareGlobeInteraction();
  };

  globeStage.addEventListener("pointerdown", (event) => {
    const startedOnCanvas = event.target === canvas;
    const startedOnMap = event.pointerType === "touch" ? !isGlobeChrome(event.target) : startedOnCanvas;
    if (!startedOnMap) return;

    activeGlobePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startedOnCanvas,
      startedOnMap,
      pointerType: event.pointerType,
      handledRotation: false
    });
    if (event.pointerType !== "touch") {
      try { globeStage.setPointerCapture(event.pointerId); } catch {}
    }

    if (activeGlobePointers.size >= 2) {
      beginPinch();
      event.preventDefault();
      return;
    }

    if (!startedOnMap) return;
    state.dragging = event.pointerType !== "touch";
    state.pinching = false;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.pointerStartX = event.clientX;
    state.pointerStartY = event.clientY;
    state.pointerMoved = false;
    state.pointerTime = event.timeStamp || performance.now();
    globeGestureHadMultiplePointers = false;
    prepareGlobeInteraction();
  });

  globeStage.addEventListener("pointermove", (event) => {
    const pointer = activeGlobePointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (activeGlobePointers.size >= 2) {
      if (!state.pinching) beginPinch();
      state.targetZoom = pinchZoom(
        pinchStartZoom,
        pinchStartDistance,
        pointerDistance(activeGlobePointers.values()),
        MIN_GLOBE_ZOOM,
        maxGlobeZoom()
      );
      state.velocityLon = 0;
      state.velocityLat = 0;
      state.interactionUntil = performance.now() + 5000;
      event.preventDefault();
      return;
    }

    if (!state.dragging && pointer.pointerType === "touch") {
      const intent = classifyGlobeDragIntent(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY);
      if (intent === "scroll") {
        activeGlobePointers.delete(event.pointerId);
        return;
      }
      if (intent !== "rotate") return;
      state.dragging = true;
      try { globeStage.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
      state.pointerTime = event.timeStamp || performance.now();
    }
    if (!state.dragging) return;
    if (Math.hypot(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY) > 6) state.pointerMoved = true;
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    const interactionScale = 1 / Math.pow(Math.max(1, state.zoom), 0.72);
    const lonDelta = -dx * 0.30 * interactionScale;
    const latDelta = dy * 0.22 * interactionScale;
    state.rotationLon = normalizeLongitude(state.rotationLon + lonDelta);
    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + latDelta));
    const pointerNow = event.timeStamp || performance.now();
    const pointerDt = Math.max(8, Math.min(40, pointerNow - (state.pointerTime || pointerNow - 16))) / 1000;
    const sampledVelocityLon = lonDelta / pointerDt;
    const sampledVelocityLat = latDelta / pointerDt;
    state.velocityLon = state.velocityLon * 0.58 + sampledVelocityLon * 0.42;
    state.velocityLat = state.velocityLat * 0.58 + sampledVelocityLat * 0.42;
    state.pointerTime = pointerNow;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    pointer.handledRotation = true;
    if (event.pointerType === "touch") event.preventDefault();
  });

  const finishGlobePointer = (event, cancelled = false) => {
    const pointer = activeGlobePointers.get(event.pointerId);
    const shouldSelectCountry = !cancelled
      && activeGlobePointers.size === 1
      && state.dragging
      && !state.pointerMoved
      && pointer?.startedOnCanvas
      && !globeGestureHadMultiplePointers;

    activeGlobePointers.delete(event.pointerId);
    try { globeStage.releasePointerCapture(event.pointerId); } catch {}

    if (activeGlobePointers.size >= 2) {
      beginPinch();
      return;
    }

    state.pinching = false;
    if (activeGlobePointers.size === 1) {
      const remaining = activeGlobePointers.values().next().value;
      state.dragging = Boolean(remaining?.startedOnMap && remaining?.pointerType !== "touch");
      state.pointerX = remaining?.x || 0;
      state.pointerY = remaining?.y || 0;
      state.pointerStartX = state.pointerX;
      state.pointerStartY = state.pointerY;
      state.pointerMoved = true;
      return;
    }

    state.dragging = false;
    state.pointerMoved = false;
    globeGestureHadMultiplePointers = false;
    if (shouldSelectCountry) selectCountryFromPointer(event);
  };

  globeStage.addEventListener("pointerup", (event) => finishGlobePointer(event));
  globeStage.addEventListener("pointercancel", (event) => finishGlobePointer(event, true));

  const preventNativePagePinch = (event) => {
    if (!isGlobeChrome(event.target)) event.preventDefault();
  };
  globeStage.addEventListener("gesturestart", preventNativePagePinch, { passive: false });
  globeStage.addEventListener("gesturechange", preventNativePagePinch, { passive: false });
  globeStage.addEventListener("gestureend", preventNativePagePinch, { passive: false });
  let touchFallbackState = null;
  const touchListDistance = (touches) => {
    if (touches.length < 2) return 0;
    return Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  };
  const resetTouchFallback = () => { touchFallbackState = null; };
  globeStage.addEventListener("touchstart", (event) => {
    if (isGlobeChrome(event.target)) return;
    if (event.touches.length > 1) {
      touchFallbackState = {
        intent: "pinch",
        pinchStartDistance: touchListDistance(event.touches),
        pinchStartZoom: state.targetZoom
      };
      state.pinching = true;
      state.dragging = false;
      state.pointerMoved = true;
      globeGestureHadMultiplePointers = true;
      prepareGlobeInteraction();
      event.preventDefault();
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    touchFallbackState = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      lastTime: event.timeStamp || performance.now(),
      intent: "pending"
    };
  }, { passive: false });
  globeStage.addEventListener("touchmove", (event) => {
    if (isGlobeChrome(event.target)) return;
    if (event.touches.length > 1) {
      if (!touchFallbackState || touchFallbackState.intent !== "pinch") {
        touchFallbackState = {
          intent: "pinch",
          pinchStartDistance: touchListDistance(event.touches),
          pinchStartZoom: state.targetZoom
        };
        state.pinching = true;
        state.dragging = false;
        state.pointerMoved = true;
        globeGestureHadMultiplePointers = true;
        prepareGlobeInteraction();
      }
      state.targetZoom = pinchZoom(
        touchFallbackState.pinchStartZoom,
        touchFallbackState.pinchStartDistance,
        touchListDistance(event.touches),
        MIN_GLOBE_ZOOM,
        maxGlobeZoom()
      );
      state.velocityLon = 0;
      state.velocityLat = 0;
      state.interactionUntil = performance.now() + 5000;
      event.preventDefault();
      return;
    }
    const touch = event.touches[0];
    const fallback = touchFallbackState;
    if (!touch || !fallback || fallback.intent === "pinch") return;
    if (fallback.intent === "pending") {
      fallback.intent = classifyGlobeDragIntent(touch.clientX - fallback.startX, touch.clientY - fallback.startY);
      if (fallback.intent === "scroll") return;
      if (fallback.intent !== "rotate") return;
      if (!state.dragging) {
        state.dragging = true;
        state.pinching = false;
        state.pointerMoved = true;
        prepareGlobeInteraction();
      }
      fallback.lastX = touch.clientX;
      fallback.lastY = touch.clientY;
      fallback.lastTime = event.timeStamp || performance.now();
      event.preventDefault();
      return;
    }
    if (fallback.intent !== "rotate") return;
    const pointerPath = activeGlobePointers.size === 1 ? activeGlobePointers.values().next().value : null;
    if (pointerPath?.handledRotation) {
      event.preventDefault();
      return;
    }
    const dx = touch.clientX - fallback.lastX;
    const dy = touch.clientY - fallback.lastY;
    const interactionScale = 1 / Math.pow(Math.max(1, state.zoom), 0.72);
    const lonDelta = -dx * 0.30 * interactionScale;
    const latDelta = dy * 0.22 * interactionScale;
    state.rotationLon = normalizeLongitude(state.rotationLon + lonDelta);
    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + latDelta));
    state.targetLon = null;
    state.targetLat = null;
    state.pointerMoved = true;
    state.interactionUntil = performance.now() + 5000;
    fallback.lastX = touch.clientX;
    fallback.lastY = touch.clientY;
    fallback.lastTime = event.timeStamp || performance.now();
    event.preventDefault();
  }, { passive: false });
  globeStage.addEventListener("touchend", (event) => {
    if (event.touches.length === 0) {
      state.dragging = false;
      state.pinching = false;
      state.velocityLon = 0;
      state.velocityLat = 0;
      pinchStartDistance = 0;
      resetTouchFallback();
    }
  }, { passive: true });
  globeStage.addEventListener("touchcancel", () => {
    state.dragging = false;
    state.pinching = false;
    state.velocityLon = 0;
    state.velocityLat = 0;
    pinchStartDistance = 0;
    resetTouchFallback();
  }, { passive: true });

  canvas.addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    state.targetZoom = Math.max(MIN_GLOBE_ZOOM, Math.min(maxGlobeZoom(), state.targetZoom * Math.exp(-event.deltaY * 0.00165)));
    state.interactionUntil = performance.now() + 5000;
  }, { passive: false });
  canvas.addEventListener("dblclick", () => {
    state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom * 1.28);
    state.interactionUntil = performance.now() + 5000;
  });
  canvas.addEventListener("keydown", (event) => {
    const baseStep = event.shiftKey ? 12 : 5;
    const step = baseStep / Math.pow(Math.max(1, state.zoom), 0.7);
    if (event.key === "ArrowLeft") state.rotationLon = normalizeLongitude(state.rotationLon - step);
    else if (event.key === "ArrowRight") state.rotationLon = normalizeLongitude(state.rotationLon + step);
    else if (event.key === "ArrowUp") state.rotationLat = Math.max(-58, state.rotationLat + step);
    else if (event.key === "ArrowDown") state.rotationLat = Math.min(58, state.rotationLat - step);
    else if (event.key === "+" || event.key === "=") state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom * 1.2);
    else if (event.key === "-" || event.key === "_") state.targetZoom = Math.max(MIN_GLOBE_ZOOM, state.targetZoom / 1.2);
    else if (event.key === "Home") {
      focusRegion("world");
      event.preventDefault();
      return;
    }
    else if (event.key === " ") {
      state.autoRotate = !state.autoRotate;
      const motionButton = document.getElementById("toggleMotion");
      motionButton.innerHTML = state.autoRotate ? icon.pause : icon.play;
      motionButton.title = state.autoRotate ? "Pause globe rotation" : "Resume globe rotation";
      motionButton.setAttribute("aria-label", motionButton.title);
      event.preventDefault();
      return;
    }
    else return;
    state.targetLon = null;
    state.targetLat = null;
    state.focusPoint = null;
    state.focusedRegion = null;
    setCountryHighlight(null);
    document.getElementById("regionFocus").value = "focus";
    state.interactionUntil = performance.now() + 5000;
    event.preventDefault();
  });

  document.getElementById("zoomIn").addEventListener("click", () => { const step = state.targetZoom < 4 ? 1.22 : 1.14; state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom * step); state.interactionUntil = performance.now() + 5000; });
  document.getElementById("zoomOut").addEventListener("click", () => { const step = state.targetZoom <= 4 ? 1.22 : 1.14; state.targetZoom = Math.max(MIN_GLOBE_ZOOM, state.targetZoom / step); state.interactionUntil = performance.now() + 5000; });
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

  const siteMenu = document.querySelector(".site-menu");
  siteMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => siteMenu.removeAttribute("open")));
  document.addEventListener("click", (event) => {
    if (siteMenu.open && !siteMenu.contains(event.target)) siteMenu.removeAttribute("open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") siteMenu.removeAttribute("open");
  });

  const sectionLinks = [...document.querySelectorAll("[data-section-link]")];
  const sections = ["finder", "about", "standards"].map((id) => document.getElementById(id));
  let navigationFrame = null;
  const updateCurrentSection = () => {
    navigationFrame = null;
    const marker = window.scrollY + window.innerHeight * 0.34;
    const current = sections.reduce((active, section) => section.offsetTop <= marker ? section : active, sections[0]);
    sectionLinks.forEach((link) => {
      if (link.dataset.sectionLink === current.id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };
  window.addEventListener("scroll", () => {
    globePageScrollUntil = performance.now() + 140;
    if (!navigationFrame) navigationFrame = window.requestAnimationFrame(updateCurrentSection);
  }, { passive: true });
  updateCurrentSection();

  if ("IntersectionObserver" in window) {
    const globeObserver = new IntersectionObserver(([entry]) => {
      state.globeVisible = entry.isIntersecting;
    }, { rootMargin: "160px" });
    globeObserver.observe(document.querySelector(".globe-stage"));
  }

}

shell();
renderStatic();
updateFilters();
bindEvents();
initThreeGlobe();
loadEarthImagery();
loadLandGeometry();
if (requestedResource && requestedResource === initialResource) {
  const resource = resources.find((item) => item.id === requestedResource);
  if (resource) focusGlobeOn(resource);
}
requestAnimationFrame(animateGlobe);
