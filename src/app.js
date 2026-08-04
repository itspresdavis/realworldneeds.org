import { categories, resourceTypes, resources, trustPrinciples } from "./data/resources.js";
import { createInitialTypeSet, distanceKm, matchesResource } from "./utils/geo.js";

const state = {
  query: "",
  activeTypes: createInitialTypeSet(),
  selectedId: resources[0].id,
  rotationLon: -74,
  rotationLat: 4,
  zoom: 1,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  filtered: resources,
  userLocation: null
};

const root = document.getElementById("root");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let pinSignature = "";

const icon = {
  globe: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
  search: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>`,
  external: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/></svg>`,
  check: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>`,
  pin: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>`,
  route: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19c4-9 10 0 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/></svg>`,
  locate: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
  copy: `<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`
};

function categoryCount(type) {
  return resources.filter((resource) => resource.category === type).length;
}

function shell() {
  root.innerHTML = `
    <a class="skip-link" href="#main">Skip to aid finder</a>
    <div class="app-shell" id="top">
      <header class="site-header">
        <a class="brand" href="#top" aria-label="Real World Needs home">
          <span class="brand__mark">${icon.globe}</span>
          <span><strong>RWN</strong><small>Real World Needs</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#resources">Resources</a>
          <a href="#map">Globe</a>
          <a href="#verify">Verify</a>
          <a href="#safety">Safety</a>
          <a href="#mission">Mission</a>
        </nav>
        <a class="header-action" href="#verify">Source standards</a>
      </header>

      <main id="main">
        <section class="hero-shell" id="map">
          <div class="hero-copy">
            <h1>Find real help, from <span>verified sources.</span></h1>
            <p>Explore free food, clothing, shelter, and nonprofit aid using official, source-backed listings across the globe.</p>
            <div class="proof-row" aria-label="RWN data standards">
              <span><strong>${resources.length}</strong> source-backed listings</span>
              <span><strong>${resourceTypes.length}</strong> aid layers</span>
              <span><strong>0</strong> unsupported claims</span>
            </div>
            <div class="finder-controls" id="resources" role="search">
              <label class="search-box">
                ${icon.search}
                <span class="sr-only">Search resources</span>
                <input id="resourceSearch" placeholder="Search city, service, organization, or address" type="search">
              </label>
              <p class="sr-only" id="searchStatus" aria-live="polite"></p>
              <div class="toggle-grid" id="toggleGrid" aria-label="Aid category filters"></div>
              <div class="finder-actions">
                <button class="locate-button" type="button" id="locateMe">${icon.locate}Find nearest listed resource</button>
                <button class="reset-button" type="button" id="resetFilters">Show all verified layers</button>
              </div>
            </div>
          </div>

          <div class="globe-layout">
            <section class="globe-stage" aria-label="Interactive global aid resource globe">
              <canvas id="globeCanvas" class="globe-canvas" tabindex="0" role="img" aria-describedby="globeHelp" aria-label="Interactive globe showing source-backed aid resources"></canvas>
              <p class="sr-only" id="globeHelp">Drag to rotate, use the mouse wheel or zoom buttons, or focus the globe and use arrow keys. Resource buttons below provide the same listings without the map.</p>
              <div class="globe-pin-layer" id="pinLayer"></div>
              <div class="globe-status" id="globeStatus"></div>
              <div class="globe-controls" aria-label="Globe controls">
                <button type="button" id="zoomIn" aria-label="Zoom in">+</button>
                <button type="button" id="zoomOut" aria-label="Zoom out">-</button>
                <button type="button" id="resetGlobe" aria-label="Reset globe">${icon.route}</button>
              </div>
              <div class="globe-legend" id="globeLegend"></div>
            </section>
            <aside class="resource-panel" aria-live="polite" id="resourcePanel"></aside>
          </div>

          <div class="resource-rail">
            <div class="resource-rail__top">
              <p id="resultCount" aria-live="polite"></p>
              <span>Official sources only</span>
            </div>
            <div class="resource-strip" id="resourceStrip" tabindex="0" aria-label="Scrollable verified resource list"></div>
          </div>

          <div class="category-cue" id="categoryCue" aria-label="Category color legend"></div>
        </section>

        <section class="safety-section" id="safety" aria-labelledby="safetyTitle">
          <div class="safety-section__signal">Important</div>
          <div>
            <h2 id="safetyTitle">Confirm before you travel.</h2>
            <p>RWN is an informational directory, not an emergency service or a provider of the listed programs. Hours, eligibility, inventory, and availability can change. Open the official source and contact the organization before making a trip. If anyone is in immediate danger, contact the emergency services for their location.</p>
          </div>
        </section>

        <section class="verification-section" id="verify">
          <div class="section-copy">
            <h2>RWN is built around proof before reach.</h2>
            <p>The directory starts small on purpose. Every visible listing points to a public source, keeps its service claim modest, and shows when RWN last checked the source.</p>
          </div>
          <div class="principle-grid" id="principleGrid"></div>
        </section>

        <section class="mission-section" id="mission">
          <div class="mission-panel">
            <h2>A serious support layer for real needs.</h2>
            <p>RWN is building a public trust layer between people who need help and organizations already doing the work. The directory makes sources visible and keeps claims intentionally narrow.</p>
          </div>
          <div class="mission-steps">
            <article><span>01</span><div><h3>Find aid quickly</h3><p>Search by need, location, organization, or source-backed service category.</p></div></article>
            <article><span>02</span><div><h3>Show the source</h3><p>Every listing keeps its official source close, visible, and easy to open.</p></div></article>
            <article><span>03</span><div><h3>Keep records current</h3><p>Future RWN operators can review listings, flag changes, and add local notes.</p></div></article>
          </div>
        </section>

        <section class="sources-section">
          <div>
            <h2>Seed data sources</h2>
            <p>This prototype uses verified public sources only. It does not claim live hours, eligibility, inventory, or availability unless a source is opened and reviewed.</p>
          </div>
          <div class="source-cloud" id="sourceCloud"></div>
        </section>
      </main>

      <footer class="site-footer">
        <div><span>Real World Needs</span><p>Source-backed aid discovery, built to grow carefully.</p></div>
        <nav aria-label="Footer navigation"><a href="#resources">Find aid</a><a href="#verify">Data standards</a><a href="#safety">Safety</a></nav>
      </footer>
      <div class="status-toast" id="statusToast" role="status" aria-live="polite"></div>
    </div>
  `;
}

function typeList(resource) {
  return [resource.category, ...(resource.secondaryCategories || [])];
}

function selectedResource() {
  return state.filtered.find((resource) => resource.id === state.selectedId) || state.filtered[0] || null;
}

function directionsUrl(resource) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resource.address)}`;
}

function checkedDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function distanceLabel(resource) {
  if (!state.userLocation) return "";
  const distance = distanceKm(
    state.userLocation.lat,
    state.userLocation.lng,
    resource.lat,
    resource.lng
  );
  return distance < 10 ? `${distance.toFixed(1)} km away` : `${Math.round(distance).toLocaleString()} km away`;
}

function notify(message) {
  const toast = document.getElementById("statusToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(notify.timeoutId);
  notify.timeoutId = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setSelected(id, options = {}) {
  state.selectedId = id;
  if (options.focusGlobe) {
    const resource = selectedResource();
    if (resource) focusGlobeOn(resource);
  }
  renderFilters();
  renderResourcePanel();
  renderResourceStrip();
  if (window.innerWidth < 980) {
    document.getElementById("resourcePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderStaticBits() {
  const toggleGrid = document.getElementById("toggleGrid");
  toggleGrid.innerHTML = resourceTypes.map((type) => {
    const category = categories[type];
    return `
      <button class="type-toggle is-active" type="button" data-type="${type}" style="--type-color:${category.color};--type-glow:${category.glow}" aria-pressed="true">
        <span class="type-toggle__dot"></span><span>${category.label}</span><span class="type-toggle__count">${categoryCount(type)}</span>
      </button>
    `;
  }).join("");

  document.getElementById("categoryCue").innerHTML = Object.entries(categories).map(([type, category]) => `
    <span style="--cue-color:${category.color}">${category.label}</span>
  `).join("");

  document.getElementById("principleGrid").innerHTML = trustPrinciples.map((principle) => `
    <article><span>${icon.check}</span><h3>${principle.title}</h3><p>${principle.text}</p></article>
  `).join("");

  const sources = new Map();
  resources.forEach((resource) => sources.set(resource.sourceName, resource.sourceUrl));
  document.getElementById("sourceCloud").innerHTML = Array.from(sources.entries()).map(([name, url]) => `
    <a href="${url}" target="_blank" rel="noopener noreferrer">${name}${icon.external}</a>
  `).join("");
}

function renderFilters() {
  document.querySelectorAll(".type-toggle").forEach((button) => {
    const type = button.dataset.type;
    const active = state.activeTypes.has(type);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.getElementById("globeLegend").innerHTML = resourceTypes
    .filter((type) => state.activeTypes.has(type))
    .map((type) => `<span style="--legend-color:${categories[type].color}">${categories[type].label}</span>`)
    .join("");

  const selected = selectedResource();
  const activeLabels = resourceTypes
    .filter((type) => state.activeTypes.has(type))
    .map((type) => categories[type].label)
    .join(", ");
  document.getElementById("globeStatus").innerHTML = `
    <span>Showing ${state.filtered.length} of ${resources.length}</span>
    <strong>${selected ? selected.name : "No matching listings"}</strong>
    <small>${activeLabels || "All aid layers"}</small>
  `;
  document.getElementById("searchStatus").textContent = `${state.filtered.length} source-backed listing${state.filtered.length === 1 ? "" : "s"} found.`;
}

function renderResourcePanel() {
  const resource = selectedResource();
  const panel = document.getElementById("resourcePanel");
  if (!resource) {
    panel.removeAttribute("style");
    panel.innerHTML = `
      <div class="empty-state">
        <span>${icon.search}</span>
        <h2>No source-backed listings match.</h2>
        <p>Try another city, service, organization, or address, or restore all aid layers.</p>
        <button type="button" data-empty-reset>Reset search and filters</button>
      </div>
    `;
    panel.querySelector("[data-empty-reset]").addEventListener("click", resetSearchAndFilters);
    return;
  }
  const category = categories[resource.category];
  const secondary = typeList(resource)
    .filter((type) => type !== resource.category)
    .map((type) => categories[type].label);
  panel.style.setProperty("--type-color", category.color);
  panel.style.setProperty("--type-glow", category.glow);
  panel.innerHTML = `
    <div class="resource-panel__top">
      <span class="verified-chip verified-chip--strong">${icon.check}source-backed</span>
      <span class="resource-panel__category">${category.label}</span>
    </div>
    <h2>${resource.name}</h2>
    <p class="resource-panel__summary">${resource.summary}</p>
    <div class="resource-panel__layers">
      <span style="--layer-color:${category.color}">${category.label}</span>
      ${secondary.map((label) => `<span>${label}</span>`).join("")}
    </div>
    <dl class="resource-panel__facts">
      <div><dt>Address</dt><dd>${resource.address}</dd></div>
      <div><dt>Region</dt><dd>${resource.city}, ${resource.country}</dd></div>
      <div><dt>Source reviewed</dt><dd><time datetime="${resource.lastChecked}">${checkedDate(resource.lastChecked)}</time></dd></div>
      ${state.userLocation ? `<div><dt>Approx. distance</dt><dd>${distanceLabel(resource)}</dd></div>` : ""}
    </dl>
    <div class="service-list">
      <h3>What they can help with</h3>
      ${resource.services.map((service) => `<span>${service}</span>`).join("")}
    </div>
    <div class="source-box">
      <span>Verified source</span>
      <strong>${resource.sourceName}</strong>
      <p>${resource.sourceDetail}</p>
    </div>
    <div class="resource-panel__actions">
      <a class="source-button" href="${resource.sourceUrl}" target="_blank" rel="noopener noreferrer">Open official source${icon.external}</a>
      ${resource.address.startsWith("Online") ? "" : `<a class="utility-button" href="${directionsUrl(resource)}" target="_blank" rel="noopener noreferrer">${icon.route}Directions</a>`}
      <button class="utility-button" type="button" data-copy-address>${icon.copy}Copy address</button>
    </div>
  `;
  panel.querySelector("[data-copy-address]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(resource.address);
      notify("Address copied.");
    } catch {
      notify("Copy unavailable. Select the address text instead.");
    }
  });
}

function resourceCard(resource) {
  const category = categories[resource.category];
  const selected = resource.id === selectedResource()?.id;
  return `
    <article class="resource-card resource-card--compact ${selected ? "is-selected" : ""}" style="--type-color:${category.color};--type-glow:${category.glow}">
      <button type="button" data-resource-id="${resource.id}">
        <span class="resource-card__icon">${icon.pin}</span>
        <span class="resource-card__body">
          <span class="resource-card__meta">${category.label}</span>
          <strong>${resource.name}</strong>
          <span>${resource.city}, ${resource.country}</span>
          <span>${resource.address}</span>
          ${state.userLocation ? `<span class="resource-card__distance">${distanceLabel(resource)}</span>` : ""}
        </span>
      </button>
      <div class="resource-card__footer">
        <span class="verified-chip">${icon.check}source-backed</span>
        <a href="${resource.sourceUrl}" target="_blank" rel="noopener noreferrer">Open source${icon.external}</a>
      </div>
    </article>
  `;
}

function renderResourceStrip() {
  document.getElementById("resultCount").textContent = `${state.filtered.length} source-backed listing${state.filtered.length === 1 ? "" : "s"}`;
  document.getElementById("resourceStrip").innerHTML = state.filtered.length
    ? state.filtered.map(resourceCard).join("")
    : `<p class="resource-strip__empty">No matching listings. Adjust your search or filters.</p>`;
  document.querySelectorAll("[data-resource-id]").forEach((button) => {
    button.addEventListener("click", () => setSelected(button.dataset.resourceId, { focusGlobe: true }));
  });
}

function updateFiltered() {
  state.filtered = resources.filter((resource) => matchesResource(resource, state.query, state.activeTypes));
  if (state.userLocation) {
    state.filtered.sort((a, b) => {
      const aDistance = distanceKm(state.userLocation.lat, state.userLocation.lng, a.lat, a.lng);
      const bDistance = distanceKm(state.userLocation.lat, state.userLocation.lng, b.lat, b.lng);
      return aDistance - bDistance;
    });
  }
  if (!state.filtered.some((resource) => resource.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }
  renderFilters();
  renderResourcePanel();
  renderResourceStrip();
}

function resetSearchAndFilters() {
  state.query = "";
  state.activeTypes = createInitialTypeSet();
  state.selectedId = resources[0].id;
  document.getElementById("resourceSearch").value = "";
  updateFiltered();
  focusGlobeOn(resources[0]);
}

function focusGlobeOn(resource) {
  state.rotationLon = resource.lng;
  state.rotationLat = Math.max(-42, Math.min(42, resource.lat * 0.38));
  state.zoom = Math.max(1.04, state.zoom);
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function project(resource, width, height) {
  const radius = Math.min(width, height) * 0.39 * state.zoom;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const lat = toRad(resource.lat);
  const lng = toRad(resource.lng - state.rotationLon);
  const tilt = toRad(state.rotationLat);
  const cosLat = Math.cos(lat);
  const x = cosLat * Math.sin(lng);
  const y = Math.sin(lat) * Math.cos(tilt) - cosLat * Math.cos(lng) * Math.sin(tilt);
  const z = Math.sin(lat) * Math.sin(tilt) + cosLat * Math.cos(lng) * Math.cos(tilt);
  return {
    x: cx + x * radius,
    y: cy - y * radius,
    z,
    visible: z > -0.05,
    radius
  };
}

const landShapes = [
  [[60, -165], [67, -135], [48, -101], [25, -108], [12, -94], [20, -68], [48, -70], [60, -112]],
  [[11, -82], [-5, -74], [-19, -66], [-42, -68], [-54, -57], [-27, -44], [5, -54]],
  [[58, -10], [65, 40], [49, 92], [20, 101], [5, 70], [23, 32], [38, 8]],
  [[28, 34], [8, 43], [-25, 30], [-35, 18], [-10, 5], [20, 12]],
  [[49, 95], [63, 141], [40, 160], [20, 136], [20, 102]],
  [[-12, 114], [-36, 115], [-43, 147], [-25, 154], [-11, 132]],
  [[72, -45], [82, -18], [76, 22], [68, 10], [64, -32]]
];

function drawLand(ctx, width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(37, 119, 86, 0.72)";
  ctx.strokeStyle = "rgba(156, 245, 196, 0.18)";
  ctx.lineWidth = 1;
  landShapes.forEach((shape) => {
    const points = shape.map(([lat, lng]) => project({ lat, lng }, width, height));
    const visible = points.filter((point) => point.visible).length;
    if (visible < 2) return;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (!point.visible) return;
      if (index === 0 || !points[index - 1]?.visible) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function drawGreatCircle(ctx, start, end, width, height, color) {
  const a = project(start, width, height);
  const b = project(end, width, height);
  if (!a.visible || !b.visible) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - Math.min(width, height) * 0.08;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 9]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mx, my, b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function renderGlobe() {
  const canvas = document.getElementById("globeCanvas");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const radius = Math.min(width, height) * 0.39 * state.zoom;
  const cx = width * 0.5;
  const cy = height * 0.5;
  if (!state.dragging && !reduceMotion) {
    state.rotationLon += 0.018;
  }

  ctx.clearRect(0, 0, width, height);
  const space = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.35);
  space.addColorStop(0, "rgba(37, 200, 120, 0.18)");
  space.addColorStop(0.65, "rgba(2, 12, 18, 0.15)");
  space.addColorStop(1, "rgba(2, 12, 18, 0)");
  ctx.fillStyle = space;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const ocean = ctx.createRadialGradient(cx - radius * 0.32, cy - radius * 0.42, radius * 0.08, cx, cy, radius);
  ocean.addColorStop(0, "#17485b");
  ocean.addColorStop(0.48, "#082331");
  ocean.addColorStop(1, "#020b11");
  ctx.fillStyle = ocean;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  drawLand(ctx, width, height);

  ctx.strokeStyle = "rgba(156, 245, 196, 0.16)";
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    for (let lng = -180; lng <= 180; lng += 5) {
      const point = project({ lat, lng }, width, height);
      if (!point.visible) continue;
      if (lng === -180) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  for (let lng = -150; lng <= 180; lng += 30) {
    ctx.beginPath();
    let started = false;
    for (let lat = -88; lat <= 88; lat += 5) {
      const point = project({ lat, lng }, width, height);
      if (!point.visible) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(point.x, point.y);
        started = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }

  const selected = selectedResource();
  if (selected) {
    state.filtered.forEach((resource) => {
      if (resource.id !== selected.id && resource.category === selected.category) {
        drawGreatCircle(ctx, selected, resource, width, height, categories[resource.category].color);
      }
    });
  }

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(156, 245, 196, 0.54)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(37, 200, 120, 0.62)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const pins = document.getElementById("pinLayer");
  const signature = `${state.selectedId}:${state.filtered.map((resource) => resource.id).join("|")}`;
  if (signature !== pinSignature) {
    pinSignature = signature;
    pins.innerHTML = state.filtered.map((resource) => {
    const category = categories[resource.category];
    const selectedPin = resource.id === selected?.id;
    return `
      <button class="globe-pin ${selectedPin ? "is-selected" : ""}" type="button" data-pin-id="${resource.id}" aria-label="Select ${resource.name}" style="--pin-color:${category.color};--pin-glow:${category.glow};">
        <span></span>
        ${selectedPin ? `<strong>${resource.city}</strong>` : ""}
      </button>
    `;
    }).join("");
    document.querySelectorAll("[data-pin-id]").forEach((button) => {
      button.addEventListener("click", () => setSelected(button.dataset.pinId, { focusGlobe: true }));
    });
  }
  state.filtered.forEach((resource) => {
    const button = pins.querySelector(`[data-pin-id="${resource.id}"]`);
    if (!button) return;
    const point = project(resource, width, height);
    const selectedPin = resource.id === selected?.id;
    button.style.display = point.visible ? "grid" : "none";
    button.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) scale(${selectedPin ? 1.28 : Math.max(0.72, 0.85 + point.z * 0.2)})`;
  });

  window.requestAnimationFrame(renderGlobe);
}

function bindEvents() {
  document.getElementById("resourceSearch").addEventListener("input", (event) => {
    state.query = event.target.value;
    updateFiltered();
  });

  document.getElementById("toggleGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    if (state.activeTypes.has(type)) state.activeTypes.delete(type);
    else state.activeTypes.add(type);
    if (state.activeTypes.size === 0) state.activeTypes = createInitialTypeSet();
    updateFiltered();
    const selected = selectedResource();
    if (selected) focusGlobeOn(selected);
  });

  document.getElementById("resetFilters").addEventListener("click", resetSearchAndFilters);

  document.getElementById("locateMe").addEventListener("click", () => {
    const button = document.getElementById("locateMe");
    if (!navigator.geolocation) {
      notify("Location is not supported in this browser.");
      return;
    }
    button.disabled = true;
    button.innerHTML = `${icon.locate}Locating...`;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        state.userLocation = { lat: coords.latitude, lng: coords.longitude };
        state.selectedId = null;
        updateFiltered();
        const nearest = selectedResource();
        if (nearest) focusGlobeOn(nearest);
        button.disabled = false;
        button.innerHTML = `${icon.locate}Sorted by distance`;
        notify("Listings sorted by approximate distance. Your location stays in this browser session.");
      },
      () => {
        button.disabled = false;
        button.innerHTML = `${icon.locate}Find nearest listed resource`;
        notify("Location was not available. Search by city or address instead.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });

  const canvas = document.getElementById("globeCanvas");
  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.rotationLon -= dx * 0.33;
    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + dy * 0.18));
  });
  canvas.addEventListener("pointerup", () => {
    state.dragging = false;
  });
  canvas.addEventListener("pointerleave", () => {
    state.dragging = false;
  });
  canvas.addEventListener("pointercancel", () => {
    state.dragging = false;
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.zoom = Math.max(0.72, Math.min(1.34, state.zoom - event.deltaY * 0.001));
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 12 : 5;
    if (event.key === "ArrowLeft") state.rotationLon -= step;
    else if (event.key === "ArrowRight") state.rotationLon += step;
    else if (event.key === "ArrowUp") state.rotationLat = Math.max(-58, state.rotationLat - step);
    else if (event.key === "ArrowDown") state.rotationLat = Math.min(58, state.rotationLat + step);
    else if (event.key === "+" || event.key === "=") state.zoom = Math.min(1.34, state.zoom + 0.1);
    else if (event.key === "-" || event.key === "_") state.zoom = Math.max(0.72, state.zoom - 0.1);
    else return;
    event.preventDefault();
  });

  document.getElementById("zoomIn").addEventListener("click", () => {
    state.zoom = Math.min(1.34, state.zoom + 0.1);
  });
  document.getElementById("zoomOut").addEventListener("click", () => {
    state.zoom = Math.max(0.72, state.zoom - 0.1);
  });
  document.getElementById("resetGlobe").addEventListener("click", () => {
    state.rotationLon = -74;
    state.rotationLat = 4;
    state.zoom = 1;
  });
}

shell();
renderStaticBits();
renderFilters();
renderResourcePanel();
renderResourceStrip();
bindEvents();
renderGlobe();
