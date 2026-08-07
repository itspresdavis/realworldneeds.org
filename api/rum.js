const ALLOWED_TYPES = new Set([
  "performance",
  "client_error",
  "unhandled_rejection",
  "webgl_context_lost"
]);

function number(value, max = 120000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(max, parsed));
}

function text(value, max = 160) {
  if (typeof value !== "string") return null;
  return value.replace(/[\r\n\t]/g, " ").slice(0, max);
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 4096) return res.status(413).end();

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return res.status(403).end();
    } catch {
      return res.status(403).end();
    }
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return res.status(400).end();
    }
  }

  if (!payload || typeof payload !== "object" || !ALLOWED_TYPES.has(payload.type)) {
    return res.status(400).end();
  }

  const event = {
    level: payload.type.includes("error") || payload.type.includes("lost") ? "warning" : "info",
    msg: "rwn_client_telemetry",
    type: payload.type,
    path: text(payload.path),
    viewport: text(payload.viewport, 32),
    requestId: text(req.headers["x-vercel-id"], 120),
    lcp: number(payload.lcp),
    cls: number(payload.cls, 10),
    inp: number(payload.inp),
    fcp: number(payload.fcp),
    ttfb: number(payload.ttfb),
    domReady: number(payload.domReady),
    longTasks: number(payload.longTasks, 10000),
    reducedMotion: typeof payload.reducedMotion === "boolean" ? payload.reducedMotion : null,
    connection: text(payload.connection, 24),
    errorName: text(payload.errorName, 80),
    file: text(payload.file, 80),
    line: number(payload.line, 1000000),
    column: number(payload.column, 1000000)
  };

  console.log(JSON.stringify(event));
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(204).end();
}
