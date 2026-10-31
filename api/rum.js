import { secretClient } from "../server/optional-secret-client.js"

const ALLOWED_TYPES = new Set([
  "performance",
  "client_error",
  "unhandled_rejection",
  "webgl_context_lost"
]);

const ALLOWED_ROUTES = new Set([
  "finder",
  "service",
  "local_need_directory",
  "local_directory",
  "need_directory",
  "region_directory",
  "directory",
  "country_directory",
  "policy",
  "other"
]);

const ALLOWED_VIEWPORTS = new Set(["small", "medium", "large"]);

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

  const route = ALLOWED_ROUTES.has(payload.route) ? payload.route : "other";
  const viewportClass = ALLOWED_VIEWPORTS.has(payload.viewportClass) ? payload.viewportClass : null;
  const event = {
    level: payload.type.includes("error") || payload.type.includes("lost") ? "warning" : "info",
    msg: "rwn_client_telemetry",
    schema: number(payload.schema, 10),
    type: payload.type,
    route,
    viewportClass,
    lcp: number(payload.lcp),
    cls: number(payload.cls, 10),
    inp: number(payload.inp),
    fcp: number(payload.fcp),
    ttfb: number(payload.ttfb),
    domReady: number(payload.domReady),
    longTasks: number(payload.longTasks, 10000),
    errorName: text(payload.errorName, 80),
    file: text(payload.file, 80),
    line: number(payload.line, 1000000),
    column: number(payload.column, 1000000)
  };

  console.log(JSON.stringify(event));
  res.setHeader("Cache-Control", "no-store, max-age=0");
  let client = null;
  try {
    client = secretClient();
  } catch {
    client = null;
  }
  if (!client) return res.status(204).end();

  return client.from("rum_events").insert(telemetryRow(event)).then(({ error }) => {
    if (error) console.error("rum insert failed:", error.code || "", error.message || "");
    return res.status(204).end();
  }, (error) => {
    console.error("rum insert failed:", "", error?.message || "");
    return res.status(204).end();
  });
}

function telemetryRow(event) {
  const environments = new Set(["production", "preview", "development"]);
  return {
    schema_version: integer(event.schema, 10) ?? 2,
    event_type: event.type,
    route: event.route,
    viewport_class: event.viewportClass,
    lcp_ms: integer(event.lcp, 120000),
    inp_ms: integer(event.inp, 120000),
    fcp_ms: integer(event.fcp, 120000),
    ttfb_ms: integer(event.ttfb, 120000),
    dom_ready_ms: integer(event.domReady, 120000),
    long_tasks: integer(event.longTasks, 10000),
    cls: event.cls,
    error_name: event.errorName,
    error_file: event.file,
    error_line: integer(event.line, 1000000),
    error_column: integer(event.column, 1000000),
    release: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || null,
    vercel_env: environments.has(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : null
  };
}

function integer(value, max) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(max, Math.round(value)));
}
