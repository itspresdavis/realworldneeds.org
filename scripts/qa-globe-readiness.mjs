import { createHash } from "node:crypto";

// DOM insertion and renderer.render() returning do not establish that Chrome
// has composited the map. All setup shares one host deadline; slow page callbacks
// cannot extend it. The separate scroll/gesture budgets remain unchanged.
export async function waitForGlobePresentation({
  sample, prepare, capture, wait, now = () => performance.now(), timeoutMs = 12000
}) {
  const started = now();
  const checkpoints = [];
  let stage = "DOM readiness";
  const failure = () => {
    const error = new Error(`Mobile globe presentation was not ready within ${timeoutMs}ms (${stage}).`);
    error.globeReadiness = { timeoutMs, stage, durationMs: now() - started, checkpoints };
    return error;
  };
  const remaining = () => timeoutMs - (now() - started);
  const bounded = async (label, operation) => {
    stage = label;
    if (remaining() <= 0) throw failure();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(failure()), remaining()); })
      ]);
      // A delayed callback may return a true predicate after the deadline.
      if (remaining() <= 0) throw failure();
      return result;
    } finally { clearTimeout(timer); }
  };
  const until = async (label, predicate) => {
    while (true) {
      const snapshot = await bounded(label, sample);
      checkpoints.push({ elapsedMs: now() - started, ...snapshot });
      if (checkpoints.length > 100) checkpoints.shift();
      if (predicate(snapshot)) return snapshot;
      await bounded(label, () => wait(Math.min(50, remaining())));
    }
  };
  await until("DOM readiness", snapshot => snapshot.elementsReady === true);
  await bounded("map positioning", prepare);
  const snapshot = await until("render readiness", snapshot =>
    snapshot.startup === "ready" && snapshot.visible === true && snapshot.healthy === true
    && /[0-9]+(?:[.][0-9]+)?×/.test(snapshot.readout || ""));
  const captureStartedMs = now() - started;
  const shot = await bounded("composited map capture", capture);
  if (typeof shot?.data !== "string" || !shot.data.length) throw new Error("Composited map capture returned no image.");
  const image = Buffer.from(shot.data, "base64");
  if (!image.length) throw new Error("Composited map capture returned an empty image.");
  const captureSha256 = createHash("sha256").update(image).digest("hex");
  if (remaining() <= 0) throw failure();
  return {
    image, captureSha256,
    captureStartedMs, durationMs: now() - started, timeoutMs, snapshot, checkpoints
  };
}
