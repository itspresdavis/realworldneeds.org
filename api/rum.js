import { readBody, RequestBodyError } from "../server/supabase.js";
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
  const parsed = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(max, parsed));
}

export default async function handler(req, res) {
  const end = status => { res.statusCode = status; res.setHeader("Cache-Control", "no-store, max-age=0"); return res.end(); };
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return end(405);
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0) return end(400);
  if (contentLength > 4096) return end(413);

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      const allowed = new Set(["realworldneeds.org", "www.realworldneeds.org", process.env.VERCEL_URL].filter(Boolean));
      const local = !process.env.VERCEL && /^127\.0\.0\.1:\d+$/.test(host) && parsed.protocol === "http:";
      if (parsed.origin !== origin || parsed.host !== host || (!local && (parsed.protocol !== "https:" || !allowed.has(host)))) return end(403);
    } catch {
      return end(403);
    }
  } else return end(403);
  if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") return end(415);
  let payload;
  try { payload = await readBody(req); }
  catch(error) { return end(error instanceof RequestBodyError ? error.status : 400); }
  if (Buffer.byteLength(JSON.stringify(payload)) > 4096) return end(413);

  if (!payload || typeof payload !== "object" || !ALLOWED_TYPES.has(payload.type)) {
    return end(400);
  }

  const route = ALLOWED_ROUTES.has(payload.route) ? payload.route : "other";
  const viewportClass = ALLOWED_VIEWPORTS.has(payload.viewportClass) ? payload.viewportClass : null;
  const event = {
    level: payload.type.includes("error") || payload.type.includes("lost") ? "warning" : "info",
    msg: "rwn_client_telemetry",
    schema: 3,
    type: payload.type,
    route,
    viewportClass,
    lcp: number(payload.lcp),
    layoutShiftTotal: number(payload.layoutShiftTotal, 10),
    maxEventDuration: number(payload.maxEventDuration),
    fcp: number(payload.fcp),
    ttfb: number(payload.ttfb),
    domReady: number(payload.domReady),
    longTasks: number(payload.longTasks, 10000),
    errorName: ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError", "AbortError", "NetworkError", "SecurityError"].includes(payload.errorName) ? payload.errorName : null
  };

  console.log(JSON.stringify(event));
  return end(204);
}
