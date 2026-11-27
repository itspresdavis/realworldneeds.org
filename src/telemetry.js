const ENDPOINT = "/api/rum";
const PERF_SAMPLE_RATE = 0.02;
const MAX_ERROR_REPORTS = 3;

let errorReports = 0;
let perfReported = false;
let lcp = null;
let layoutShiftTotal = null;
let maxEventDuration = null;
let longTasks = 0;

function randomSampled() {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 < PERF_SAMPLE_RATE;
  } catch {
    return Math.random() < PERF_SAMPLE_RATE;
  }
}

const sampled = randomSampled();

function cleanNumber(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

export function routeClass(pathname) {
  if (pathname === "/" || pathname === "") return "finder";
  if (/^\/service\//.test(pathname)) return "service";
  if (/^\/directory\/local\/[^/]+(?:\/[^/]+)?\/[^/]+\/help\//.test(pathname)) return "local_need_directory";
  if (/^\/directory\/local\//.test(pathname)) return "local_directory";
  if (/^\/directory\/help\//.test(pathname)) return "need_directory";
  if (/^\/directory\/region\//.test(pathname)) return "region_directory";
  if (pathname === "/directory" || /^\/directory\/page\//.test(pathname)) return "directory";
  if (/^\/directory\//.test(pathname)) return "country_directory";
  if (["/privacy", "/terms", "/accessibility", "/editorial-policy", "/transparency"].includes(pathname)) return "policy";
  return "other";
}

function viewportClass() {
  if (innerWidth < 600) return "small";
  if (innerWidth < 1024) return "medium";
  return "large";
}

function send(payload) {
  const body = JSON.stringify({
    schema: 3,
    route: routeClass(location.pathname),
    viewportClass: viewportClass(),
    ...payload
  });

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit"
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
    // These are coarse diagnostics, not standards-compliant CLS or INP.
    layoutShiftTotal: Number.isFinite(layoutShiftTotal) ? Number(layoutShiftTotal.toFixed(3)) : null,
    maxEventDuration: cleanNumber(maxEventDuration),
    fcp: cleanNumber(fcpEntry?.startTime),
    ttfb: cleanNumber(nav ? nav.responseStart - nav.requestStart : null),
    domReady: cleanNumber(nav?.domContentLoadedEventEnd),
    longTasks
  });
}

function observePerformance() {
  if (!sampled || !("PerformanceObserver" in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      if (perfReported || document.visibilityState === "hidden") return;
      for (const entry of list.getEntries()) lcp = Math.max(lcp || 0, entry.startTime);
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!perfReported && !entry.hadRecentInput) layoutShiftTotal = (layoutShiftTotal || 0) + entry.value;
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  } catch {}

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!perfReported) maxEventDuration = Math.max(maxEventDuration || 0, entry.duration || 0);
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

export function errorName(error) {
  const names = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError", "AbortError", "NetworkError", "SecurityError"];
  return names.includes(error?.name) ? error.name : "UnknownError";
}

function installErrorReporting() {
  window.addEventListener("error", (event) => {
    if (errorReports >= MAX_ERROR_REPORTS) return;
    errorReports += 1;
    send({
      type: "client_error",
      errorName: errorName(event.error)
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
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  // Background starts and BFCache restorations are excluded from this limited
  // diagnostic sample; they are not represented as fresh navigation measurements.
  if (document.visibilityState === "hidden") perfReported = true;
  else observePerformance();
  installErrorReporting();
  installGlobeDiagnostics();

  window.addEventListener("pagehide", reportPerformance, { once: true });
  window.addEventListener("pageshow", event => { if (event.persisted) perfReported = true; });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") reportPerformance();
  });
}
