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
export function requestOrigin(req) {
  if (!process.env.VERCEL && /^127\.0\.0\.1:\d+$/.test(req.headers.host || ""))
    return `http://${req.headers.host}`;
  return process.env.SITE_URL || "https://www.realworldneeds.org";
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
  return (
    req.headers.origin === requestOrigin(req) &&
    req.headers["content-type"]?.split(";")[0] === "application/json"
  );
}
export async function readBody(req) {
  if (req.body) {
    const raw =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > 12000) throw new Error("Request too large");
    return JSON.parse(raw);
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 12000) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}");
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
