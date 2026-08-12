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

  @media (max-width: 900px) {
    .globe-canvas {
      touch-action: pan-y;
      overscroll-behavior-y: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .globe-pin-layer { transition: none; }
  }
`;
document.head.append(runtimeStyle);

const clarityStyle = document.createElement("link");
const clarityUrl = new URL("./clarity.css", import.meta.url);
const releaseVersion = new URL(import.meta.url).searchParams.get("v");
if (releaseVersion) clarityUrl.searchParams.set("v", releaseVersion);
clarityStyle.rel = "stylesheet";
clarityStyle.href = clarityUrl.href;
clarityStyle.dataset.rwnClarity = "true";
document.head.append(clarityStyle);

const appReady = import("./app.js");
const refinementReady = import("./refinement.js");
const worldClassReady = import("./world-class.js");
const resultActionsReady = import("./result-actions.js");
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

// The globe is a deliberate exploration tool, not ambient motion. Start it still.
requestAnimationFrame(() => {
  const motionButton = document.getElementById("toggleMotion");
  const label = `${motionButton?.getAttribute("aria-label") || ""} ${motionButton?.getAttribute("title") || ""}`;
  if (motionButton && /pause globe rotation/i.test(label)) motionButton.click();
});

resultActionsReady
  .then(({ installResultActions }) => installResultActions())
  .catch(() => {});

const clearOfflineData = async () => {
  if ("caches" in window) {
    const names = await window.caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("rwn-offline-")).map((name) => window.caches.delete(name)));
  }
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_RWN_OFFLINE" });
};

document.getElementById("clearBrowserData")?.addEventListener("click", () => {
  clearOfflineData().catch(() => {});
});

worldClassReady
  .then(({ installWorldClassUX }) => installWorldClassUX())
  .catch(() => {});

import("./telemetry.js")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, { once: true });
}
