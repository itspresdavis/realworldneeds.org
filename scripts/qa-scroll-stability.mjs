// QA precondition only: observe an unchanging scroll/viewport before taking
// input coordinates. Do not cancel momentum or change the page's scroll policy.
export async function waitForScrollStability({
  sample, wait, now = () => performance.now(), timeoutMs = 5000,
  quietMs = 250, minSamples = 4, tolerance = .5
}) {
  const started = now();
  let anchor;
  let stableSince = started;
  let consecutive = 0;
  const trace = [];
  const notSettled = () => {
    const error = new Error(`Page scroll/viewport did not settle within ${timeoutMs}ms before globe input.`);
    error.scrollStability = { timeoutMs, quietMs, minSamples, tolerance, trace };
    return error;
  };
  while (now() - started < timeoutMs) {
    let deadline;
    let position;
    try {
      position = await Promise.race([
        sample(),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(notSettled()), Math.max(1, timeoutMs - (now() - started)));
        })
      ]);
    } finally { clearTimeout(deadline); }
    const at = now();
    trace.push({ elapsedMs: at - started, ...position });
    if (trace.length > 100) trace.shift();
    const keys = Object.keys(position).filter(key => key !== "at");
    const valid = keys.length > 0 && keys.every(key => Number.isFinite(position[key]));
    const changed = !valid || !anchor || keys.some(key =>
      !Number.isFinite(anchor[key]) || Math.abs(position[key] - anchor[key]) > tolerance);
    if (changed) {
      anchor = valid ? position : null;
      stableSince = at;
      consecutive = valid ? 1 : 0;
    } else consecutive++;
    if (at - started >= timeoutMs) break;
    if (consecutive >= minSamples && at - stableSince >= quietMs) {
      return { position, durationMs: at - started, trace };
    }
    await wait(Math.min(50, Math.max(0, timeoutMs - (now() - started))));
  }
  throw notSettled();
}

// CropDigest passes fractional coordinates straight to CDP. Even a subpixel
// difference can alter a pixel hash, so this precondition uses exact equality.
export function sameCaptureGeometry(before, after) {
  const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a === b;
  return ["scrollX", "scrollY"].every(key => close(before[key], after[key]))
    && ["x", "y", "width", "height"].every(key => close(before.rect?.[key], after.rect?.[key]));
}
