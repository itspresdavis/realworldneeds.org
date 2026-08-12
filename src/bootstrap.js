const appReady = import("./app.js");
const refinementReady = import("./refinement.js");
const professionalReady = import("./professional.js");
const accessibilityReady = import("./accessibility.js");
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

const { installProfessionalPresentation } = await professionalReady;
installProfessionalPresentation();

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

accessibilityReady
  .then(({ installAccessibility }) => installAccessibility())
  .catch(() => {});

import("./telemetry.js")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, { once: true });
}
