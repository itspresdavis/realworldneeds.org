const appReady = import("./app.js?v=6ed89ade14d2");
const refinementReady = import("./refinement.js?v=6ed89ade14d2");
const professionalReady = import("./professional.js?v=6ed89ade14d2");
const accessibilityReady = import("./accessibility.js?v=6ed89ade14d2");
const resultActionsReady = import("./result-actions.js?v=6ed89ade14d2");

// The application owns its DOM and state. Presentation and accessibility
// install only after app initialization so startup is deterministic.
await appReady;

const [
  { installRefinements },
  { installProfessionalPresentation },
  { installAccessibility },
  { installResultActions }
] = await Promise.all([
  refinementReady,
  professionalReady,
  accessibilityReady,
  resultActionsReady
]);

installProfessionalPresentation();
installRefinements();
installAccessibility();
installResultActions();

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

import("./telemetry.js?v=6ed89ade14d2")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, { once: true });
}
