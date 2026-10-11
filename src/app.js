import { warmSearchIndex } from "./utils/search-warmup.js";
import { phoneMarkup } from "./utils/phone.js";
import * as THREE from "/vendor/three.module.js";
import { createGlobePointLayer, replaceGlobePointResources, updateGlobePointLayer } from "./globe-points.js";
import { globeHasMotion, globePointVisible, frameBufferMatches } from "./utils/globe-rendering.js";
import { clusterProjectedEntries } from "./utils/globe-clustering.js";
import { categories, resourceTypes, resources, trustPrinciples } from "./data/resources.js";
import { freeAccessLabel, freeAccessModels } from "./data/free-access.js";
import { sourceClosureMarkup, availabilityInstructions } from "./utils/source-status.js";
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
  pointPickThresholdWorld
} from "./utils/gesture.js";
import { classifyWheelIntent, wheelZoomFactor } from "./utils/globe-zoom.js";
import {
  clearResourceFromUrl,
  privateResourceUrl,
  resourceIdFromUrl,
  SAVED_RESOURCES_KEY,
  readSavedResources,
  setResourceSaved,
  clearSavedResources
} from "./utils/privacy.js";

const DEFAULT_RESOURCE = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN_GLOBE_ZOOM = 0.82;
// Returned when the globe has no camera yet, so callers treat the point as
// behind the sphere and simply skip drawing instead of guessing a position.
const OFFSCREEN_POINT = Object.freeze({ x: -1e6, y: -1e6, z: -1 });

// The map only claims the wheel after the visitor has actually used it, so a
// first-time reader scrolling down the page is never interrupted.
let globeEngaged = false;
function markGlobeEngaged() {
  globeEngaged = true;
  globeStageElement?.classList.add("is-engaged");
  wakeGlobe();
}

// Zooming toward the pointer keeps the place under the cursor pinned, which is
// what makes deep zoom feel like a map rather than a slideshow of scales.
function zoomTowardPointer(factor, clientX, clientY) {
  wakeGlobe();
  const maximum = maxGlobeZoom();
  const previousTargetZoom = state.targetZoom;
  const nextZoom = Math.max(MIN_GLOBE_ZOOM, Math.min(maximum, previousTargetZoom * factor));
  const anchor = clientX === undefined ? null : globeCoordinateAtClientPoint(clientX, clientY);
  state.targetZoom = nextZoom;
  if (!anchor) return;
  // Nudge the rotation so the anchored coordinate drifts toward the centre in
  // proportion to how much closer the camera moved.
  const pull = Math.max(0, Math.min(0.62, (nextZoom / Math.max(0.0001, previousTargetZoom) - 1) * 1.35));
  if (pull <= 0.001) return;
  const lonGap = normalizeLongitude(anchor.lng - state.rotationLon);
  const latGap = anchor.lat - state.rotationLat;
  state.rotationLon = normalizeLongitude(state.rotationLon + lonGap * pull);
  state.rotationLat = clampGlobeLatitude(state.rotationLat + latGap * pull);
  state.targetLon = null;
  state.targetLat = null;
  state.velocityLon = 0;
  state.velocityLat = 0;
}

function maxGlobeZoom() {
  return window.innerWidth <= 600 ? 8.0 : 12.0;
}

// Latitude is clamped short of the poles so the horizon never flips over, but
// far enough to reach Arctic and Antarctic services.
const MAX_GLOBE_LATITUDE = 82;
function clampGlobeLatitude(value) {
  return Math.max(-MAX_GLOBE_LATITUDE, Math.min(MAX_GLOBE_LATITUDE, value));
}

// Resolves a viewport point to the coordinate under it. Returns null when the
// ray misses the globe, so callers can fall back to plain centred zoom.
function globeCoordinateAtClientPoint(clientX, clientY) {
  if (!globeRenderer || !globeCamera || !globeWorld || !globeSurface) return null;
  const rect = globeRenderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  globePointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  globeWorld.updateMatrixWorld(true);
  globeCamera.updateMatrixWorld(true);
  globeRaycaster.setFromCamera(globePointerNdc, globeCamera);
  const hit = globeRaycaster.intersectObject(globeSurface, false)[0];
  if (!hit) return null;
  globeInverseWorldMatrix.copy(globeWorld.matrixWorld).invert();
  globeProjectionVector.copy(hit.point).applyMatrix4(globeInverseWorldMatrix).normalize();
  return {
    lat: Math.asin(THREE.MathUtils.clamp(globeProjectionVector.y, -1, 1)) * 180 / Math.PI,
    lng: Math.atan2(globeProjectionVector.x, globeProjectionVector.z) * 180 / Math.PI
  };
}

function initialResultCount() {
  if (window.innerWidth <= 600) return 5;
  if (window.innerWidth <= 900) return 6;
  return 8;
}

function loadSavedResources() {
  try {
    return new Set([...readSavedResources()].filter((id) => resources.some((resource) => resource.id === id)));
  } catch {
    return new Set();
  }
}

const requestedResource = resourceIdFromUrl(window.location.href);
const initialResource = resources.some((resource) => resource.id === requestedResource) ? requestedResource : null;
const FINDER_HISTORY_KEY = "rwnFinder";
const FINDER_QUERY_LIMIT = 180;
const initialFinderHistory = window.history.state?.[FINDER_HISTORY_KEY] || null;

function sanitizeFinderQuery(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, FINDER_QUERY_LIMIT);
}

function finderTypesFromHistory(value) {
  if (!Array.isArray(value)) return createInitialTypeSet();
  const types = value.filter((type) => resourceTypes.includes(type));
  return new Set(types);
}

function finderAccessFromHistory(value) {
  return ["all", "direct", "discovery"].includes(value) ? value : "all";
}

if (requestedResource && new URL(window.location.href).searchParams.has("resource")) {
  window.history.replaceState({}, "", privateResourceUrl(window.location.href, requestedResource));
}

let cancelPendingSearch = () => {};

const state = {
  query: sanitizeFinderQuery(initialFinderHistory?.query),
  viewMode: "aid",
  accessMode: finderAccessFromHistory(initialFinderHistory?.accessMode),
  activeTypes: finderTypesFromHistory(initialFinderHistory?.activeTypes),
  selectedId: initialResource || (resources.some((resource) => resource.id === initialFinderHistory?.selectedId) ? initialFinderHistory.selectedId : null),
  filtered: resources,
  liveResources: [],
  liveSourceStatus: "idle",
  liveSourceError: "",
  liveNearbyAvailable: 0,
  liveNationalCount: null,
  userLocation: null,
  userLocationAccuracy: null,
  userCountry: null,
  locationRecovery: "",
  locationRetryAvailable: false,
  rotationLon: -8,
  rotationLat: 12,
  targetLon: null,
  targetLat: null,
  zoom: 1,
  targetZoom: 1,
  dragging: false,
  touching: false,
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
  savedOnly: Boolean(initialFinderHistory?.savedOnly),
  inspectorOpen: Boolean(initialResource || initialFinderHistory?.selectedId),
  clusterIds: []
};

const activeGlobePointers = new Map();

const root = document.getElementById("root");
let pinSignature = "";
let pinElements = new Map();
let lastFrame = performance.now();
let globeRenderer = null;
let globeScene = null;
let globeCamera = null;
let globeWorld = null;
let globeSurface = null;
const globeLandMask = { value: null };
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
let pendingDetailGeometry = null;
let pendingDetailImage = null;
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
let lastPinClusters = [];
let globeLastReadoutUpdate = 0;
let globeCloseViewActive = false;
let globeServicePoints = null;
let globePointSignature = "";
let globeContextLost = false;
let globeContextRecoveryExtension = null;
let globeFrameHandle = null;
let globeResizeObserver = null;
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
              <h1>Find essential services near you.</h1>
              <p>Search for food, shelter, health care, showers, clothing, drinking water, and other essentials. Every listing links to the organization offering the service.</p>
            </div>

            <div class="finder-search" role="search">
              <label class="search-box">
                ${icon.search}
                <span class="sr-only">Search resources</span>
                <input id="resourceSearch" type="search" maxlength="180" placeholder="Search by service or place" autocomplete="off">
                <button id="clearSearch" type="button" aria-label="Clear search" title="Clear search" hidden>${icon.close}</button>
              </label>
              <p class="sr-only" id="searchStatus" aria-live="polite"></p>
            </div>
            <a class="jump-results" id="jumpResults" href="#results" aria-label="Skip the map and see matching services"><span>See matching services</span><small id="matchingResultCount">${resources.length.toLocaleString()} listed</small></a>

            <div class="location-actions">
              <button class="location-button" id="locateMe" type="button">${icon.locate}<span>Use my location</span></button>
              <button class="location-clear" id="clearLocation" type="button" hidden>Clear</button>
            </div>
            <p class="location-status" id="locationStatus" aria-live="polite">Nearby service locations appear first. Regional resource finders appear after them.</p>
            <p class="location-recovery" id="locationRecovery" role="status" aria-live="polite" hidden></p>
            <p class="live-source-status" id="liveSourceStatus">In the United States, location search also includes current USDA summer meal sites.</p>
            <p class="location-privacy">Your browser uses location to sort nearby listings. For U.S. meal searches, the USDA receives only an approximate area. You can search by place instead. <a href="/privacy#location">How location works</a></p>
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
                    <option value="focus" hidden>This area</option>
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
            <div class="globe-fallback" id="globeFallback" hidden>
              <p id="globeFallbackMessage"><strong>The interactive map needs WebGL,</strong> which this browser or device has turned off.</p>
              <p>Every listing is still available as text, with the same contact details, sources and review dates.</p>
              <div class="globe-fallback__actions"><a class="globe-fallback__action" href="/directory">Open the text directory</a><button class="globe-fallback__retry" id="retryGlobe" type="button" hidden>Try the interactive map again</button></div>
            </div>
            <div class="globe-controls" aria-label="Globe controls">
              <button class="globe-compass" id="northGlobe" type="button" title="Orient north" aria-label="Orient globe north"><span>N</span><i></i></button>
              <button type="button" id="zoomIn" title="Zoom in" aria-label="Zoom in">${icon.plus}</button>
              <button type="button" id="zoomOut" title="Zoom out" aria-label="Zoom out">${icon.minus}</button>
              <button type="button" id="resetGlobe" title="Reset globe view" aria-label="Reset globe view">${icon.reset}</button>
              <button type="button" id="toggleMotion" title="Resume globe rotation" aria-label="Resume globe rotation">${icon.play}</button>
            </div>
            <div class="globe-readout" id="globeReadout" aria-live="polite"></div>
            <div class="globe-legend" id="globeLegend" aria-label="Visible aid layers"></div>
            <p class="globe-gesture-hint" aria-hidden="true">Drag to rotate · Double-click, pinch or + / − to zoom</p>
          </section>

          <aside class="resource-panel" id="resourcePanel" aria-live="polite"></aside>
        </div>

        <div class="directory-strip">
          <p id="catalogReach"><strong>${resources.length}</strong> listings checked against original sources <span>${directCount()} service locations</span> <span>17,442 active USDA summer meal sites in the latest data review</span> <a href="/directory">Use the text directory</a></p>
          <p role="note">${icon.info}<span>If someone is in immediate danger, contact local emergency services. RWN does not provide emergency response.</span></p>
        </div>

        <div class="results-section" id="results">
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

function finderHistorySnapshot() {
  return {
    query: state.query,
    accessMode: state.accessMode,
    activeTypes: [...state.activeTypes],
    savedOnly: state.savedOnly,
    selectedId: state.selectedId || null,
    inspectorOpen: Boolean(state.inspectorOpen && state.selectedId)
  };
}

function writeFinderHistory(mode = "replace") {
  const snapshot = finderHistorySnapshot();
  const signature = JSON.stringify(snapshot);
  if (mode === "push" && signature === writeFinderHistory.lastSignature) return;
  const url = state.selectedId
    ? privateResourceUrl(window.location.href, state.selectedId)
    : clearResourceFromUrl(window.location.href);
  window.history[mode === "push" ? "pushState" : "replaceState"]({ ...(window.history.state || {}), [FINDER_HISTORY_KEY]: snapshot }, "", url);
  writeFinderHistory.lastSignature = signature;
}

function restoreFinderHistory(historyState) {
  const snapshot = historyState?.[FINDER_HISTORY_KEY];
  // Native in-page links create history entries without our finder snapshot.
  // Keep the current search and attach it to the new entry so Back/Forward
  // can restore it, while leaving the section fragment and scroll untouched.
  if (!snapshot) {
    window.history.replaceState({ ...(historyState || {}), [FINDER_HISTORY_KEY]: finderHistorySnapshot() }, "", window.location.href);
    return;
  }
  state.query = sanitizeFinderQuery(snapshot?.query);
  state.accessMode = finderAccessFromHistory(snapshot?.accessMode);
  state.activeTypes = finderTypesFromHistory(snapshot?.activeTypes);
  state.savedOnly = Boolean(snapshot?.savedOnly);
  state.selectedId = resources.some((resource) => resource.id === snapshot?.selectedId) ? snapshot.selectedId : null;
  state.inspectorOpen = Boolean(snapshot?.inspectorOpen && state.selectedId);
  const input = document.getElementById("resourceSearch");
  if (input) input.value = state.query;
  updateFilters();
  writeFinderHistory.lastSignature = JSON.stringify(finderHistorySnapshot());
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
  wakeGlobe();
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
  document.dispatchEvent(new CustomEvent("rwn:filters-updated"));
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
  const recovery = document.getElementById("locationRecovery");
  if (!button || !clear || !status) return;
  const active = Boolean(state.userLocation);
  button.classList.toggle("has-location", active);
  button.innerHTML = active ? `${icon.locate}<span>Recenter near me</span>` : `${icon.locate}<span>Use my location</span>`;
  button.setAttribute("aria-label", active ? "Recenter the globe near my location" : "Use my location to show nearby service locations first");
  clear.hidden = !active;
  if (!active) {
    status.textContent = "Nearby service locations appear first. Regional resource finders appear after them.";
    if (recovery) {
      recovery.hidden = !state.locationRecovery;
      recovery.replaceChildren();
      if (state.locationRecovery) {
        recovery.append(document.createTextNode(state.locationRecovery));
        if (state.locationRetryAvailable) {
          const retry = document.createElement("button");
          retry.id = "retryLocation";
          retry.type = "button";
          retry.textContent = "Try again";
          recovery.append(" ", retry);
        }
      }
    }
    return;
  }
  state.locationRecovery = "";
  state.locationRetryAvailable = false;
  if (recovery) {
    recovery.hidden = true;
    recovery.textContent = "";
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
  const search = document.getElementById("resourceSearch");
  search.disabled = !aidMode;
  if (document.activeElement !== search && search.value !== state.query) search.value = state.query;
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
    ${sourceClosureMarkup(resource)}
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
          ${resource.phone ? `<div><dt>Phone</dt><dd>${phoneMarkup(resource.phone)}</dd></div>` : ""}
          ${resource.eligibility ? `<div><dt>Eligibility</dt><dd>${resource.eligibility}</dd></div>` : ""}
          ${resource.validFrom && resource.validThrough ? `<div><dt>Active dates</dt><dd>${checkedDate(resource.validFrom)}–${checkedDate(resource.validThrough)}</dd></div>` : ""}
          ${state.userLocation && exact ? `<div><dt>Distance</dt><dd>${distanceLabel(resource)}</dd></div>` : ""}
          ${!exact && resource.coverageNote ? `<div><dt>Map note</dt><dd>${resource.coverageNote}</dd></div>` : ""}
        </dl>
        <div class="panel-services"><h3>Services offered</h3><ul>${resource.services.map((service) => `<li>${icon.check}<span>${service}</span></li>`).join("")}</ul></div>
      </div>
    </details>
    <div class="availability-note"><span>${icon.info}</span><p><strong>Confirm before you go</strong>${availabilityInstructions(resource)}</p></div>
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
  const aidLabels = allTypes(resource).map((type) => categories[type].label).join(" · ");
  const openAccess = resource.openAccess === true ? `<em class="resource-row__open-access">Open access</em>` : "";
  return `
    <article class="resource-card resource-row ${selected ? "is-selected" : ""}" style="--accent:${category.color}">
      <button type="button" data-resource-id="${resource.id}">
        <span class="resource-row__service"><i></i><span><strong>${resource.name}</strong><small>${resource.sourceName} · ${isExactServiceSite(resource) ? "Service location" : "Resource finder"} · <b>${freeAccessLabel(resource, true)}</b>${openAccess}</small></span></span>
        <span class="resource-row__place">${formatResourcePlace(resource)}</span>
        <span class="resource-row__aid">${aidLabels}</span>
        <span class="resource-row__access">${locationResultLabel(resource)}</span>
        <time class="resource-row__reviewed" datetime="${resource.lastChecked}">${reviewLabel(resource)}</time>
        <span class="resource-row__arrow">${icon.arrow}</span>
      </button>
      ${sourceClosureMarkup(resource)}
    </article>
  `;
}

function renderResults() {
  const count = document.getElementById("resultCount");
  const grid = document.getElementById("resourceGrid");
  const showMore = document.getElementById("showMoreResults");
  const matchingResultCount = document.getElementById("matchingResultCount");
  const visibleResources = state.filtered.slice(0, state.visibleResults);
  document.getElementById("resultTitle").textContent = state.viewMode === "needs" ? "Public requests" : state.savedOnly ? "Saved services" : state.userLocation ? "Help near you" : "Find a service";
  count.textContent = state.viewMode === "aid"
    ? `${state.userLocation ? `${nearbyExactCount()} service locations within 250 km · ` : ""}Showing ${visibleResources.length} of ${state.filtered.length} listings`
    : "No public requests are listed";
  grid.innerHTML = state.filtered.length
    ? visibleResources.map(resourceCard).join("")
    : `<div class="results-empty"><strong>${state.viewMode === "needs" ? "No public requests are listed." : "No services match these filters."}</strong><p>${state.viewMode === "needs" ? "RWN does not accept or publish personal requests through this website." : "Try another place, service, or listing type. RWN may not have every service."}</p>${state.viewMode === "aid" ? '<button class="results-empty__reset" id="clearFinderFilters" type="button">Clear search and filters</button>' : ""}</div>`;
  if (matchingResultCount) matchingResultCount.textContent = `${state.filtered.length.toLocaleString()} ${state.filtered.length === 1 ? "match" : "matches"}`;
  showMore.hidden = state.visibleResults >= state.filtered.length;
}

function setSelected(id, focus = true, reveal = "panel", historyMode = "push") {
  state.selectedId = id;
  state.inspectorOpen = true;
  state.clusterIds = [];
  const resource = selectedResource();
  if (focus && resource) focusGlobeOn(resource, reveal === "map");
  renderResourcePanel();
  renderResults();
  renderClusterTray();
  pinSignature = "";
  writeFinderHistory(historyMode);
  if (reveal) {
    const target = reveal === "map" ? document.querySelector(".globe-stage") : document.getElementById("resourcePanel");
    const bounds = target?.getBoundingClientRect();
    const headerOffset = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
    if (target && bounds && (bounds.top < headerOffset || bounds.bottom > window.innerHeight)) {
      if (reveal === "map") {
        state.globeVisible = true;
        wakeGlobe();
      }
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    }
  }
}

function toggleSavedResource(id) {
  try {
    const saved = readSavedResources().has(id);
    setResourceSaved(id, !saved);
    state.savedIds = loadSavedResources();
  } catch {
    notify("Your saved list could not be changed. Check this browser’s storage settings and try again.");
    return;
  }
  if (state.savedOnly) updateFilters();
  else {
    renderControls();
    renderResourcePanel();
    renderResults();
  }
  notify(state.savedIds.has(id) ? "Service saved only in this browser" : "Service removed from saved");
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
  wakeGlobe();
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
  state.locationRecovery = "";
  state.locationRetryAvailable = false;
  document.getElementById("locateMe")?.classList.remove("has-location", "is-loading");
  updateFilters();
}

function clearFinderFilters({ focus = true, historyMode = "push" } = {}) {
  cancelPendingSearch();
  clearUserLocation();
  state.query = "";
  state.accessMode = "all";
  state.activeTypes = createInitialTypeSet();
  state.savedOnly = false;
  state.selectedId = null;
  state.inspectorOpen = false;
  const input = document.getElementById("resourceSearch");
  if (input) input.value = "";
  updateFilters();
  writeFinderHistory(historyMode);
  if (focus) input?.focus();
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
  if (!globeWorld || !globeCamera) return OFFSCREEN_POINT;
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
  if (hasEarthImagery && activeEarthImage.naturalWidth === canvas.width) {
    const texture = new THREE.Texture(activeEarthImage);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.offset.x = THREE_SPHERE_TEXTURE_OFFSET;
    texture.anisotropy = Math.min(8, globeRenderer?.capabilities.getMaxAnisotropy() || 1);
    texture.needsUpdate = true;
    return texture;
  }
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
      globeSurface.material.emissiveIntensity = 0.42;
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
  if (status && state.detailGeometryReady) status.textContent = "detailed · loading HD surface…";
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    pendingDetailImage = image;
    wakeGlobe();
  };
  image.onerror = () => {
    if (status && state.detailGeometryReady) status.textContent = "detailed boundaries";
  };
  // A 4K file avoids decoding a 128 MiB 8K bitmap only to downsample it on
  // mobile. Desktop retains the original 8K close-view surface.
  image.src = window.innerWidth <= 600 || window.matchMedia("(pointer: coarse)").matches
    || (globeRenderer?.capabilities.maxTextureSize || 0) < 8192
    ? "/media/earth-blue-marble-mobile.jpg"
    : "/media/earth-blue-marble-detail.jpg";
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

function updateGlobeLandMask() {
  const features = state.detailGeometryReady ? state.detailCountryFeatures : state.countryFeatures;
  const canvas = document.createElement("canvas");
  const width = state.detailGeometryReady && window.innerWidth > 600 ? 4096 : 2048;
  canvas.width = width; canvas.height = width / 2;
  const ctx = canvas.getContext("2d");
  // Before boundaries arrive, preserve the original imagery rather than guess.
  ctx.fillStyle = features.length ? "#000" : "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  for (const feature of features) {
    const polygons = feature.geometry?.type === "Polygon" ? [feature.geometry.coordinates]
      : feature.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates : [];
    for (const polygon of polygons) {
      for (const shift of [-width, 0, width]) {
        ctx.beginPath();
        for (const ring of polygon) {
          let previousX = null;
          ring.forEach(([lng, lat], index) => {
            let x = (lng + 180) / 360 * width;
            if (previousX !== null) {
              while (x - previousX > width / 2) x -= width;
              while (x - previousX < -width / 2) x += width;
            }
            previousX = x;
            const y = (90 - lat) / 180 * canvas.height;
            if (index === 0) ctx.moveTo(x + shift, y); else ctx.lineTo(x + shift, y);
          });
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
    }
  }
  const previous = globeLandMask.value;
  globeLandMask.value = new THREE.CanvasTexture(canvas);
  globeLandMask.value.wrapS = THREE.RepeatWrapping;
  previous?.dispose();
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
  wakeGlobe();
}

function initThreeGlobe() {
  const canvas = document.getElementById("globeCanvas");
  globeCanvasElement = canvas;
  globeStageElement = canvas?.closest(".globe-stage") || null;
  globePinLayerElement = document.getElementById("pinLayer");
  globeReadoutElement = document.getElementById("globeReadout");
  if (canvas && !canvas.dataset.rwnContextRecovery) {
    canvas.dataset.rwnContextRecovery = "true";
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      globeContextLost = true;
      state.autoRotate = false;
      pauseGlobe();
      reportGlobeUnavailable("The interactive map paused because this device lost its graphics context. You can keep using text results or try the map again.", true);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      recoverGlobeContext();
    });
  }
  const updateGlobeViewport = () => {
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    globeViewportWidth = Math.max(1, rect.width);
    globeViewportHeight = Math.max(1, rect.height);
  };
  updateGlobeViewport();
  if ("ResizeObserver" in window && canvas && !globeResizeObserver) {
    globeResizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      globeViewportWidth = Math.max(1, box.width);
      globeViewportHeight = Math.max(1, box.height);
      state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom);
      wakeGlobe();
    });
    globeResizeObserver.observe(canvas);
  }
  try {
    globeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    console.error("WebGL globe could not be initialized.", error);
    globeRenderer = null;
    reportGlobeUnavailable();
    return false;
  }
  globeContextRecoveryExtension = globeRenderer.getContext().getExtension("WEBGL_lose_context");
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
      emissiveIntensity: 0.42,
      metalness: 0,
      roughness: 0.94
    })
  );
  // Coastline geometry identifies water; image darkness is not a land mask.
  globeSurface.material.onBeforeCompile = (shader) => {
    shader.uniforms.uLandMask = globeLandMask;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uLandMask;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float land = texture2D(uLandMask, vMapUv).r;
      float ocean = 1.0 - smoothstep(0.1, 0.9, land);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.105, 0.17), ocean * 0.9);
    `);
  };
  updateGlobeLandMask();
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
  return true;
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

// The interactive globe requires WebGL. When it is unavailable the map is
// replaced with a direct route into the text directory rather than a
// lower-fidelity drawing, so every visitor still reaches the listings.
let globeUnavailableReported = false;
function reportGlobeUnavailable(message = "Interactive map unavailable on this device", retry = false) {
  if (globeUnavailableReported && !retry) return;
  globeUnavailableReported = true;
  const stage = globeStageElement || document.querySelector(".globe-stage");
  if (stage) stage.classList.add("is-globe-unavailable");
  const status = document.getElementById("globeReadout");
  if (status) status.textContent = message;
  const fallback = document.getElementById("globeFallback");
  if (fallback) fallback.hidden = false;
  const fallbackMessage = document.getElementById("globeFallbackMessage");
  if (fallbackMessage) fallbackMessage.textContent = message;
  const retryButton = document.getElementById("retryGlobe");
  if (retryButton) retryButton.hidden = !retry;
}

function resetGlobeContextResources() {
  pauseGlobe();
  // Renderer disposal alone does not release the geometries and textures that
  // the old scene owned. Deduplicate shared map/emissive textures.
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  globeScene?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [object.material].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  if (globeLandMask.value) textures.add(globeLandMask.value);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  globeLandMask.value = null;
  globeRenderer?.dispose();
  globeRenderer = null;
  globeScene = null;
  globeCamera = null;
  globeWorld = null;
  globeSurface = null;
  globeBorders = null;
  globeCountryHighlight = null;
  globeGraticule = null;
  globeAtmosphere = null;
  globeLight = null;
  globeFocusLight = null;
  connectionGroup = null;
  connectionParticles = [];
  connectionSignature = "";
  globeServicePoints = null;
  globePointSignature = "";
  pinSignature = "";
  lastPinClusters = [];
}

function recoverGlobeContext() {
  if (!globeCanvasElement) return;
  resetGlobeContextResources();
  globeContextLost = false;
  globeUnavailableReported = false;
  globeStageElement?.classList.remove("is-globe-unavailable");
  const fallback = document.getElementById("globeFallback");
  if (fallback) fallback.hidden = true;
  const retryButton = document.getElementById("retryGlobe");
  if (retryButton) retryButton.hidden = true;
  try {
    if (!initThreeGlobe() || globeRenderer.getContext().isContextLost()) {
      globeContextLost = true;
      reportGlobeUnavailable("The interactive map is still unavailable. You can keep using the text directory.", true);
      return;
    }
    rebuildCountryBorders();
    syncGlobePointLayer();
    wakeGlobe();
    notify("Interactive map restored");
  } catch {
    globeContextLost = true;
    reportGlobeUnavailable("The interactive map is still unavailable. You can keep using the text directory.", true);
  }
}

function renderThreeGlobe(width, height, now) {
  if (!globeRenderer) return false;
  const canvas = globeRenderer.domElement;
  const dprCap = width < 720 ? (state.zoom > 2.5 ? 1.6 : 1.4) : (state.zoom > 2.5 ? 2 : 1.75);
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  updateGlobePointLayer(globeServicePoints, { zoom: state.zoom, pixelRatio: dpr, opacity: 0.96 });
  if (!frameBufferMatches(canvas, width, height, dpr)) {
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

  // An atlas must remain readable everywhere, independent of the time of day.
  globeLight.position.set(-3, 3, 5);
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
  if (!globeWorld || !globeCamera) return OFFSCREEN_POINT;
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

function connectionDestinations(selected) {
  return state.filtered
    .filter((resource) => resource.id !== selected.id && resource.category === selected.category)
    .sort((a, b) => distanceKm(selected.lat, selected.lng, a.lat, a.lng) - distanceKm(selected.lat, selected.lng, b.lat, b.lng))
    .slice(0, 3);
}

function clusterVisibleResources(width, height) {
  const selected = selectedResource();
  const minimumThreshold = state.zoom > 8 ? 6 : state.zoom > 5 ? 8 : 12;
  const threshold = Math.max(minimumThreshold, (width < 600 ? 48 : 38) - Math.max(0, state.zoom - 0.86) * (state.zoom > 5 ? 5 : 7));
  const entries = [];
  let selectedEntry = null;

  for (const resource of state.filtered) {
    const point = projectResourceGlobePoint(resource, width, height);
    if (!globePointVisible(point.z, globeCamera.position.z) || point.x <= 12 || point.x >= width - 12 || point.y <= 12 || point.y >= height - 12) continue;
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
  // Labels stay mounted and keep tracking their coordinates while the globe
  // moves. Only the label chrome fades (in CSS), so nothing pops in and out.
  // Clustering is the expensive half, so it is recomputed less often during
  // motion while positions still update every frame.
  const minInterval = moving ? (gpuPointsActive ? 120 : 60) : 70;
  // Keep the same hit targets mounted until release. Replacing innerHTML
  // during a touch that started on a marker detaches its event target.
  const positionsOnly = state.dragging || state.pinching || state.touching
    || (pinSignature && globeHasMotion(state) && now - globeLastPinUpdate < minInterval);
  if (positionsOnly) {
    repositionPins(width, height);
    return;
  }
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
      return `<button class="globe-pin ${discoveryClass} ${resource.id === selected?.id ? "is-selected" : ""}" type="button" data-globe-key="${key}" data-pin-id="${resource.id}" style="--pin:${color};--pin-glow:${glow}" aria-label="Select ${resource.name}, ${kindLabel(resource)}" aria-current="${resource.id === selected?.id ? "true" : "false"}"><span></span><strong>${resource.name}<small>${formatResourcePlace(resource)} · ${isExactServiceSite(resource) ? "Listed service location" : kindLabel(resource)}</small></strong></button>`;
    }).join("");
    pinElements = new Map([...layer.querySelectorAll("[data-globe-key]")].map((button) => [button.dataset.globeKey, button]));
    pinSignature = signature;
  }

  placePins(clusters, selected?.id || null);
  lastPinClusters = clusters;
}

function placePins(clusters, selectedId) {
  for (const cluster of clusters) {
    const key = cluster.members.map((resource) => resource.id).join(",");
    const button = pinElements.get(key);
    if (!button) continue;
    button.style.transform = `translate3d(${cluster.x}px, ${cluster.y}px, 0) scale(${0.74 + Math.max(0, cluster.z) * 0.28})`;
    button.style.opacity = String(0.5 + cluster.z * 0.5);
    const visible = globePointVisible(cluster.z, globeCamera.position.z);
    button.style.visibility = visible ? "visible" : "hidden";
    button.style.pointerEvents = visible ? "auto" : "none";
    button.style.zIndex = String(cluster.members.some((resource) => resource.id === selectedId) ? 1000 : Math.round(cluster.z * 100));
  }
}

// Re-projects the existing labels without re-running clustering, so labels
// track the surface smoothly between the heavier clustering passes.
function repositionPins(width, height) {
  if (!lastPinClusters.length || !pinElements.size) return;
  for (const cluster of lastPinClusters) {
    let x = 0, y = 0, count = 0, depth = -1;
    for (const resource of cluster.members) {
      const point = projectResourceGlobePoint(resource, width, height);
      if (!globePointVisible(point.z, globeCamera.position.z)) continue;
      x += point.x; y += point.y; count += 1; depth = Math.max(depth, point.z);
    }
    cluster.x = count ? x / count : -1e6;
    cluster.y = count ? y / count : -1e6;
    cluster.z = depth;
  }
  placePins(lastPinClusters, state.selectedId);
}

function formatCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(5)}°${value >= 0 ? positive : negative}`;
}

function updateGlobeReadout(now = performance.now()) {
  if (now - globeLastReadoutUpdate < 110) return;
  globeLastReadoutUpdate = now;
  const resource = selectedResource();
  const readout = globeReadoutElement || document.getElementById("globeReadout");
  if (!readout) return;
  const zoomLabel = `${state.zoom.toFixed(state.zoom < 2 ? 1 : 2)}×`;
  const detailLabel = earthDetailTextureReady
    ? "detailed + HD NASA"
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
  const elapsed = Math.max(0, (now - lastFrame) / 1000);
  // Bound free-motion travel after a stalled frame, but let camera easing and
  // velocity decay follow elapsed time. Capping easing to 40ms made a slow
  // renderer replay seconds of camera motion long after the fingers released.
  const dt = Math.min(0.04, elapsed);
  lastFrame = now;
  let isIdle = false;
  if (state.targetLon !== null) {
    const lonGap = shortestLongitude(state.rotationLon, state.targetLon);
    const latGap = state.targetLat - state.rotationLat;
    const focusEase = reduceMotion ? 1 : 1 - Math.exp(-elapsed * 6.2);
    state.rotationLon = normalizeLongitude(state.rotationLon + lonGap * focusEase);
    state.rotationLat += latGap * focusEase;
    if (Math.abs(lonGap) * (1 - focusEase) < 0.08 && Math.abs(latGap) * (1 - focusEase) < 0.08) {
      state.rotationLon = state.targetLon;
      state.rotationLat = state.targetLat;
      state.targetLon = null;
      state.targetLat = null;
    }
  } else if (!state.dragging && !state.pinching) {
    state.rotationLon = normalizeLongitude(state.rotationLon + state.velocityLon * dt);
    state.rotationLat = clampGlobeLatitude(state.rotationLat + state.velocityLat * dt);
    const friction = Math.pow(0.055, elapsed);
    state.velocityLon *= friction;
    state.velocityLat *= friction;
    isIdle = state.autoRotate && now > state.interactionUntil && Math.abs(state.velocityLon) < 0.12;
    if (isIdle) {
      state.rotationLon = normalizeLongitude(state.rotationLon + dt * 0.55);
      state.rotationLat += (10 - state.rotationLat) * Math.min(1, dt * 0.22);
      state.ambientZoom = 1;
    }
  }
  if (!isIdle) state.ambientZoom += (1 - state.ambientZoom) * (1 - Math.exp(-elapsed * 4));
  state.zoom += (state.targetZoom - state.zoom) * (reduceMotion ? 1 : 1 - Math.exp(-elapsed * 8));
}

function pauseGlobe() {
  if (globeFrameHandle === null) return;
  window.cancelAnimationFrame(globeFrameHandle);
  globeFrameHandle = null;
}

function wakeGlobe(resetClock = true) {
  if (globeFrameHandle !== null || globeContextLost || !state.globeVisible || document.hidden) return;
  // Reset only when waking from rest; moving frames include rendering time.
  if (resetClock) lastFrame = performance.now();
  globeFrameHandle = window.requestAnimationFrame((now) => {
    globeFrameHandle = null;
    animateGlobe(now);
  });
}

function applyPendingGlobeDetail() {
  if (!globeRenderer || (!pendingDetailGeometry && !pendingDetailImage)) return;
  if (pendingDetailGeometry) {
    state.detailCountryFeatures = pendingDetailGeometry;
    state.detailLandRings = pendingDetailGeometry.flatMap((feature) => extractRings(feature.geometry));
    pendingDetailGeometry = null;
    state.detailGeometryReady = true;
    rebuildCountryBorders();
    updateGlobeLandMask();
    if (state.focusedCountry) setCountryHighlight(state.focusedCountry);
  }
  if (pendingDetailImage) {
    earthDetailTextureImage = pendingDetailImage;
    pendingDetailImage = null;
    earthDetailTextureReady = true;
    refreshGlobeSurface();
  }
  const status = document.getElementById("globeDetailStatus");
  if (status && (state.detailGeometryReady || earthDetailTextureReady)) {
    status.textContent = earthDetailTextureReady ? "detailed · HD NASA" : "detailed boundaries";
  }
}

function animateGlobe(now) {
  if (globeContextLost) return;
  if (!state.globeVisible || document.hidden) {
    lastFrame = now;
    return;
  }
  const canvas = globeCanvasElement || document.getElementById("globeCanvas");
  const width = globeViewportWidth;
  const height = globeViewportHeight;
  advanceGlobe(now);

  const interactionSettled = !state.dragging
    && !state.pinching
    && Math.abs(state.velocityLon) < 0.22
    && Math.abs(state.velocityLat) < 0.22
    && Math.abs(state.targetZoom - state.zoom) < 0.025
    && state.targetLon === null;
  if (interactionSettled) applyPendingGlobeDetail();
  if (interactionSettled && state.zoom > 1.35) loadDetailGeometry();
  const detailTextureZoom = window.innerWidth <= 600 ? 2.7 : 2.15;
  if (interactionSettled && state.zoom > detailTextureZoom) loadDetailEarthImagery();

  const closeView = state.zoom > 1.9;
  if (closeView !== globeCloseViewActive) {
    globeCloseViewActive = closeView;
    (globeStageElement || document.querySelector(".globe-stage"))?.classList.toggle("is-close-view", closeView);
  }

  if (!renderThreeGlobe(width, height, now)) {
    reportGlobeUnavailable();
    return;
  }
  renderPins(width, height, now);
  updateGlobeReadout(now);
  if (globeHasMotion(state)) wakeGlobe(false);
  else {
    state.velocityLon = 0; state.velocityLat = 0; state.zoom = state.targetZoom;
    globeStageElement?.classList.remove("is-globe-moving");
  }
}

function focusRegion(key, selectMatching = false) {
  wakeGlobe();
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
  wakeGlobe();
  const members = ids.map((id) => state.filtered.find((resource) => resource.id === id)).filter(Boolean);
  if (!members.length) return;
  state.clusterIds = members.map((resource) => resource.id);
  const centroid = members.reduce(
    (sum, resource) => sum.add(latLngVector(resource.lat, resource.lng, 1)),
    new THREE.Vector3()
  );
  if (centroid.lengthSq() < 1e-9) centroid.copy(latLngVector(members[0].lat, members[0].lng, 1));
  centroid.normalize();
  state.targetLon = Math.atan2(centroid.x, centroid.z) * 180 / Math.PI;
  const latitude = Math.asin(THREE.MathUtils.clamp(centroid.y, -1, 1)) * 180 / Math.PI;
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
  const hits = globeServicePoints ? globeRaycaster.intersectObject(globeServicePoints, false) : [];
  // Choose the nearest visible screen point, not whichever candidate happens
  // to sit closest to the camera along a broad picking ray.
  const pointHit = hits.map((hit) => {
    const resource = globeServicePoints.userData.resources?.[hit.index];
    const point = resource && projectResourceGlobePoint(resource, rect.width, rect.height);
    if (!point || !globePointVisible(point.z, globeCamera.position.z)) return null;
    if (surfaceHit && hit.distance > surfaceHit.distance + 0.018) return null;
    return { ...hit, screenDistance: Math.hypot(point.x - (event.clientX - rect.left), point.y - (event.clientY - rect.top)) };
  }).filter(Boolean).sort((a, b) => a.screenDistance - b.screenDistance)[0];

  if (pointHit && (!surfaceHit || pointHit.distance <= surfaceHit.distance + 0.018)) {
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
  if (status) status.textContent = "Loading detailed boundaries…";
  try {
    const response = await fetch("/data/countries-detail.geojson", { cache: "force-cache" });
    if (!response.ok) throw new Error(`Detailed map data returned ${response.status}`);
    const data = await response.json();
    pendingDetailGeometry = data.features;
    wakeGlobe();
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
    rebuildCountryBorders();
    updateGlobeLandMask();
    wakeGlobe();
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
  let searchRevision = 0;
  let searchFilterTimer = null;
  let searchHistoryTimer = null;
  let preparationNoticeTimer = null;
  const showSearchPreparation = (revision) => {
    if (searchPreparation.prepared || pendingSearchValue === state.query) return;
    const count = document.getElementById("resultCount");
    const status = document.getElementById("searchStatus");
    count.textContent = status.textContent = "Preparing search…";
    if (preparationNoticeTimer !== null) window.clearTimeout(preparationNoticeTimer);
    preparationNoticeTimer = window.setTimeout(() => {
      if (revision === searchRevision && !searchPreparation.prepared) {
        count.textContent = status.textContent = "Search is still preparing. You can keep typing or browse the directory.";
      }
    }, 3000);
  };
  cancelPendingSearch = () => {
    searchRevision += 1;
    if (searchFilterTimer !== null) window.clearTimeout(searchFilterTimer);
    if (searchHistoryTimer !== null) window.clearTimeout(searchHistoryTimer);
    searchFilterTimer = searchHistoryTimer = null;
    pendingSearchValue = "";
    if (preparationNoticeTimer !== null) window.clearTimeout(preparationNoticeTimer);
    preparationNoticeTimer = null;
  };
  const commitSearchHistory = () => {
    searchHistoryTimer = null;
    writeFinderHistory("push");
  };
  const scheduleSearchHistory = () => {
    if (searchHistoryTimer !== null) window.clearTimeout(searchHistoryTimer);
    searchHistoryTimer = window.setTimeout(commitSearchHistory, 640);
  };
  const commitPendingSearch = async () => {
    if (searchFilterTimer !== null) {
      window.clearTimeout(searchFilterTimer);
      searchFilterTimer = null;
    }
    searchPreparation.prioritize();
    const revision = searchRevision;
    showSearchPreparation(revision);
    await searchPreparation.ready;
    if (revision !== searchRevision) return;
    if (preparationNoticeTimer !== null) window.clearTimeout(preparationNoticeTimer);
    preparationNoticeTimer = null;
    if (pendingSearchValue !== state.query) {
      state.query = pendingSearchValue;
      updateFilters();
    }
    if (searchHistoryTimer !== null) window.clearTimeout(searchHistoryTimer);
    searchHistoryTimer = null;
    writeFinderHistory("push");
  };
  const flushSearchFilter = async () => {
    searchFilterTimer = null;
    searchPreparation.prioritize();
    const revision = searchRevision;
    showSearchPreparation(revision);
    await searchPreparation.ready;
    if (revision !== searchRevision) return;
    if (preparationNoticeTimer !== null) window.clearTimeout(preparationNoticeTimer);
    preparationNoticeTimer = null;
    if (pendingSearchValue === state.query) return;
    state.query = pendingSearchValue;
    updateFilters();
    scheduleSearchHistory();
  };
  const scheduleSearchFilter = (value) => {
    if (value === state.query && preparationNoticeTimer !== null) {
      cancelPendingSearch();
      pendingSearchValue = value;
      updateFilters();
      return;
    }
    searchPreparation.prioritize();
    searchRevision += 1;
    pendingSearchValue = value;
    if (searchFilterTimer !== null) window.clearTimeout(searchFilterTimer);
    searchFilterTimer = window.setTimeout(flushSearchFilter, 48);
  };
  searchInput.addEventListener("input", (event) => {
    const next = sanitizeFinderQuery(event.target.value);
    if (event.target.value !== next) event.target.value = next;
    scheduleSearchFilter(next);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commitPendingSearch();
      return;
    }
    if (event.key !== "Escape" || (!state.query && !pendingSearchValue)) return;
    cancelPendingSearch();
    state.query = "";
    searchInput.value = "";
    updateFilters();
    writeFinderHistory("push");
  });
  searchInput.addEventListener("blur", commitPendingSearch);
  document.getElementById("clearSearch").addEventListener("click", () => {
    cancelPendingSearch();
    state.query = "";
    searchInput.value = "";
    searchInput.focus();
    updateFilters();
    writeFinderHistory("push");
  });

  let catalogFilterFrame = null;
  const scheduleCatalogFilterUpdate = () => {
    if (catalogFilterFrame !== null) return;
    catalogFilterFrame = requestAnimationFrame(() => {
      catalogFilterFrame = null;
      updateFilters();
      writeFinderHistory("push");
    });
  };

  document.getElementById("layerList").addEventListener("rwn:select-need", (event) => {
    const type = event.detail?.type;
    if (type !== "all" && !resourceTypes.includes(type)) return;
    state.activeTypes = type === "all" ? createInitialTypeSet() : new Set([type]);
    scheduleCatalogFilterUpdate();
  });

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
    if (event.target.closest("#clearFinderFilters")) clearFinderFilters();
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

  const refreshSavedResources = () => {
    state.savedIds = loadSavedResources();
    if (state.savedOnly) updateFilters();
    else { renderControls(); renderResourcePanel(); }
  };
  window.addEventListener("pageshow", refreshSavedResources);
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_RESOURCES_KEY || event.key === null) refreshSavedResources();
  });
  document.getElementById("toggleSaved").addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    updateFilters();
    writeFinderHistory("push");
  });
  document.getElementById("downloadDirectory").addEventListener("click", downloadDirectory);
  document.getElementById("clearBrowserData").addEventListener("click", () => {
    try { clearSavedResources(); } catch {
      notify("Saved services could not be cleared. Check this browser’s storage settings and try again.");
      return;
    }
    state.savedIds.clear();
    state.savedOnly = false;
    clearUserLocation();
    notify("Saved services and location sorting cleared");
  });
  window.addEventListener("rwn:offline-unavailable", () => {
    notify("Offline saving is unavailable. The directory still works online.");
  });

  document.getElementById("clearLocation").addEventListener("click", () => {
    clearUserLocation();
    notify("Location sorting cleared");
  });

  document.getElementById("locationRecovery").addEventListener("click", (event) => {
    if (event.target.closest("#retryLocation")) document.getElementById("locateMe")?.click();
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
      state.locationRecovery = "Location is not available in this browser. Search by city, ZIP or postcode instead.";
      state.locationRetryAvailable = false;
      renderLocationState();
      notify("Location is not available in this browser");
      return;
    }
    state.locationRecovery = "";
    state.locationRetryAvailable = false;
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
      state.locationRecovery = error.code === 1
        ? "Location permission was not granted. Search by city, ZIP or postcode instead, or change this site’s location permission in your browser settings."
        : "We could not get a nearby location. Try again, check browser settings, or search by city, ZIP or postcode instead.";
      state.locationRetryAvailable = Boolean(navigator.geolocation);
      renderLocationState();
      notify(error.code === 1 ? "Location permission was not granted" : "A nearby location was not available; try again or search by place");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  const canvas = document.getElementById("globeCanvas");
  const globeStage = canvas.closest(".globe-stage");
  const isGlobeChrome = (target) => target instanceof Element && Boolean(target.closest(".globe-meta, .globe-controls, .globe-readout, .globe-legend, .atlas-key, .globe-cluster-tray, .globe-fallback, .globe-empty, #globeHelp"));

  const prepareGlobeInteraction = () => {
    wakeGlobe();
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

  // Touch Events own touch input on both Safari and browsers that also emit
  // Pointer Events. Running both streams caused competing pinch baselines and
  // release state. Pointer Events here own only mouse and pen input.
  globeStage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.button !== 0 || event.target !== canvas || activeGlobePointers.size) return;
    activeGlobePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { globeStage.setPointerCapture(event.pointerId); } catch {}
    state.dragging = true;
    state.pinching = false;
    state.pointerX = state.pointerStartX = event.clientX;
    state.pointerY = state.pointerStartY = event.clientY;
    state.pointerMoved = false;
    state.pointerTime = event.timeStamp || performance.now();
    markGlobeEngaged();
    prepareGlobeInteraction();
  });

  globeStage.addEventListener("pointermove", (event) => {
    if (!activeGlobePointers.has(event.pointerId) || !state.dragging) return;
    if (Math.hypot(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY) > 6) state.pointerMoved = true;
    const interactionScale = 1 / Math.pow(Math.max(1, state.zoom), 0.72);
    const lonDelta = -(event.clientX - state.pointerX) * 0.30 * interactionScale;
    const latDelta = (event.clientY - state.pointerY) * 0.22 * interactionScale;
    state.rotationLon = normalizeLongitude(state.rotationLon + lonDelta);
    state.rotationLat = clampGlobeLatitude(state.rotationLat + latDelta);
    const pointerNow = event.timeStamp || performance.now();
    const pointerDt = Math.max(8, Math.min(40, pointerNow - (state.pointerTime || pointerNow - 16))) / 1000;
    state.velocityLon = reduceMotion ? 0 : state.velocityLon * 0.58 + lonDelta / pointerDt * 0.42;
    state.velocityLat = reduceMotion ? 0 : state.velocityLat * 0.58 + latDelta / pointerDt * 0.42;
    state.pointerTime = pointerNow;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    wakeGlobe();
  });

  const finishGlobePointer = (event, cancelled = false) => {
    if (!activeGlobePointers.has(event.pointerId)) return;
    const shouldSelect = !cancelled && !state.pointerMoved;
    activeGlobePointers.delete(event.pointerId);
    try { globeStage.releasePointerCapture(event.pointerId); } catch {}
    state.dragging = false;
    state.pointerMoved = false;
    if (cancelled || (event.timeStamp || performance.now()) - state.pointerTime > 100) {
      state.velocityLon = 0;
      state.velocityLat = 0;
    }
    if (shouldSelect) selectCountryFromPointer(event);
    wakeGlobe();
  };
  globeStage.addEventListener("pointerup", (event) => finishGlobePointer(event));
  globeStage.addEventListener("pointercancel", (event) => finishGlobePointer(event, true));
  globeStage.addEventListener("lostpointercapture", (event) => finishGlobePointer(event, true));

  let touchState = null;
  const mapTouches = (touches) => Array.from(touches).filter((touch) => globeStage.contains(touch.target) && !isGlobeChrome(touch.target));
  const touchListDistance = (touches) => Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  const beginTouch = (touch, hadMultiple = false) => ({
    identifier: touch.identifier,
    startX: touch.clientX, startY: touch.clientY,
    lastX: touch.clientX, lastY: touch.clientY,
    startedOnCanvas: touch.target === canvas,
    intent: "pending", moved: hadMultiple, hadMultiple
  });
  const beginTouchPinch = (touches) => {
    touchState = { intent: "pinch", moved: true, hadMultiple: true,
      pinchStartDistance: touchListDistance(touches), pinchStartZoom: state.targetZoom };
    state.pinching = true;
    state.dragging = false;
    state.pointerMoved = true;
    markGlobeEngaged();
    prepareGlobeInteraction();
  };
  const preventNativePagePinch = (event) => {
    if (touchState?.intent === "pinch") event.preventDefault();
  };
  globeStage.addEventListener("gesturestart", preventNativePagePinch, { passive: false });
  globeStage.addEventListener("gesturechange", preventNativePagePinch, { passive: false });
  globeStage.addEventListener("gestureend", preventNativePagePinch, { passive: false });

  globeStage.addEventListener("touchstart", (event) => {
    if (isGlobeChrome(event.target)) return;
    const touches = mapTouches(event.touches);
    state.touching = touches.length > 0;
    if (touches.length > 1) {
      beginTouchPinch(touches);
      event.preventDefault();
    } else if (touches.length === 1 && !touchState) {
      touchState = beginTouch(touches[0]);
    }
  }, { passive: false });
  globeStage.addEventListener("touchmove", (event) => {
    if (!touchState) return;
    const touches = mapTouches(event.touches);
    if (touches.length > 1) {
      if (touchState.intent !== "pinch") beginTouchPinch(touches);
      state.targetZoom = pinchZoom(touchState.pinchStartZoom, touchState.pinchStartDistance,
        touchListDistance(touches), MIN_GLOBE_ZOOM, maxGlobeZoom());
      state.interactionUntil = performance.now() + 5000;
      wakeGlobe();
      event.preventDefault();
      return;
    }
    const touch = touches[0];
    if (!touch) return;
    if (touchState.intent === "pinch") {
      state.pinching = false;
      touchState = beginTouch(touch, true);
    }
    if (Math.hypot(touch.clientX - touchState.startX, touch.clientY - touchState.startY) > 6) touchState.moved = true;
    if (touchState.intent === "pending") {
      const intent = classifyGlobeDragIntent(touch.clientX - touchState.startX, touch.clientY - touchState.startY);
      touchState.intent = intent;
      if (intent !== "rotate") return;
      state.dragging = true;
      state.pinching = false;
      markGlobeEngaged();
      prepareGlobeInteraction();
      touchState.lastX = touch.clientX;
      touchState.lastY = touch.clientY;
    }
    if (touchState.intent !== "rotate") return;
    const interactionScale = 1 / Math.pow(Math.max(1, state.zoom), 0.72);
    state.rotationLon = normalizeLongitude(state.rotationLon - (touch.clientX - touchState.lastX) * 0.30 * interactionScale);
    state.rotationLat = clampGlobeLatitude(state.rotationLat + (touch.clientY - touchState.lastY) * 0.22 * interactionScale);
    state.pointerMoved = true;
    state.interactionUntil = performance.now() + 5000;
    touchState.lastX = touch.clientX;
    touchState.lastY = touch.clientY;
    wakeGlobe();
    event.preventDefault();
  }, { passive: false });
  globeStage.addEventListener("touchend", (event) => {
    if (!touchState) return;
    const touches = mapTouches(event.touches);
    state.touching = touches.length > 0;
    if (touches.length > 1) { beginTouchPinch(touches); return; }
    state.dragging = false;
    state.pinching = false;
    state.velocityLon = 0;
    state.velocityLat = 0;
    if (touches.length === 1) {
      touchState = beginTouch(touches[0], true);
    } else {
      const released = Array.from(event.changedTouches).find((touch) => touch.identifier === touchState.identifier);
      const tap = released && touchState.startedOnCanvas && !touchState.moved && !touchState.hadMultiple;
      touchState = null;
      if (tap) {
        markGlobeEngaged();
        prepareGlobeInteraction();
        selectCountryFromPointer({ clientX: released.clientX, clientY: released.clientY, pointerType: "touch" });
      }
    }
    state.pointerMoved = false;
    wakeGlobe();
  }, { passive: true });

  const resetGlobeInput = () => {
    const captured = [...activeGlobePointers.keys()];
    activeGlobePointers.clear();
    for (const id of captured) { try { globeStage.releasePointerCapture(id); } catch {} }
    touchState = null;
    state.touching = false;
    state.dragging = false;
    state.pinching = false;
    state.pointerMoved = false;
    state.velocityLon = 0;
    state.velocityLat = 0;
    wheelOwner = null;
    lastWheelTime = 0;
    wakeGlobe();
  };
  globeStage.addEventListener("touchcancel", resetGlobeInput, { passive: true });
  canvas.addEventListener("webglcontextlost", resetGlobeInput);
  window.addEventListener("blur", resetGlobeInput);
  window.addEventListener("pagehide", resetGlobeInput);
  window.addEventListener("popstate", resetGlobeInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) resetGlobeInput(); });

  // Wheel ownership is decided per gesture from its shape, so the page keeps
  // scrolling normally and the map only claims the wheel when the visitor
  // clearly means the map. See src/utils/globe-zoom.js for the rules.
  let wheelOwner = null;
  let lastWheelTime = 0;
  globeStage.addEventListener("wheel", (event) => {
    const now = event.timeStamp || performance.now();
    // Never interfere with the globe's own scrollable chrome.
    if (isGlobeChrome(event.target)) return;
    const doc = document.documentElement;
    const maxScroll = Math.max(0, doc.scrollHeight - window.innerHeight);
    const intent = classifyWheelIntent({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      engaged: globeEngaged,
      pageAtTop: window.scrollY <= 1,
      pageAtBottom: window.scrollY >= maxScroll - 1,
      activeOwner: wheelOwner,
      timeSinceLastWheel: now - lastWheelTime
    });
    lastWheelTime = now;
    wheelOwner = intent;
    if (intent !== "zoom") return;
    event.preventDefault();
    // Horizontal gestures carry their magnitude in deltaX; a rightward swipe
    // (positive deltaX) zooms in, matching how map surfaces behave elsewhere.
    const zoomDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : -event.deltaX;
    const factor = wheelZoomFactor(zoomDelta, { precise: event.ctrlKey || event.metaKey });
    zoomTowardPointer(factor, event.clientX, event.clientY);
    state.interactionUntil = performance.now() + 5000;
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    markGlobeEngaged();
    zoomTowardPointer(1.6, event.clientX, event.clientY);
    state.interactionUntil = performance.now() + 5000;
  });
  canvas.addEventListener("keydown", (event) => {
    markGlobeEngaged();
    const baseStep = event.shiftKey ? 12 : 5;
    const step = baseStep / Math.pow(Math.max(1, state.zoom), 0.7);
    if (event.key === "ArrowLeft") state.rotationLon = normalizeLongitude(state.rotationLon - step);
    else if (event.key === "ArrowRight") state.rotationLon = normalizeLongitude(state.rotationLon + step);
    else if (event.key === "ArrowUp") state.rotationLat = clampGlobeLatitude(state.rotationLat + step);
    else if (event.key === "ArrowDown") state.rotationLat = clampGlobeLatitude(state.rotationLat - step);
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

  document.getElementById("zoomIn").addEventListener("click", () => {
    markGlobeEngaged();
    const step = state.targetZoom < 4 ? 1.22 : 1.14;
    state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom * step);
    state.interactionUntil = performance.now() + 5000;
  });
  document.getElementById("zoomOut").addEventListener("click", () => {
    markGlobeEngaged();
    const step = state.targetZoom <= 4 ? 1.22 : 1.14;
    state.targetZoom = Math.max(MIN_GLOBE_ZOOM, state.targetZoom / step);
    state.interactionUntil = performance.now() + 5000;
  });
  document.getElementById("resetGlobe").addEventListener("click", () => {
    document.getElementById("regionFocus").value = "world";
    focusRegion("world");
  });
  document.getElementById("northGlobe").addEventListener("click", () => {
    wakeGlobe();
    state.targetLon = state.rotationLon;
    state.targetLat = 0;
    state.velocityLat = 0;
    state.interactionUntil = performance.now() + 5000;
  });
  document.getElementById("regionFocus").addEventListener("change", (event) => focusRegion(event.target.value, true));
  document.getElementById("toggleMotion").addEventListener("click", (event) => {
    wakeGlobe();
    state.autoRotate = !state.autoRotate;
    event.currentTarget.innerHTML = state.autoRotate ? icon.pause : icon.play;
    event.currentTarget.title = state.autoRotate ? "Pause globe rotation" : "Resume globe rotation";
    event.currentTarget.setAttribute("aria-label", event.currentTarget.title);
    state.interactionUntil = 0;
  });
  document.getElementById("retryGlobe")?.addEventListener("click", () => {
    const context = globeRenderer?.getContext();
    if (context?.isContextLost()) {
      // Wait for the browser's restored event before rebuilding or claiming
      // recovery; constructing a renderer cannot revive a lost context.
      globeContextRecoveryExtension?.restoreContext();
      return;
    }
    recoverGlobeContext();
  });

  const siteMenu = document.querySelector(".site-menu");
  const siteMenuSummary = siteMenu?.querySelector("summary");
  const closeSiteMenu = ({ restoreFocus = false } = {}) => {
    if (!siteMenu?.open) return;
    siteMenu.removeAttribute("open");
    if (restoreFocus) siteMenuSummary?.focus();
  };
  siteMenu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeSiteMenu()));
  document.addEventListener("click", (event) => {
    if (siteMenu?.open && !siteMenu.contains(event.target)) closeSiteMenu({ restoreFocus: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && siteMenu?.open) {
      event.preventDefault();
      closeSiteMenu({ restoreFocus: true });
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeSiteMenu();
  }, { passive: true });
  window.addEventListener("popstate", (event) => {
    const wasPreparing = preparationNoticeTimer !== null;
    cancelPendingSearch();
    restoreFinderHistory(event.state);
    if (wasPreparing && !event.state?.[FINDER_HISTORY_KEY]) updateFilters();
    pendingSearchValue = state.query;
    searchInput.value = state.query;
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
    if (!navigationFrame) navigationFrame = window.requestAnimationFrame(updateCurrentSection);
  }, { passive: true });
  updateCurrentSection();

  if ("IntersectionObserver" in window) {
    const globeObserver = new IntersectionObserver(([entry]) => {
      state.globeVisible = entry.isIntersecting;
      if (state.globeVisible) wakeGlobe();
      else pauseGlobe();
    }, { rootMargin: "0px" });
    globeObserver.observe(document.querySelector(".globe-stage"));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseGlobe();
    else wakeGlobe();
  });

}

shell();
renderStatic();
updateFilters();
const searchPreparation = warmSearchIndex(resources);
bindEvents();
writeFinderHistory();
initThreeGlobe();
loadEarthImagery();
loadLandGeometry();
if (requestedResource && requestedResource === initialResource) {
  const resource = resources.find((item) => item.id === requestedResource);
  if (resource) focusGlobeOn(resource);
}
wakeGlobe();
