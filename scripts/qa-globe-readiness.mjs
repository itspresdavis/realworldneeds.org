// Runs in the page. Observe initialization without creating a graphics context.
// A context-loss recovery assertion requires the renderer and its listener to exist.
export async function waitForGlobeRendererReady({ timeoutMs = 12000, pollMs = 50 } = {}) {
  const started = performance.now();
  for (;;) {
    const canvas = document.getElementById("globeCanvas");
    const stage = document.querySelector(".globe-stage");
    const state = {
      startup: document.documentElement.dataset.globeStartup || "pending",
      recoveryBound: canvas?.dataset.rwnContextRecovery === "true",
      canvasPresent: Boolean(canvas),
      stagePresent: Boolean(stage),
      unavailable: Boolean(stage?.classList.contains("is-globe-unavailable"))
    };
    if (state.startup === "ready" && state.recoveryBound && state.canvasPresent && state.stagePresent && !state.unavailable) return state;
    if (state.startup === "unavailable" || performance.now() - started >= timeoutMs)
      throw new Error(`Globe renderer is not ready for context-loss recovery: ${JSON.stringify(state)}`);
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
