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

const appReady = import("./app.js");
const refinementReady = import("./refinement.js");
const worldClassReady = import("./world-class.js");
const { installRefinements } = await refinementReady;

let refinementsInstalled = false;
let refinementFrames = 0;
const installFinderRefinements = () => {
  if (refinementsInstalled) return;
  const finderReady = document.querySelector(".finder-search")
    && document.querySelectorAll(".layer-toggle[data-type]").length >= 7;

  if (finderReady) {
    installRefinements();
    refinementsInstalled = true;
    return;
  }

  refinementFrames += 1;
  if (refinementFrames < 180) requestAnimationFrame(installFinderRefinements);
};
installFinderRefinements();

await appReady;
if (!refinementsInstalled) {
  installRefinements();
  refinementsInstalled = true;
}

worldClassReady
  .then(({ installWorldClassUX }) => installWorldClassUX())
  .catch(() => {});

import("./telemetry.js")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

const loadExperience = () => import("./experience.js").catch(() => {});

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadExperience, { timeout: 1400 });
} else {
  window.setTimeout(loadExperience, 180);
}
