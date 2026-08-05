export function clampZoom(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function pointerDistance(pointers) {
  const [first, second] = Array.from(pointers).slice(0, 2);
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function pinchZoom(startZoom, startDistance, currentDistance, minimum, maximum) {
  const safeStart = clampZoom(startZoom, minimum, maximum);
  if (!Number.isFinite(startDistance) || startDistance <= 0 || !Number.isFinite(currentDistance)) return safeStart;
  const ratio = Math.max(0.1, currentDistance / startDistance);
  return clampZoom(safeStart * Math.pow(ratio, 0.92), minimum, maximum);
}
