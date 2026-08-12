const appReady = import("./app.js");
const refinementReady = import("./refinement.js");
const professionalReady = import("./professional.js");
const accessibilityReady = import("./accessibility.js");
const resultActionsReady = import("./result-actions.js");

// The application owns the DOM and state. Enhancement layers install only after
// that initialization is complete so they cannot race the app's initial render.
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

// The globe is a deliberate exploration tool, not ambient motion. The app already
// disables rotation for reduced-motion visitors; synchronize that button state
// without toggling rotation back on. Otherwise pause the normal initial rotation.
requestAnimationFrame(() => {
  const motionButton = document.getElementById("toggleMotion");
  if (!motionButton) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    motionButton.innerHTML = '<span aria-hidden="true">▶</span>';
    motionButton.title = "Resume globe rotation";
    motionButton.setAttribute("aria-label", motionButton.title);
    return;
  }

  const label = `${motionButton.getAttribute("aria-label") || ""} ${motionButton.getAttribute("title") || ""}`;
  if (/pause globe rotation/i.test(label)) motionButton.click();
});

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

import("./telemetry.js")
  .then(({ startTelemetry }) => startTelemetry())
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, { once: true });
}
