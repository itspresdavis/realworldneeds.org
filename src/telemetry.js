const ENDPOINT = "/api/rum";
const PERF_SAMPLE_RATE = 0.02;
const MAX_ERROR_REPORTS = 3;

let errorReports = 0;
let perfReported = false;
let lcp = 0;
let cls = 0;
let inp = 0;
let longTasks = 0;

function sessionSampled() {
  const key = "rwn-rum-sampled";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing !== null) return existing === "1";
    const sampled = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 < PERF_SAMPLE_RATE;
    sessionStorage.setItem(key, sampled ? "1" : "0");
    return sampled;
  } catch {
    return Math.random() < PERF_SAMPLE_RATE;
  }
}

const sampled = sessionSampled();

function cleanNumber(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function send(payload) {
  const body = JSON.stringify({
    schema: 1,
    path: location.pathname.slice(0, 160),
    viewport: `${Math.round(innerWidth)}x${Math.round(innerHeight)}`,
    ...payload
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin"
  }).catch(() => {});
}

function reportPerformance() {
  if (!sampled || perfReported) return;
  perfReported = true;

  const nav = performance.getEntriesByType("navigation")[0];
  const fcpEntry = performance.getEntriesByName("first-contentful-paint")[0];
  send({
    type: "performance",
    lcp: cleanNumber(lcp),
    cls: Number.isFinite(cls) ? Number(cls.toFixed(3)) : null,
    inp: cleanNumber(inp),
    fcp: cleanNumber(fcpEntry?.startTime),
    ttfb: cleanNumber(nav ? nav.responseStart - nav.requestStart : null),
    domReady: cleanNumber(nav?.domContentLoadedEventEnd),
    longTasks,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    connection: navigator.connection?.effectiveType || null
  });
}

function observePerformance() {
  if (!sampled || !("PerformanceObserver" in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  } catch {}

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) inp = Math.max(inp, entry.duration || 0);
    });
    observer.observe({ type: "event", buffered: true, durationThreshold: 40 });
  } catch {}

  try {
    const observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().length;
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {}
}

function errorName(error, fallback = "Error") {
  const name = typeof error?.name === "string" ? error.name : fallback;
  return name.replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 80) || fallback;
}

function installErrorReporting() {
  window.addEventListener("error", (event) => {
    if (errorReports >= MAX_ERROR_REPORTS) return;
    errorReports += 1;
    send({
      type: "client_error",
      errorName: errorName(event.error),
      file: String(event.filename || "").split("/").pop()?.slice(0, 80) || null,
      line: Number.isFinite(event.lineno) ? event.lineno : null,
      column: Number.isFinite(event.colno) ? event.colno : null
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (errorReports >= MAX_ERROR_REPORTS) return;
    errorReports += 1;
    send({ type: "unhandled_rejection", errorName: errorName(event.reason, "UnhandledRejection") });
  });
}

function installGlobeDiagnostics() {
  const canvas = document.getElementById("globeCanvas");
  if (!canvas) return;
  canvas.addEventListener("webglcontextlost", () => send({ type: "webgl_context_lost" }), { passive: true });
}

export function startTelemetry() {
  observePerformance();
  installErrorReporting();
  installGlobeDiagnostics();

  window.addEventListener("pagehide", reportPerformance, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") reportPerformance();
  });
}
