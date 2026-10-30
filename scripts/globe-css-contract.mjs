// Appends the globe touch-surface contract to the built presentation layer.
// The interaction logic itself lives in src/app.js; this only guarantees the
// browser reserves direct manipulation for explicitly enabled Explore mode.
import { readFile, writeFile } from "node:fs/promises";

const clarityPath = "dist/src/clarity.css";
const marker = "/* RWN globe touch-surface contract */";
let clarity = await readFile(clarityPath, "utf8");
if (clarity.includes(marker)) throw new Error("Globe touch-surface contract was injected more than once.");
clarity += `

${marker}
.rwn-professional .globe-stage { touch-action: pan-y pinch-zoom; overscroll-behavior-y: auto; }
.rwn-professional .globe-canvas,
.rwn-professional .globe-pin-layer,
.rwn-professional .globe-pin { touch-action: pan-y pinch-zoom; }
.rwn-professional .globe-stage.is-touch-exploring .globe-canvas,
.rwn-professional .globe-stage.is-touch-exploring .globe-pin { touch-action: none; }
.rwn-professional .globe-touch-controls[hidden],
.rwn-professional .is-globe-unavailable .globe-touch-controls { display: none !important; }
.rwn-professional .globe-controls,
.rwn-professional .globe-meta__tools,
.rwn-professional .globe-touch-controls { touch-action: manipulation; }
`;
await writeFile(clarityPath, clarity);
