import { createHash } from "node:crypto";

// DOM insertion and renderer.render() returning do not establish that Chrome
// has composited the map. Runtime readiness has one strict host deadline.
// Screenshot acquisition is separate evidence work; it cannot extend runtime
// readiness. The scroll/gesture budgets remain unchanged.
export async function waitForGlobePresentation({
  sample, prepare, capture, wait, now = () => performance.now(), timeoutMs = 12000,
  captureTimeoutMs = 30000
}) {
  const started = now();
  const checkpoints = [];
  let stage = "DOM readiness";
  let phase = "runtime", phaseStarted = started, phaseTimeoutMs = timeoutMs;
  let runtimeDurationMs = null;
  const failure = () => {
    const error = new Error(`Mobile globe ${phase} phase exceeded ${phaseTimeoutMs}ms (${stage}).`);
    error.globeReadiness = {
      phase, timeoutMs: phaseTimeoutMs, runtimeTimeoutMs: timeoutMs, captureTimeoutMs, stage,
      runtimeDurationMs: runtimeDurationMs ?? now() - started,
      captureStartedMs: phase === "capture" ? runtimeDurationMs : null,
      captureDurationMs: phase === "capture" ? now() - phaseStarted : null,
      durationMs: now() - started, checkpoints
    };
    return error;
  };
  const remaining = () => phaseTimeoutMs - (now() - phaseStarted);
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
  if (remaining() <= 0) throw failure();
  const runtimeFinished = now();
  runtimeDurationMs = runtimeFinished - started;
  if (runtimeDurationMs >= timeoutMs) throw failure();
  phaseStarted = runtimeFinished;
  const captureStartedMs = runtimeDurationMs;
  phase = "capture";
  phaseTimeoutMs = captureTimeoutMs;
  const shot = await bounded("composited map capture", capture);
  if (typeof shot?.data !== "string" || !shot.data.length) throw new Error("Composited map capture returned no image.");
  const image = Buffer.from(shot.data, "base64");
  if (!image.length) throw new Error("Composited map capture returned an empty image.");
  const captureSha256 = createHash("sha256").update(image).digest("hex");
  if (remaining() <= 0) throw failure();
  return {
    image, captureSha256,
    runtimeDurationMs, captureStartedMs, captureDurationMs: now() - phaseStarted,
    durationMs: now() - started, timeoutMs, runtimeTimeoutMs: timeoutMs, captureTimeoutMs, snapshot, checkpoints
  };
}
