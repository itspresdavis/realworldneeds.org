// Rendering policy is independent of the DOM so idle work and projection limits
// can be verified without a GPU. Interactions and async assets invalidate a frame.
export function globeHasMotion(state) {
  return state.autoRotate || state.dragging || state.pinching
    || state.targetLon !== null
    || Math.abs(state.velocityLon) > 0.005
    || Math.abs(state.velocityLat) > 0.005
    || Math.abs(state.targetZoom - state.zoom) > 0.0001;
}

export function frameBufferMatches(canvas, width, height, pixelRatio) {
  // WebGLRenderer floors physical dimensions. Rounding here reallocates the
  // drawing buffer every frame on fractional CSS sizes / device pixel ratios.
  return canvas.width === Math.floor(width * pixelRatio)
    && canvas.height === Math.floor(height * pixelRatio);
}

export function globePointVisible(depth, cameraDistance) {
  // Perspective horizon for a unit sphere: P dot C > r². The former z > 0
  // hemisphere test left invisible far-side buttons covering the visible map.
  return depth > 1 / cameraDistance + 0.003;
}
