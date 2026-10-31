const appReady = import("./app.js?v=32eafdd55a02");
const refinementReady = import("./refinement.js?v=32eafdd55a02");
const professionalReady = import("./professional.js?v=32eafdd55a02");
const accessibilityReady = import("./accessibility.js?v=32eafdd55a02");
const resultActionsReady = import("./result-actions.js?v=32eafdd55a02");

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

const reportOfflineUnavailable = () => {
  document.documentElement.dataset.offlineSaving = "unavailable";
  window.dispatchEvent(new CustomEvent("rwn:offline-unavailable"));
};

document.getElementById("clearBrowserData")?.addEventListener("click", () => {
  clearOfflineData().catch(reportOfflineUnavailable);
});

import("./telemetry.js?v=32eafdd55a02")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(reportOfflineUnavailable);
  };
  // Dynamic imports can finish after the document's one-shot load event.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
