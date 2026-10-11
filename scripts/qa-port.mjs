// Use the dynamic/private range, above Fetch's blocked service ports. Keeping
// port selection separate lets tests exhaust the range without starting a
// browser or weakening the platform's port-blocking policy.
export function randomQaHttpPort(random = Math.random) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError("QA port randomness must be in [0, 1).");
  }
  return 49152 + Math.floor(sample * 1000);
}
