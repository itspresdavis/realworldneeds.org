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
  `      y: event.clientY,\n      startedOnCanvas,\n      startedOnMap,\n      pointerType: event.pointerType\n    });\n    if (event.pointerType !== "touch") {\n      try { globeStage.setPointerCapture(event.pointerId); } catch {}\n    }`,
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
  `    state.pointerTime = pointerNow;\n    state.pointerX = event.clientX;\n    state.pointerY = event.clientY;\n    if (event.pointerType === "touch") event.preventDefault();\n  });`,
  "locked rotation touch ownership"
);

replaceRequired(
  `      state.dragging = Boolean(remaining?.startedOnCanvas);`,
  `      state.dragging = Boolean(remaining?.startedOnMap && remaining?.pointerType !== "touch");`,
  "remaining pointer state"
);

await writeFile(path, source);

const clarityPath = "dist/src/clarity.css";
let clarity = await readFile(clarityPath, "utf8");
const marker = "/* RWN globe touch-surface contract */";
if (clarity.includes(marker)) throw new Error("Globe touch-surface contract was injected more than once.");
clarity += `\n\n${marker}\n@media (max-width: 900px) {\n  .rwn-professional .globe-stage { touch-action: pan-y; overscroll-behavior-y: auto; }\n  .rwn-professional .globe-canvas,\n  .rwn-professional .globe-pin-layer,\n  .rwn-professional .globe-pin { touch-action: pan-y; }\n  .rwn-professional .globe-controls,\n  .rwn-professional .globe-meta__tools { touch-action: manipulation; }\n}\n`;
await writeFile(clarityPath, clarity);
