// Keep the real directory links available if app initialization replaces the
// shell and then fails. Capture them before any module can run.
const preboot = document.getElementById("preboot-finder")?.cloneNode(true);
const root = document.getElementById("root");
// Attach rejection handlers immediately: optional imports can fail while the
// application is still loading, before their deterministic installation turn.
const settle = (promise) => promise.then(
  (module) => ({ ok: true, module }),
  () => ({ ok: false })
);
const appReady = settle(import("./app.js"));
const refinementReady = settle(import("./refinement.js"));
const professionalReady = settle(import("./professional.js"));
const accessibilityReady = settle(import("./accessibility.js"));
const resultActionsReady = settle(import("./result-actions.js"));
const reportStartupFailure = (layer) => console.error(`RWN startup: ${layer} unavailable.`);

// The application owns its DOM and state. Install independent enhancements in
// order, but let a missing module or a failed installer affect only its layer.
const app = await appReady;
if (app.ok) {
  let degraded = false;
  const installLayer = async (ready, layer, install) => {
    const result = await ready;
    try {
      if (!result.ok || await install(result.module) === false) throw new Error("Layer unavailable");
    } catch {
      degraded = true;
      reportStartupFailure(layer);
    }
  };
  await installLayer(professionalReady, "presentation", ({ installProfessionalPresentation }) => {
    return installProfessionalPresentation();
  });
  await installLayer(refinementReady, "finder controls", ({ installRefinements }) => {
    return installRefinements();
  });
  await installLayer(accessibilityReady, "accessibility controls", ({ installAccessibility }) => {
    return installAccessibility();
  });
  await installLayer(resultActionsReady, "service actions", ({ installResultActions }) => {
    return installResultActions();
  });
  document.documentElement.dataset.finderStartup = degraded ? "degraded" : "ready";
} else {
  document.documentElement.dataset.finderStartup = "unavailable";
  reportStartupFailure("interactive finder");
  if (preboot && root) {
    const status = preboot.querySelector(".preboot-finder__status");
    if (status) status.textContent = "The interactive finder could not load. Browse by need or open the full directory to find services.";
    root.replaceChildren(preboot);
  }
}

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
