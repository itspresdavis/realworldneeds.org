const runtimeStyle = document.createElement("style");
runtimeStyle.textContent = `
  .globe-canvas {
    touch-action: none;
    overscroll-behavior: contain;
  }

  .globe-pin-layer {
    transition: opacity 110ms ease;
  }

  .globe-stage.has-gpu-points.is-globe-moving .globe-pin-layer {
    opacity: 0;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .globe-pin-layer { transition: none; }
  }
`;
document.head.append(runtimeStyle);

await import("./app.js");
const { installRefinements } = await import("./refinement.js");
installRefinements();

import("./telemetry.js")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

const loadExperience = () => import("./experience.js").catch(() => {});

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadExperience, { timeout: 1400 });
} else {
  window.setTimeout(loadExperience, 180);
}
