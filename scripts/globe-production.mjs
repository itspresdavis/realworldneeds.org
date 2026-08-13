import { readFile, writeFile } from "node:fs/promises";

const path = "dist/src/app.js";
let source = await readFile(path, "utf8");

function replaceRequired(from, to, label) {
  const matches = source.split(from).length - 1;
  if (matches !== 1) throw new Error(`Globe production transform expected one ${label} match, found ${matches}.`);
  source = source.replace(from, to);
}

function replaceAllRequired(from, to, expected, label) {
  const matches = source.split(from).length - 1;
  if (matches !== expected) throw new Error(`Globe production transform expected ${expected} ${label} matches, found ${matches}.`);
  source = source.split(from).join(to);
}

replaceRequired(
  `function maxGlobeZoom() {\n  return window.innerWidth <= 600 ? 2.55 : 3.05;\n}`,
  `function maxGlobeZoom() {\n  return window.innerWidth <= 600 ? 6.5 : 9.0;\n}`,
  "maximum zoom"
);

replaceRequired(`const DEFAULT_RESOURCE = "whitechapel-mission";`, `const DEFAULT_RESOURCE = null;`, "default resource");
replaceRequired(
  `const initialResource = resources.some((resource) => resource.id === requestedResource) ? requestedResource : DEFAULT_RESOURCE;`,
  `const initialResource = resources.some((resource) => resource.id === requestedResource) ? requestedResource : null;`,
  "initial resource"
);
replaceRequired(`  autoRotate: !reduceMotion,`, `  autoRotate: false,`, "initial globe motion");
replaceRequired(`  inspectorOpen: true,`, `  inspectorOpen: Boolean(initialResource),`, "initial inspector state");

replaceRequired(
  `  if (!state.filtered.some((resource) => resource.id === state.selectedId)) {\n    state.selectedId = state.filtered[0]?.id || null;\n  }`,
  `  if (state.selectedId && !state.filtered.some((resource) => resource.id === state.selectedId)) {\n    state.selectedId = null;\n    state.inspectorOpen = false;\n  }`,
  "filter selection fallback"
);

replaceRequired(
  `globeCamera = new THREE.PerspectiveCamera(42, 1, 0.015, 100);`,
  `globeCamera = new THREE.PerspectiveCamera(42, 1, 0.004, 100);`,
  "camera clipping plane"
);
replaceRequired(
  `new THREE.SphereGeometry(1, window.innerWidth <= 600 ? 96 : 128, window.innerWidth <= 600 ? 64 : 80),`,
  `new THREE.SphereGeometry(1, window.innerWidth <= 600 ? 144 : 256, window.innerWidth <= 600 ? 96 : 160),`,
  "surface geometry detail"
);
replaceRequired(
  `globeCamera.position.z = Math.max(1.09, globeBaseCameraDistance / Math.max(1, state.zoom * state.ambientZoom));`,
  `globeCamera.position.z = Math.max(1.018, globeBaseCameraDistance / Math.max(1, state.zoom * state.ambientZoom));`,
  "minimum camera distance"
);
replaceAllRequired(`latLngVector(resource.lat, resource.lng, 1.035)`, `latLngVector(resource.lat, resource.lng, 1.010)`, 2, "projected point radius");

replaceRequired(
  `if (earthDetailTextureRequested || window.innerWidth <= 900 || navigator.connection?.saveData) return;`,
  `if (earthDetailTextureRequested || navigator.connection?.saveData) return;`,
  "HD texture eligibility"
);

replaceRequired(
  `? { lat: resource.lat, lng: resource.lng, zoom: window.innerWidth <= 600 ? 1.72 : 1.9 }`,
  `? { lat: resource.lat, lng: resource.lng, zoom: window.innerWidth <= 600 ? 2.55 : 3.1 }`,
  "service focus view"
);
replaceRequired(
  `const serviceZoom = exact ? (window.innerWidth <= 600 ? 1.72 : 1.9) : 1.22;`,
  `const serviceZoom = exact ? (window.innerWidth <= 600 ? 2.55 : 3.1) : 1.32;`,
  "service focus zoom"
);
replaceRequired(
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 1.72 : 1.9);`,
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 2.4 : 2.85);`,
  "user location focus zoom"
);
replaceRequired(
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 1.42 : 1.34);`,
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 1.9 : 2.15);`,
  "cluster focus zoom"
);
replaceRequired(
  `const threshold = Math.max(22, (width < 600 ? 54 : 44) - (state.zoom - 0.86) * 16);`,
  `const threshold = Math.max(state.zoom > 4 ? 10 : 16, (width < 600 ? 50 : 40) - Math.max(0, state.zoom - 0.86) * 10);`,
  "deep-view clustering threshold"
);

replaceAllRequired(`    if (event.pointerType === "touch") event.preventDefault();\n`, ``, 2, "single-touch preventDefault");
replaceRequired(
  `canvas.addEventListener("wheel", (event) => {\n    event.preventDefault();\n    state.targetZoom = Math.max(MIN_GLOBE_ZOOM, Math.min(maxGlobeZoom(), state.targetZoom * Math.exp(-event.deltaY * 0.00135)));\n    state.interactionUntil = performance.now() + 5000;\n  }, { passive: false });`,
  `canvas.addEventListener("wheel", (event) => {\n    if (!(event.ctrlKey || event.metaKey)) return;\n    event.preventDefault();\n    state.targetZoom = Math.max(MIN_GLOBE_ZOOM, Math.min(maxGlobeZoom(), state.targetZoom * Math.exp(-event.deltaY * 0.0021)));\n    state.interactionUntil = performance.now() + 5000;\n  }, { passive: false });`,
  "page-scroll-first wheel behavior"
);

replaceRequired(
  `<button type="button" id="toggleMotion" title="Pause globe rotation" aria-label="Pause globe rotation">\${icon.pause}</button>`,
  `<button type="button" id="toggleMotion" title="Resume globe rotation" aria-label="Resume globe rotation">\${icon.play}</button>`,
  "motion button initial state"
);
replaceRequired(
  `Rotate the globe by dragging or using arrow keys. Pinch with two fingers, use plus and minus, or use the mouse wheel to zoom. Select a country or any colored location marker for details. Higher-resolution national boundaries load automatically when you zoom closer.`,
  `Drag or use arrow keys to rotate. Pinch, use plus and minus, or hold Control or Command while scrolling to zoom. Normal scrolling continues down the page. Select a country or service point for details. Higher-detail boundaries and imagery load as you move closer.`,
  "globe help text"
);

replaceRequired(
  `  const sections = ["finder", "about", "standards", "accountability"].map((id) => document.getElementById(id));`,
  `  const sections = ["finder", "about", "standards"].map((id) => document.getElementById(id));`,
  "navigation section registry"
);
replaceRequired(
  `if (requestedResource === initialResource) focusGlobeOn(resources.find((resource) => resource.id === requestedResource));`,
  `if (requestedResource && requestedResource === initialResource) {\n  const resource = resources.find((item) => item.id === requestedResource);\n  if (resource) focusGlobeOn(resource);\n}`,
  "requested resource startup focus"
);

await writeFile(path, source);
