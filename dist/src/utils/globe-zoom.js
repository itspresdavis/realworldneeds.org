// Wheel and trackpad zoom arbitration for the globe.
//
// The globe lives inside a scrolling page, so a wheel event is ambiguous: it
// can mean "zoom the map" or "scroll past the map". Guessing wrong produces the
// two classic failures — a map that swallows the page scroll, or a map that
// cannot be zoomed at all. This module resolves the ambiguity from the shape of
// the gesture instead of forcing the visitor to hold a modifier key.
//
// Rules, in priority order:
//  1. An explicit pinch-zoom gesture (ctrl/meta + wheel, which is what browsers
//     synthesise for trackpad pinches) always zooms.
//  2. A gesture that is mostly horizontal is a map gesture, never page scroll.
//  3. Otherwise the page scrolls, unless the visitor has already engaged the
//     map (clicked, dragged or used its controls) *and* the page cannot scroll
//     further in that direction — in which case the map takes over rather than
//     rubber-banding.
// A gesture keeps whichever owner it starts with until the wheel goes quiet,
// so a single flick never switches halfway through.

export const GESTURE_IDLE_MS = 180;

export function wheelZoomFactor(deltaY, { precise = false } = {}) {
  const delta = Number(deltaY) || 0;
  // Clamp so one violent wheel notch or an inertial trackpad spike cannot
  // teleport the camera.
  const bounded = Math.max(-120, Math.min(120, delta));
  const strength = precise ? 0.0022 : 0.0034;
  return Math.exp(-bounded * strength);
}

export function classifyWheelIntent({
  deltaX = 0,
  deltaY = 0,
  ctrlKey = false,
  metaKey = false,
  engaged = false,
  pageAtTop = false,
  pageAtBottom = false,
  activeOwner = null,
  timeSinceLastWheel = Infinity
} = {}) {
  // A continuing gesture keeps its owner so the page and map never fight
  // mid-flick.
  if (activeOwner && timeSinceLastWheel < GESTURE_IDLE_MS) return activeOwner;

  if (ctrlKey || metaKey) return "zoom";

  const horizontal = Math.abs(Number(deltaX) || 0);
  const vertical = Math.abs(Number(deltaY) || 0);
  if (horizontal > vertical * 1.4 && horizontal > 2) return "zoom";

  if (engaged) {
    const scrollingUp = (Number(deltaY) || 0) < 0;
    const scrollingDown = (Number(deltaY) || 0) > 0;
    // Only claim the wheel when the page genuinely has nowhere left to go,
    // so the map never interrupts reading.
    if (scrollingDown && pageAtBottom) return "zoom";
    if (scrollingUp && pageAtTop) return "zoom";
  }

  return "page";
}
