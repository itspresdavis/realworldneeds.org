const appReady = import("./app.js");
const refinementReady = import("./refinement.js");
const professionalReady = import("./professional.js");
const accessibilityReady = import("./accessibility.js");
const resultActionsReady = import("./result-actions.js");

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

import("./telemetry.js")
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
