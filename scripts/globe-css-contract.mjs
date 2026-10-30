// Appends the globe touch-surface contract to the built presentation layer.
// The interaction logic itself lives in src/app.js; this only guarantees the
// browser hands vertical swipes back to the page on small screens.
import { readFile, writeFile } from "node:fs/promises";

const clarityPath = "dist/src/clarity.css";
const marker = "/* RWN globe touch-surface contract */";
let clarity = await readFile(clarityPath, "utf8");
if (clarity.includes(marker)) throw new Error("Globe touch-surface contract was injected more than once.");
clarity += `

${marker}
@media (max-width: 900px) {
  .rwn-professional .globe-stage { touch-action: pan-y; overscroll-behavior-y: auto; }
  .rwn-professional .globe-canvas,
  .rwn-professional .globe-pin-layer,
  .rwn-professional .globe-pin { touch-action: pan-y; }
  .rwn-professional .globe-controls,
  .rwn-professional .globe-meta__tools { touch-action: manipulation; }
}
`;
await writeFile(clarityPath, clarity);
