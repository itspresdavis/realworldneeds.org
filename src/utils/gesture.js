export function clampZoom(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function pointerDistance(pointers) {
  const [first, second] = Array.from(pointers).slice(0, 2);
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function classifyGlobeDragIntent(dx, dy, { deadZone = 8, horizontalBias = 1.18 } = {}) {
  const x = Math.abs(Number(dx) || 0);
  const y = Math.abs(Number(dy) || 0);
  const distance = Math.hypot(x, y);
  if (distance < Math.max(2, deadZone)) return "pending";
  if (x >= y * horizontalBias) return "rotate";
  if (y >= x) return "scroll";
  return "pending";
}

export function pinchZoom(startZoom, startDistance, currentDistance, minimum, maximum) {
  const safeStart = clampZoom(startZoom, minimum, maximum);
  if (!Number.isFinite(startDistance) || startDistance <= 0 || !Number.isFinite(currentDistance)) return safeStart;
  const rawRatio = Math.max(0.1, currentDistance / startDistance);
  const logDelta = Math.log(rawRatio);
  if (Math.abs(logDelta) < 0.018) return safeStart;
  const easedRatio = Math.exp(logDelta * 0.9);
  return clampZoom(safeStart * easedRatio, minimum, maximum);
}

export function globeViewProfile(zoom, { mobile = false } = {}) {
  const semanticZoom = Math.max(1, Number(zoom) || 1);
  const baseRange = Math.min(semanticZoom, 4);
  const deepRange = Math.max(1, semanticZoom / 4);
  const opticalZoom = Math.pow(baseRange, 0.48) * Math.pow(deepRange, mobile ? 0.16 : 0.20);
  const deepProgress = Math.max(0, semanticZoom - 4);
  const fovReduction = Math.min(mobile ? 5.5 : 7.5, deepProgress * (mobile ? 0.72 : 0.9));
  return {
    semanticZoom,
    opticalZoom,
    fov: 42 - fovReduction,
    minimumCameraDistance: mobile ? 1.5 : 1.4
  };
}

export function pointPickThresholdWorld({ pointerType = "mouse", zoom = 1, cameraDistance, fov = 42, viewportHeight } = {}) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const distanceToSurface = Math.max(0.32, (Number(cameraDistance) || 3.2) - 1);
  const radians = (Math.max(20, Math.min(75, Number(fov) || 42)) * Math.PI) / 180;
  const worldPerPixel = (2 * distanceToSurface * Math.tan(radians / 2)) / height;
  const semanticZoom = Math.max(1, Number(zoom) || 1);
  const basePixels = pointerType === "touch" ? 24 : pointerType === "pen" ? 16 : 11;
  const precisionScale = 1 - Math.min(0.34, Math.max(0, semanticZoom - 2) * 0.035);
  const pixelRadius = Math.max(pointerType === "touch" ? 15 : 7, basePixels * precisionScale);
  return Math.max(0.0055, Math.min(0.075, pixelRadius * worldPerPixel));
}
