const appReady = import("./app.js?v=a6ff8ebff57e");
const refinementReady = import("./refinement.js?v=a6ff8ebff57e");
const professionalReady = import("./professional.js?v=a6ff8ebff57e");
const accessibilityReady = import("./accessibility.js?v=a6ff8ebff57e");
const resultActionsReady = import("./result-actions.js?v=a6ff8ebff57e");

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

import("./telemetry.js?v=a6ff8ebff57e")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, { once: true });
}
