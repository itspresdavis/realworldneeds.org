// Keep the text finder independent of the optional graphics engine. Reuse this
// exact canvas/context in Three; a successful feature probe alone is not a
// promise that later GPU allocation will succeed.
export async function loadGlobeEngine(canvas, load = () => Promise.all([
  import("/vendor/three.module.js"),
  import("../globe-points.js")
])) {
  let context;
  try {
    context = canvas?.getContext("webgl2", { antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  if (!context) return null;
  const [THREE, points] = await load();
  return { THREE, points, context };
}
