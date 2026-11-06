import {
  clientFor,
  json,
  readBody,
  RequestBodyError,
  requestOrigin,
  requireUser,
  sameOrigin,
} from "../server/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "Method not allowed." });
    }
    if (req.method === "POST" && !sameOrigin(req))
      return json(res, 403, {
        error: "Open this form on the RWN website and try again.",
      });
    const client = clientFor(req, res);
    const url = new URL(req.url, requestOrigin(req));
    if (req.method === "GET" && url.searchParams.get("action") === "callback") {
      const code = url.searchParams.get("code");
      const { error } = code
        ? await client.auth.exchangeCodeForSession(code)
        : { error: true };
      res.statusCode = 303;
      res.setHeader("Location", error ? "/join?notice=expired" : "/workspace");
      return res.end();
    }
    if (req.method === "GET") {
      const user = await requireUser(client, res);
      if (user && url.searchParams.get("action") === "export") {
        const { data: notes, error } = await client
          .from("rwn_reviews")
          .select("id,location_id,note,created_at")
          .eq("author_id", user.id)
          .order("created_at")
          .limit(10000);
        if (error)
          return json(res, 503, {
            error: "Your data could not be exported. Please try again.",
          });
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="rwn-contributor-data.json"',
        );
        return json(res, 200, {
          account: { email: user.email, id: user.id },
          notes,
          note: "Up to 10,000 notes. Contact the project administrator for larger exports.",
        });
      }
      if (user) json(res, 200, { user: { email: user.email, id: user.id } });
      return;
    }
    const { action, email, password } = await readBody(req);
    if (action === "delete-request") {
      const user = await requireUser(client, res);
      if (!user) return;
      const { error } = await client
        .from("rwn_account_requests")
        .insert({ user_id: user.id });
      if (error && error.code !== "23505")
        return json(res, 503, {
          error: "Your request was not saved. Please try again.",
        });
      return json(res, 200, {
        message:
          "Your account-deletion request is recorded for the project administrator. Your account remains active until it is processed.",
      });
    }
    if (action === "signout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      return json(
        res,
        error ? 503 : 200,
        error
          ? { error: "Sign out could not finish. Please try again." }
          : { ok: true },
      );
    }
    if (!["signin", "signup", "recover", "password"].includes(action))
      return json(res, 400, { error: "Unknown account action." });
    if (
      action !== "password" &&
      (typeof email !== "string" ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      return json(res, 400, { error: "Enter a valid email address." });
    if (
      action !== "recover" &&
      (typeof password !== "string" ||
        password.length > 128 ||
        password.length < (action === "signin" ? 1 : 12))
    )
      return json(res, 400, {
        error: "Use a password between 12 and 128 characters.",
      });
    const redirectTo = `${requestOrigin(req)}/api/account?action=callback`;
    let result;
    if (action === "signin")
      result = await client.auth.signInWithPassword({ email, password });
    if (action === "signup")
      result = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
    if (action === "recover")
      result = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (action === "password") {
      if (!(await requireUser(client, res))) return;
      result = await client.auth.updateUser({ password });
    }
    if (result.error)
      return json(res, result.error.status === 429 ? 429 : 400, {
        error:
          result.error.status === 429
            ? "Too many attempts. Please wait before trying again."
            : action === "signin"
              ? "Unable to sign in. Check your email, password, and email confirmation."
              : "Unable to complete this request. Please try again shortly.",
      });
    return json(res, 200, {
      ok: true,
      signedIn: Boolean(result.data?.session),
      message:
        action === "recover" || action === "signup"
          ? "Check your inbox for the next step. Open the link in this browser."
          : "Account updated.",
    });
  } catch (error) {
    if (error instanceof RequestBodyError)
      return json(res, error.status, { error: error.message });
    return json(res, 503, {
      error:
        "Account services are temporarily unavailable. Please try again. The public directory is still available.",
    });
  }
}
