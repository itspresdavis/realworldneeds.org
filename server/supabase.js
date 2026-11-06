import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";

// This project uses a server-only auth client. Tokens never enter browser JS.
export const projectUrl =
  process.env.SUPABASE_URL || "https://cytfrxldixdapjaxcqzf.supabase.co";
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_QcjZr9DWdhMW42P8HK33mQ_cvu1S0ut";
const canonicalOrigin = "https://www.realworldneeds.org";
export function requestOrigin(req) {
  // Only the loopback development server may use an insecure origin. Forwarded
  // host/protocol headers are deliberately ignored: clients can supply them.
  if (!process.env.VERCEL && /^127\.0\.0\.1:\d+$/.test(req.headers.host || ""))
    return `http://${req.headers.host}`;
  const configured = new URL(process.env.SITE_URL || canonicalOrigin);
  if (
    configured.protocol !== "https:" ||
    configured.username ||
    configured.password ||
    configured.pathname !== "/" ||
    configured.search ||
    configured.hash
  )
    throw new Error("SITE_URL must be an HTTPS origin.");
  // An old apex SITE_URL must not send confirmation/recovery links away from
  // the hostname that owns the host-only authentication cookies.
  if (configured.origin === "https://realworldneeds.org")
    return canonicalOrigin;
  return configured.origin;
}
export function clientFor(req, res) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return createServerClient(projectUrl, publishableKey, {
    cookieOptions: {
      httpOnly: true,
      secure: requestOrigin(req).startsWith("https:"),
      sameSite: "lax",
      path: "/",
    },
    global: {
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(12000) }),
    },
    cookies: {
      getAll: () => cookies,
      setAll: (updates) => {
        const existing = res.getHeader("Set-Cookie") || [];
        res.setHeader("Set-Cookie", [
          ...(Array.isArray(existing) ? existing : [existing]),
          ...updates.map(({ name, value, options }) =>
            serializeCookieHeader(name, value, options),
          ),
        ]);
      },
    },
  });
}
export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}
export function sameOrigin(req) {
  const origin = requestOrigin(req);
  const contentType = req.headers["content-type"];
  return (
    req.headers.origin === origin &&
    req.headers.host === new URL(origin).host &&
    typeof contentType === "string" &&
    contentType.split(";")[0].trim().toLowerCase() === "application/json"
  );
}
export class RequestBodyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export async function readBody(req) {
  let bodyValue;
  try {
    // Vercel parses JSON lazily when req.body is read and reports malformed
    // JSON as ApiError(400). Keep that client error out of the generic 503 path.
    bodyValue = req.body;
  } catch (error) {
    if (error?.statusCode === 400 && error?.message === "Invalid JSON")
      throw new RequestBodyError(400, "Send a valid JSON object.");
    throw error;
  }
  let raw;
  if (bodyValue !== undefined) {
    raw = Buffer.isBuffer(bodyValue)
      ? bodyValue
      : Buffer.from(
          typeof bodyValue === "string" ? bodyValue : JSON.stringify(bodyValue),
        );
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 12000) throw new RequestBodyError(413, "Request too large.");
      chunks.push(bytes);
    }
    // Decode after joining chunks so a split UTF-8 character stays intact.
    raw = Buffer.concat(chunks);
  }
  if (raw.length > 12000) throw new RequestBodyError(413, "Request too large.");
  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    throw new RequestBodyError(400, "Send a valid JSON object.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new RequestBodyError(400, "Send a valid JSON object.");
  return body;
}
export async function requireUser(client, res) {
  const { data, error } = await client.auth.getUser();
  if (
    error ||
    !data.user ||
    data.user.is_anonymous ||
    !data.user.email_confirmed_at
  ) {
    json(res, 401, { error: "Please sign in to continue." });
    return null;
  }
  return data.user;
}
