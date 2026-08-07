from pathlib import Path

path = Path("src/app.js")
text = path.read_text()

replacements = [
    (
        """let globeLastReadoutUpdate = 0;
let globeCloseViewActive = false;""",
        """let globeLastReadoutUpdate = 0;
let globeCloseViewActive = false;
let globePageScrollUntil = 0;
let globeLastScrollFrame = 0;""",
    ),
    (
        """  const canvas = globeCanvasElement || document.getElementById(\"globeCanvas\");
  const width = globeViewportWidth;
  const height = globeViewportHeight;
  advanceGlobe(now);""",
        """  const canvas = globeCanvasElement || document.getElementById(\"globeCanvas\");
  const width = globeViewportWidth;
  const height = globeViewportHeight;
  const pageScrolling = now < globePageScrollUntil && !state.dragging && !state.pinching;
  if (pageScrolling && now - globeLastScrollFrame < 52) {
    lastFrame = now;
    requestAnimationFrame(animateGlobe);
    return;
  }
  if (pageScrolling) globeLastScrollFrame = now;
  advanceGlobe(now);""",
    ),
    (
        """  window.addEventListener(\"scroll\", () => {
    if (!navigationFrame) navigationFrame = window.requestAnimationFrame(updateCurrentSection);
  }, { passive: true });""",
        """  window.addEventListener(\"scroll\", () => {
    globePageScrollUntil = performance.now() + 140;
    if (!navigationFrame) navigationFrame = window.requestAnimationFrame(updateCurrentSection);
  }, { passive: true });""",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"Expected source block not found: {old[:180]!r}")
    text = text.replace(old, new, 1)

path.write_text(text)
