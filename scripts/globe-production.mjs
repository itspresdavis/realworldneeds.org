import { readFile, writeFile } from "node:fs/promises";

const path = "dist/src/app.js";
let source = await readFile(path, "utf8");

function replaceRequired(from, to, label) {
  const matches = source.split(from).length - 1;
  if (matches !== 1) throw new Error(`Globe production transform expected one ${label} match, found ${matches}.`);
  source = source.replace(from, to);
}

function replaceRequiredPattern(pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)].length;
  if (matches !== 1) throw new Error(`Globe production transform expected one ${label} match, found ${matches}.`);
  source = source.replace(pattern, replacement);
}

function replaceAllRequired(from, to, expected, label) {
  const matches = source.split(from).length - 1;
  if (matches !== expected) throw new Error(`Globe production transform expected ${expected} ${label} matches, found ${matches}.`);
  source = source.split(from).join(to);
}

replaceRequiredPattern(
  /import \{ pinchZoom, pointerDistance \} from "(\.\/utils\/gesture\.js\?v=[a-f0-9]{12})";/g,
  (_match, versionedGesturePath) => `import { classifyGlobeDragIntent, globeViewProfile, pinchZoom, pointPickThresholdWorld, pointerDistance } from "${versionedGesturePath}";`,
  "versioned globe interaction utilities"
);

replaceRequired(
  `function maxGlobeZoom() {\n  return window.innerWidth <= 600 ? 2.55 : 3.05;\n}`,
  `function maxGlobeZoom() {\n  return window.innerWidth <= 600 ? 8.0 : 12.0;\n}`,
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
  `globeCamera = new THREE.PerspectiveCamera(42, 1, 0.02, 100);`,
  "camera clipping plane"
);
replaceRequired(
  `new THREE.SphereGeometry(1, window.innerWidth <= 600 ? 96 : 128, window.innerWidth <= 600 ? 64 : 80),`,
  `new THREE.SphereGeometry(1, window.innerWidth <= 600 ? 160 : 288, window.innerWidth <= 600 ? 112 : 180),`,
  "surface geometry detail"
);
replaceAllRequired(
  `const dpr = Math.min(window.devicePixelRatio || 1, width < 720 ? 1.25 : 1.5);`,
  `const dprCap = width < 720 ? (state.zoom > 2.5 ? 1.6 : 1.4) : (state.zoom > 2.5 ? 2 : 1.75);\n  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);`,
  2,
  "adaptive render resolution"
);
replaceRequired(
  `globeBaseCameraDistance = cameraDistanceForSphere(globeCamera.fov, globeCamera.aspect, 1.055, 1.07);`,
  `globeBaseCameraDistance = cameraDistanceForSphere(42, globeCamera.aspect, 1.055, 1.07);`,
  "stable camera base distance"
);
replaceRequired(
  `globeCamera.position.z = Math.max(1.09, globeBaseCameraDistance / Math.max(1, state.zoom * state.ambientZoom));`,
  `const viewProfile = globeViewProfile(state.zoom * state.ambientZoom, { mobile: window.innerWidth <= 600 });\n  if (Math.abs(globeCamera.fov - viewProfile.fov) > 0.02) {\n    globeCamera.fov = viewProfile.fov;\n    globeCamera.updateProjectionMatrix();\n  }\n  globeCamera.position.z = Math.max(viewProfile.minimumCameraDistance, globeBaseCameraDistance / viewProfile.opticalZoom);`,
  "progressive optical zoom"
);
replaceRequired(`latLngVector(resource.lat, resource.lng, 1.035)`, `latLngVector(resource.lat, resource.lng, 1.009)`, "resource projection radius");
replaceRequired(`latLngVector(lat, lng, 1.035)`, `latLngVector(lat, lng, 1.009)`, "coordinate projection radius");

replaceRequired(
  `const preferredWidth = earthDetailTextureReady ? 8192 : 5400;`,
  `const preferredWidth = earthDetailTextureReady ? (window.innerWidth <= 600 ? 4096 : 8192) : 4096;`,
  "adaptive Earth texture resolution"
);
replaceRequired(
  `if (earthDetailTextureRequested || window.innerWidth <= 900 || navigator.connection?.saveData) return;\n  if ((globeRenderer?.capabilities.maxTextureSize || 0) < 6144) return;`,
  `if (earthDetailTextureRequested || navigator.connection?.saveData || document.visibilityState === "hidden") return;\n  const connectionType = String(navigator.connection?.effectiveType || "").toLowerCase();\n  if (connectionType === "slow-2g" || connectionType === "2g") return;\n  if ((globeRenderer?.capabilities.maxTextureSize || 0) < 4096) return;`,
  "HD texture eligibility"
);
replaceRequired(
  `  if (interactionSettled && (state.zoom > 1.28 || state.targetZoom > 1.28)) loadDetailGeometry();\n  if (interactionSettled && (state.zoom > 1.55 || state.targetZoom > 1.55)) loadDetailEarthImagery();\n\n  const closeView = state.zoom > 1.72;`,
  `  if (interactionSettled && (state.zoom > 1.35 || state.targetZoom > 1.35)) loadDetailGeometry();\n  const detailTextureZoom = window.innerWidth <= 600 ? 2.7 : 2.15;\n  if (interactionSettled && (state.zoom > detailTextureZoom || state.targetZoom > detailTextureZoom)) loadDetailEarthImagery();\n\n  const closeView = state.zoom > 1.9;`,
  "progressive detail thresholds"
);

replaceRequired(
  `? { lat: resource.lat, lng: resource.lng, zoom: window.innerWidth <= 600 ? 1.72 : 1.9 }`,
  `? { lat: resource.lat, lng: resource.lng, zoom: window.innerWidth <= 600 ? 3.8 : 4.8 }`,
  "service focus view"
);
replaceRequired(
  `const serviceZoom = exact ? (window.innerWidth <= 600 ? 1.72 : 1.9) : 1.22;`,
  `const serviceZoom = exact ? (window.innerWidth <= 600 ? 3.8 : 4.8) : 1.55;`,
  "service focus zoom"
);
replaceRequired(
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 1.72 : 1.9);`,
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 3.4 : 4.2);`,
  "user location focus zoom"
);
replaceRequired(
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 1.42 : 1.34);`,
  `state.targetZoom = Math.min(maxGlobeZoom(), window.innerWidth <= 600 ? 2.8 : 3.4);`,
  "cluster focus zoom"
);
replaceRequired(
  `const threshold = Math.max(22, (width < 600 ? 54 : 44) - (state.zoom - 0.86) * 16);`,
  `const minimumThreshold = state.zoom > 8 ? 6 : state.zoom > 5 ? 8 : 12;\n  const threshold = Math.max(minimumThreshold, (width < 600 ? 48 : 38) - Math.max(0, state.zoom - 0.86) * (state.zoom > 5 ? 5 : 7));`,
  "deep-view clustering threshold"
);

replaceRequired(
  `globeRaycaster.params.Points.threshold = event.pointerType === "touch" ? 0.034 : 0.022;`,
  `globeRaycaster.params.Points.threshold = pointPickThresholdWorld({\n    pointerType: event.pointerType,\n    zoom: state.zoom,\n    cameraDistance: globeCamera.position.z,\n    fov: globeCamera.fov,\n    viewportHeight: rect.height\n  });`,
  "screen-space point picking"
);
replaceRequired(
  `      y: event.clientY,\n      startedOnCanvas\n    });`,
  `      y: event.clientY,\n      startedOnCanvas,\n      pointerType: event.pointerType\n    });`,
  "pointer type tracking"
);
replaceRequired(
  `    if (!startedOnCanvas) return;\n    state.dragging = true;`,
  `    if (!startedOnCanvas) return;\n    state.dragging = event.pointerType !== "touch";`,
  "touch drag arbitration"
);
replaceRequired(
  `    if (!state.dragging) return;\n    if (Math.hypot(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY) > 6) state.pointerMoved = true;`,
  `    if (!state.dragging && pointer.pointerType === "touch") {\n      const intent = classifyGlobeDragIntent(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY);\n      if (intent === "scroll") {\n        activeGlobePointers.delete(event.pointerId);\n        return;\n      }\n      if (intent !== "rotate") return;\n      state.dragging = true;\n      state.pointerX = event.clientX;\n      state.pointerY = event.clientY;\n      state.pointerTime = event.timeStamp || performance.now();\n    }\n    if (!state.dragging) return;\n    if (Math.hypot(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY) > 6) state.pointerMoved = true;`,
  "touch intent lock"
);
replaceRequired(
  `    const lonDelta = -dx * 0.30 / state.zoom;\n    const latDelta = dy * 0.22 / state.zoom;`,
  `    const interactionScale = 1 / Math.pow(Math.max(1, state.zoom), 0.72);\n    const lonDelta = -dx * 0.30 * interactionScale;\n    const latDelta = dy * 0.22 * interactionScale;`,
  "deep zoom drag precision"
);

replaceAllRequired(`    if (event.pointerType === "touch") event.preventDefault();\n`, ``, 2, "single-touch preventDefault");
replaceRequired(
  `canvas.addEventListener("wheel", (event) => {\n    event.preventDefault();\n    state.targetZoom = Math.max(MIN_GLOBE_ZOOM, Math.min(maxGlobeZoom(), state.targetZoom * Math.exp(-event.deltaY * 0.00135)));\n    state.interactionUntil = performance.now() + 5000;\n  }, { passive: false });`,
  `canvas.addEventListener("wheel", (event) => {\n    if (!(event.ctrlKey || event.metaKey)) return;\n    event.preventDefault();\n    state.targetZoom = Math.max(MIN_GLOBE_ZOOM, Math.min(maxGlobeZoom(), state.targetZoom * Math.exp(-event.deltaY * 0.00165)));\n    state.interactionUntil = performance.now() + 5000;\n  }, { passive: false });`,
  "page-scroll-first wheel behavior"
);
replaceRequired(
  `document.getElementById("zoomIn").addEventListener("click", () => { state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom * 1.22); state.interactionUntil = performance.now() + 5000; });\n  document.getElementById("zoomOut").addEventListener("click", () => { state.targetZoom = Math.max(MIN_GLOBE_ZOOM, state.targetZoom / 1.22); state.interactionUntil = performance.now() + 5000; });`,
  `document.getElementById("zoomIn").addEventListener("click", () => { const step = state.targetZoom < 4 ? 1.22 : 1.14; state.targetZoom = Math.min(maxGlobeZoom(), state.targetZoom * step); state.interactionUntil = performance.now() + 5000; });\n  document.getElementById("zoomOut").addEventListener("click", () => { const step = state.targetZoom <= 4 ? 1.22 : 1.14; state.targetZoom = Math.max(MIN_GLOBE_ZOOM, state.targetZoom / step); state.interactionUntil = performance.now() + 5000; });`,
  "precision zoom controls"
);
replaceRequired(
  `    const step = event.shiftKey ? 12 : 5;`,
  `    const baseStep = event.shiftKey ? 12 : 5;\n    const step = baseStep / Math.pow(Math.max(1, state.zoom), 0.7);`,
  "keyboard rotation precision"
);

replaceRequired(
  `<button type="button" id="toggleMotion" title="Pause globe rotation" aria-label="Pause globe rotation">\${icon.pause}</button>`,
  `<button type="button" id="toggleMotion" title="Resume globe rotation" aria-label="Resume globe rotation">\${icon.play}</button>`,
  "motion button initial state"
);
replaceRequired(
  `Rotate the globe by dragging or using arrow keys. Pinch with two fingers, use plus and minus, or use the mouse wheel to zoom. Select a country or any colored location marker for details. Higher-resolution national boundaries load automatically when you zoom closer.`,
  `Drag left or right to rotate. On touch screens, vertical swipes keep scrolling the page and two fingers zoom the globe. Use plus and minus, or hold Control or Command while scrolling, for precise zoom. Select a service point for details. Higher-detail boundaries and imagery load as you move closer.`,
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
