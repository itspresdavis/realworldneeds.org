from pathlib import Path

path = Path("src/app.js")
text = path.read_text()


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "let globeServicePoints = null;\n",
    "let globeServicePoints = null;\nlet globePointSignature = \"\";\n",
    "point signature global",
)

replace_once(
    '''function syncGlobePointLayer() {
  if (!globeWorld || !globeRenderer) return;
  if (!globeServicePoints) {
    globeServicePoints = createGlobePointLayer(state.filtered, categories, {
      pixelRatio: globeRenderer.getPixelRatio?.() || 1
    });
    globeWorld.add(globeServicePoints);
    globeStageElement?.classList.add("has-gpu-points");
    return;
  }
  replaceGlobePointResources(globeServicePoints, state.filtered, categories);
}
''',
    '''function syncGlobePointLayer() {
  if (!globeWorld || !globeRenderer) return;
  const nextSignature = state.filtered.map((resource) => resource.id).join("|");
  if (!globeServicePoints) {
    globeServicePoints = createGlobePointLayer(state.filtered, categories, {
      pixelRatio: globeRenderer.getPixelRatio?.() || 1
    });
    globePointSignature = nextSignature;
    globeWorld.add(globeServicePoints);
    globeStageElement?.classList.add("has-gpu-points");
    return;
  }
  if (nextSignature === globePointSignature) return;
  replaceGlobePointResources(globeServicePoints, state.filtered, categories);
  globePointSignature = nextSignature;
}
''',
    "point geometry dedupe",
)

replace_once(
    '''function renderPins(width, height, now = performance.now()) {
  const moving = state.dragging || state.pinching || Math.abs(state.velocityLon) > 0.18 || Math.abs(state.velocityLat) > 0.18 || Math.abs(state.targetZoom - state.zoom) > 0.008 || state.targetLon !== null;
  const gpuPointsActive = Boolean(globeServicePoints);''',
    '''function renderPins(width, height, now = performance.now()) {
  const ambientMotion = state.autoRotate && now > state.interactionUntil && !state.dragging && !state.pinching;
  const moving = ambientMotion || state.dragging || state.pinching || Math.abs(state.velocityLon) > 0.18 || Math.abs(state.velocityLat) > 0.18 || Math.abs(state.targetZoom - state.zoom) > 0.008 || state.targetLon !== null;
  const gpuPointsActive = Boolean(globeServicePoints);''',
    "ambient point motion",
)

replace_once(
    '''  document.getElementById("showMoreResults").addEventListener("click", () => {
    state.visibleResults += initialResultCount();
    renderResults();
  });''',
    '''  document.getElementById("showMoreResults").addEventListener("click", () => {
    state.visibleResults = Math.min(state.filtered.length, state.visibleResults + initialResultCount());
    renderResults();
  });''',
    "show more cap",
)

replace_once(
    '''  document.getElementById("locateMe").addEventListener("click", () => {
    if (state.userLocation) {
      focusGlobeNearUser();
      notify("Globe recentered on your approximate location");
      return;
    }
    if (!navigator.geolocation) {
      notify("Location is not available in this browser");
      return;
    }
    const button = document.getElementById("locateMe");
    button.classList.add("is-loading");''',
    '''  document.getElementById("locateMe").addEventListener("click", () => {
    const button = document.getElementById("locateMe");
    if (button.classList.contains("is-loading")) return;
    if (state.userLocation) {
      focusGlobeNearUser();
      notify("Globe recentered on your approximate location");
      return;
    }
    if (!navigator.geolocation) {
      notify("Location is not available in this browser");
      return;
    }
    button.classList.add("is-loading");''',
    "location click guard",
)

path.write_text(text)
print("Applied final interaction resilience hardening.")
