import { readFile } from "node:fs/promises";
import { clientFor, requestOrigin } from "../server/supabase.js";

// The HTML itself is served only after remote verification of the auth cookie.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!["GET", "HEAD"].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end();
  }
  try {
    const client = clientFor(req, res);
    const { data, error } = await client.auth.getUser();
    if (
      error ||
      !data.user ||
      data.user.is_anonymous ||
      !data.user.email_confirmed_at
    ) {
      res.statusCode = 303;
      res.setHeader("Location", new URL("/join", requestOrigin(req)).pathname);
      return res.end();
    }
    const html = await readFile(
      new URL("../server/workspace.html", import.meta.url),
      "utf8",
    );
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(req.method === "HEAD" ? "" : html);
  } catch {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(
      '<!doctype html><html lang="en"><head><title>Workspace unavailable | RWN</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/contribute.css"><script type="module" src="/contributor-localization.js"></script></head><body data-page="workspace-unavailable"><main><h1>The workspace is temporarily unavailable.</h1><p>Please try again shortly.</p><a href="/directory">Browse the public directory</a></main></body></html>',
    );
  }
}
