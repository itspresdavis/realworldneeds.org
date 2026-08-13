import { readFile, writeFile } from "node:fs/promises";

const path = "dist/src/app.js";
let source = await readFile(path, "utf8");

function replaceRequired(from, to, label) {
  const matches = source.split(from).length - 1;
  if (matches !== 1) throw new Error(`Globe touch transform expected one ${label} match, found ${matches}.`);
  source = source.replace(from, to);
}

replaceRequired(
  `    const startedOnCanvas = event.target === canvas;\n    const shouldTrack = event.pointerType === "touch" ? !isGlobeChrome(event.target) : startedOnCanvas;\n    if (!shouldTrack) return;`,
  `    const startedOnCanvas = event.target === canvas;\n    const startedOnMap = event.pointerType === "touch" ? !isGlobeChrome(event.target) : startedOnCanvas;\n    if (!startedOnMap) return;`,
  "map-surface pointer ownership"
);

replaceRequired(
  `      y: event.clientY,\n      startedOnCanvas,\n      pointerType: event.pointerType\n    });\n    try { globeStage.setPointerCapture(event.pointerId); } catch {}`,
  `      y: event.clientY,\n      startedOnCanvas,\n      startedOnMap,\n      pointerType: event.pointerType,\n      handledRotation: false\n    });\n    if (event.pointerType !== "touch") {\n      try { globeStage.setPointerCapture(event.pointerId); } catch {}\n    }`,
  "deferred touch pointer capture"
);

replaceRequired(
  `    if (!startedOnCanvas) return;\n    state.dragging = event.pointerType !== "touch";`,
  `    if (!startedOnMap) return;\n    state.dragging = event.pointerType !== "touch";`,
  "touch drag map surface"
);

replaceRequired(
  `    globeGestureHadMultiplePointers = true;\n    pinchStartDistance = pointerDistance(activeGlobePointers.values());`,
  `    globeGestureHadMultiplePointers = true;\n    for (const pointerId of activeGlobePointers.keys()) {\n      try { globeStage.setPointerCapture(pointerId); } catch {}\n    }\n    pinchStartDistance = pointerDistance(activeGlobePointers.values());`,
  "pinch pointer capture"
);

replaceRequired(
  `      if (intent !== "rotate") return;\n      state.dragging = true;\n      state.pointerX = event.clientX;`,
  `      if (intent !== "rotate") return;\n      state.dragging = true;\n      try { globeStage.setPointerCapture(event.pointerId); } catch {}\n      event.preventDefault();\n      state.pointerX = event.clientX;`,
  "rotation intent capture"
);

replaceRequired(
  `    state.pointerTime = pointerNow;\n    state.pointerX = event.clientX;\n    state.pointerY = event.clientY;\n  });`,
  `    state.pointerTime = pointerNow;\n    state.pointerX = event.clientX;\n    state.pointerY = event.clientY;\n    pointer.handledRotation = true;\n    if (event.pointerType === "touch") event.preventDefault();\n  });`,
  "locked rotation touch ownership"
);

replaceRequired(
  `      state.dragging = Boolean(remaining?.startedOnCanvas);`,
  `      state.dragging = Boolean(remaining?.startedOnMap && remaining?.pointerType !== "touch");`,
  "remaining pointer state"
);

replaceRequired(
  `  globeStage.addEventListener("touchstart", (event) => {\n    if (event.touches.length > 1 && !isGlobeChrome(event.target)) event.preventDefault();\n  }, { passive: false });\n  globeStage.addEventListener("touchmove", (event) => {\n    if (event.touches.length > 1 && !isGlobeChrome(event.target)) event.preventDefault();\n  }, { passive: false });`,
  `  let touchFallbackState = null;\n  const resetTouchFallback = () => { touchFallbackState = null; };\n  globeStage.addEventListener("touchstart", (event) => {\n    if (isGlobeChrome(event.target)) return;\n    if (event.touches.length > 1) {\n      resetTouchFallback();\n      event.preventDefault();\n      return;\n    }\n    const touch = event.touches[0];\n    if (!touch) return;\n    touchFallbackState = {\n      startX: touch.clientX,\n      startY: touch.clientY,\n      lastX: touch.clientX,\n      lastY: touch.clientY,\n      lastTime: event.timeStamp || performance.now(),\n      intent: "pending"\n    };\n  }, { passive: false });\n  globeStage.addEventListener("touchmove", (event) => {\n    if (isGlobeChrome(event.target)) return;\n    if (event.touches.length > 1) {\n      resetTouchFallback();\n      event.preventDefault();\n      return;\n    }\n    const touch = event.touches[0];\n    const fallback = touchFallbackState;\n    if (!touch || !fallback) return;\n    if (fallback.intent === "pending") {\n      fallback.intent = classifyGlobeDragIntent(touch.clientX - fallback.startX, touch.clientY - fallback.startY);\n      if (fallback.intent === "scroll") return;\n      if (fallback.intent !== "rotate") return;\n      if (!state.dragging) {\n        state.dragging = true;\n        state.pinching = false;\n        state.pointerMoved = true;\n        prepareGlobeInteraction();\n      }\n      fallback.lastX = touch.clientX;\n      fallback.lastY = touch.clientY;\n      fallback.lastTime = event.timeStamp || performance.now();\n      event.preventDefault();\n      return;\n    }\n    if (fallback.intent !== "rotate") return;\n    const pointerPath = activeGlobePointers.size === 1 ? activeGlobePointers.values().next().value : null;\n    if (pointerPath?.handledRotation) {\n      event.preventDefault();\n      return;\n    }\n    const dx = touch.clientX - fallback.lastX;\n    const dy = touch.clientY - fallback.lastY;\n    const interactionScale = 1 / Math.pow(Math.max(1, state.zoom), 0.72);\n    const lonDelta = -dx * 0.30 * interactionScale;\n    const latDelta = dy * 0.22 * interactionScale;\n    state.rotationLon = normalizeLongitude(state.rotationLon + lonDelta);\n    state.rotationLat = Math.max(-58, Math.min(58, state.rotationLat + latDelta));\n    state.targetLon = null;\n    state.targetLat = null;\n    state.pointerMoved = true;\n    state.interactionUntil = performance.now() + 5000;\n    fallback.lastX = touch.clientX;\n    fallback.lastY = touch.clientY;\n    fallback.lastTime = event.timeStamp || performance.now();\n    event.preventDefault();\n  }, { passive: false });\n  globeStage.addEventListener("touchend", resetTouchFallback, { passive: true });\n  globeStage.addEventListener("touchcancel", resetTouchFallback, { passive: true });`,
  "single-touch rotation fallback"
);

await writeFile(path, source);

const clarityPath = "dist/src/clarity.css";
let clarity = await readFile(clarityPath, "utf8");
const marker = "/* RWN globe touch-surface contract */";
if (clarity.includes(marker)) throw new Error("Globe touch-surface contract was injected more than once.");
clarity += `\n\n${marker}\n@media (max-width: 900px) {\n  .rwn-professional .globe-stage { touch-action: pan-y; overscroll-behavior-y: auto; }\n  .rwn-professional .globe-canvas,\n  .rwn-professional .globe-pin-layer,\n  .rwn-professional .globe-pin { touch-action: pan-y; }\n  .rwn-professional .globe-controls,\n  .rwn-professional .globe-meta__tools { touch-action: manipulation; }\n}\n`;
await writeFile(clarityPath, clarity);
