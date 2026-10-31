import { secretClient } from "../server/optional-secret-client.js";

// Optional intake endpoint. No page links here. Nothing is stored unless
// SUPABASE_URL and SUPABASE_SECRET_KEY are both set.
const KINDS = new Set(["correction", "new_listing", "contact"]);
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 8000) return res.status(413).end();

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return res.status(403).end();
    } catch {
      return res.status(403).end();
    }
  }

  const client = secretClient();
  if (!client) return json(res, 503, { ok: false });

  if (!String(req.headers["content-type"] || "").includes("application/json")) {
    return res.status(415).end();
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { ok: false });
    }
  }
  body = body && typeof body === "object" ? body : {};
  if (body.website) return res.status(204).end();

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!KINDS.has(body.kind) || message.length < 5 || message.length > 5000) {
    return json(res, 400, { ok: false });
  }

  const email = typeof body.contactEmail === "string" && EMAIL.test(body.contactEmail)
    ? body.contactEmail.slice(0, 254)
    : null;
  const resourceId = typeof body.resourceId === "string" ? body.resourceId.slice(0, 200) : null;
  const environments = new Set(["production", "preview", "development"]);
  const { error } = await client.from("submissions").insert({
    kind: body.kind,
    resource_id: resourceId,
    message,
    contact_email: email,
    vercel_env: environments.has(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : null,
  });
  if (error) {
    console.error("submit insert failed:", error.code || "", error.message || "");
    return json(res, 500, { ok: false });
  }
  return json(res, 201, { ok: true });
}

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.end(JSON.stringify(body));
}
