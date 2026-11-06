import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import vm from "node:vm";
import account from "../api/account.js";
import catalog from "../api/catalog.js";
import workspace from "../api/workspace.js";
import {
  projectUrl,
  readBody,
  requestOrigin,
  sameOrigin,
} from "../server/supabase.js";

const origin = "https://www.realworldneeds.org";
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "fixture@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
};
const expiresAt = () => Math.floor(Date.now() / 1000) + 3600;
const session = () => ({
  access_token:
    [
      { alg: "HS256", typ: "JWT" },
      { sub: user.id, aud: "authenticated", exp: expiresAt() },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".") + ".fixture-signature",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expiresAt(),
  user,
});
const cookieName = `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
const cookie = () =>
  `${cookieName}=base64-${Buffer.from(JSON.stringify(session())).toString("base64url")}`;
const request = (body, overrides = {}) => ({
  method: "POST",
  url: "/api/account",
  headers: {
    host: "www.realworldneeds.org",
    origin,
    "content-type": "application/json",
  },
  body,
  ...overrides,
});
function response() {
  return {
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    getHeader(key) {
      return this.headers[key.toLowerCase()];
    },
    end(body) {
      this.body = body;
    },
  };
}
function environment(t, values = {}) {
  const saved = Object.fromEntries(
    ["SITE_URL", "VERCEL", ...Object.keys(values)].map((key) => [
      key,
      process.env[key],
    ]),
  );
  for (const key of Object.keys(saved)) delete process.env[key];
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
function fixture(t, options = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (options.reply) {
      const reply = options.reply(url, method, body);
      if (reply) return reply;
    }
    let data;
    if (url.pathname === "/auth/v1/user") data = options.user || user;
    else if (url.pathname === "/auth/v1/token") data = session();
    else if (url.pathname === "/auth/v1/signup") data = user;
    else if (url.pathname === "/auth/v1/recover") data = {};
    else if (url.pathname === "/auth/v1/logout")
      return new Response(null, { status: 204 });
    else if (url.pathname === "/rest/v1/rwn_members")
      data = options.role ? { role: options.role } : null;
    else if (
      url.pathname === "/rest/v1/rwn_account_requests" ||
      url.pathname === "/rest/v1/rwn_reviews"
    )
      data = [];
    else
      throw new Error(`Unexpected fixture request ${method} ${url.pathname}`);
    return Response.json(data);
  });
  return calls;
}
const authenticated = (body, overrides = {}) => {
  const req = request(body, overrides);
  req.headers = { ...req.headers, cookie: cookie() };
  return req;
};
const parsed = (res) => JSON.parse(res.body);

// These are SDK-level fixtures: they execute the actual handlers and Supabase
// client, but every outbound fetch is intercepted. No real users or mail.
test("configured origins normalize trailing slashes and the legacy apex without trusting forwarded hosts", (t) => {
  environment(t, { SITE_URL: "https://realworldneeds.org/", VERCEL: "1" });
  const req = request({ action: "signin" });
  assert.equal(requestOrigin(req), origin);
  assert.equal(sameOrigin(req), true);
  for (const changes of [
    { origin: "https://realworldneeds.org", host: "realworldneeds.org" },
    { host: "attacker.example", "x-forwarded-host": "www.realworldneeds.org" },
    {
      origin: "https://attacker.example",
      "x-forwarded-host": "attacker.example",
    },
    { origin: "null" },
    { origin: undefined },
    { "content-type": "text/plain" },
    { "content-type": undefined },
  ])
    assert.equal(
      sameOrigin({ ...req, headers: { ...req.headers, ...changes } }),
      false,
    );
  process.env.SITE_URL = `${origin}/`;
  assert.equal(sameOrigin(req), true);
  for (const invalid of [
    "http://www.realworldneeds.org",
    `${origin}/join`,
    `${origin}?next=bad`,
    "https://name:secret@www.realworldneeds.org",
    "not a URL",
  ]) {
    process.env.SITE_URL = invalid;
    assert.throws(() => requestOrigin(req));
  }
});

test("loopback development works locally and is disabled in Vercel", (t) => {
  environment(t);
  const req = request(
    {},
    {
      headers: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
  assert.equal(sameOrigin(req), true);
  process.env.VERCEL = "1";
  assert.equal(sameOrigin(req), false);
  assert.equal(requestOrigin(req), origin);
});

test("account and catalog reject unsupported methods and cross-origin writes before contacting authentication", async (t) => {
  environment(t);
  const calls = fixture(t);
  for (const handler of [account, catalog]) {
    const method = response();
    await handler(request({}, { method: "DELETE" }), method);
    assert.equal(method.statusCode, 405);
    assert.match(method.headers.allow, /GET, POST/);
    const foreign = response();
    await handler(
      request(
        {},
        {
          headers: {
            host: "www.realworldneeds.org",
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
        },
      ),
      foreign,
    );
    assert.equal(foreign.statusCode, 403);
    assert.match(foreign.headers["cache-control"], /no-store/);
  }
  assert.equal(calls.length, 0);
});

test("malformed, non-object and oversized JSON produce useful client errors", async (t) => {
  environment(t);
  const calls = fixture(t);
  for (const [body, status] of [
    ["{", 400],
    ["null", 400],
    [null, 400],
    ["[]", 400],
    ["1", 400],
    ["x".repeat(12001), 413],
  ]) {
    const res = response();
    await account(request(body), res);
    assert.equal(res.statusCode, status);
    assert.match(parsed(res).error, /JSON object|Request too large/);
  }
  assert.equal(calls.length, 0);
});

test("Vercel lazy JSON parser errors remain client errors without masking server failures", async (t) => {
  environment(t);
  const calls = fixture(t);
  for (const [error, status, message] of [
    [
      Object.assign(new Error("Invalid JSON"), { statusCode: 400 }),
      400,
      "Send a valid JSON object.",
    ],
    [
      Object.assign(new Error("Unexpected internal parser failure"), {
        statusCode: 500,
      }),
      503,
      "Account services are temporarily unavailable.",
    ],
    [
      Object.assign(new Error("Unexpected internal parser failure"), {
        statusCode: 400,
      }),
      503,
      "Account services are temporarily unavailable.",
    ],
    [
      new Error("Unknown body accessor failure"),
      503,
      "Account services are temporarily unavailable.",
    ],
  ]) {
    const req = request(undefined);
    let reads = 0;
    Object.defineProperty(req, "body", {
      get() {
        reads += 1;
        throw error;
      },
    });
    const res = response();
    await account(req, res);
    assert.equal(res.statusCode, status);
    assert.ok(parsed(res).error.startsWith(message));
    assert.equal(reads, 1);
    assert.match(res.headers["cache-control"], /private, no-store/);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.doesNotMatch(res.body, /Unexpected internal|Unknown body accessor/);
  }
  assert.equal(calls.length, 0);
});

test("a valid lazy request body is evaluated once", async (t) => {
  environment(t);
  const calls = fixture(t);
  const req = request(undefined);
  let reads = 0;
  Object.defineProperty(req, "body", {
    get() {
      reads += 1;
      return { action: "__fixture_unknown_action__" };
    },
  });
  const res = response();
  await account(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(parsed(res).error, "Unknown account action.");
  assert.equal(reads, 1);
  assert.equal(calls.length, 0);
});

test("origin and method rejection precede lazy body parsing", async (t) => {
  environment(t);
  const calls = fixture(t);
  for (const [method, requestOrigin, status] of [
    ["POST", "https://foreign.example.invalid", 403],
    ["PUT", origin, 405],
  ]) {
    const req = request(undefined, { method });
    req.headers.origin = requestOrigin;
    Object.defineProperty(req, "body", {
      get() {
        assert.fail(
          "Rejected requests must not invoke the platform body parser.",
        );
      },
    });
    const res = response();
    await account(req, res);
    assert.equal(res.statusCode, status);
  }
  assert.equal(calls.length, 0);
});

test("request parsing preserves a multibyte character split across stream chunks and enforces byte limits", async () => {
  const bytes = Buffer.from('{"note":"México"}');
  const split = bytes.indexOf(Buffer.from("é")) + 1;
  assert.deepEqual(
    await readBody(
      Readable.from([bytes.subarray(0, split), bytes.subarray(split)]),
    ),
    { note: "México" },
  );
  assert.deepEqual(await readBody({ body: bytes }), { note: "México" });
  await assert.rejects(
    readBody(Readable.from([Buffer.alloc(11999), Buffer.alloc(2)])),
    { status: 413 },
  );
});

test("sign-in uses secure host-only HttpOnly session cookies and does not expose tokens in JSON", async (t) => {
  environment(t);
  const calls = fixture(t);
  const res = response();
  await account(
    request({
      action: "signin",
      email: user.email,
      password: "fixture-password",
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(parsed(res).signedIn, true);
  assert.doesNotMatch(res.body, /access_token|refresh_token|fixture-signature/);
  const cookies = res.headers["set-cookie"];
  assert.ok(cookies.length);
  for (const value of cookies) {
    assert.match(value, /HttpOnly/);
    assert.match(value, /Secure/);
    assert.match(value, /SameSite=Lax/);
    assert.match(value, /Path=\//);
    assert.doesNotMatch(value, /Domain=/);
  }
  assert.equal(calls[0].url.searchParams.get("grant_type"), "password");
});

test("sign-up and recovery use the canonical callback with PKCE while keeping email delivery simulated", async (t) => {
  environment(t, { SITE_URL: "https://realworldneeds.org/" });
  const calls = fixture(t);
  for (const action of ["signup", "recover"]) {
    const res = response();
    await account(
      request({ action, email: user.email, password: "fixture-password" }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(parsed(res).signedIn, false);
    const call = calls.at(-1);
    assert.equal(
      call.url.searchParams.get("redirect_to"),
      `${origin}/api/account?action=callback`,
    );
    assert.equal(call.body.code_challenge_method, "s256");
    assert.ok(call.body.code_challenge);
    assert.ok(
      res.headers["set-cookie"].some((value) =>
        value.startsWith(`${cookieName}-code-verifier=`),
      ),
    );
  }
});

test("callback exchanges only a PKCE code and ignores an attacker-supplied next URL", async (t) => {
  environment(t);
  const calls = fixture(t);
  const res = response();
  await account(
    request(undefined, {
      method: "GET",
      url: "/api/account?action=callback&code=fixture-code&next=https://attacker.example",
      headers: {
        host: "www.realworldneeds.org",
        cookie: `${cookieName}-code-verifier=base64-${Buffer.from(JSON.stringify("fixture-verifier")).toString("base64url")}`,
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/workspace");
  const call = calls.find((call) => call.url.pathname === "/auth/v1/token");
  assert.equal(call.url.searchParams.get("grant_type"), "pkce");
  assert.equal(call.body.auth_code, "fixture-code");
  assert.equal(call.body.code_verifier, "fixture-verifier");
  assert.match(res.headers["cache-control"], /no-store/);
});

test("sign-out clears session cookies and revokes the local session", async (t) => {
  environment(t);
  const calls = fixture(t);
  const res = response();
  await account(authenticated({ action: "signout" }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(
    calls.some(
      (call) =>
        call.url.pathname === "/auth/v1/logout" &&
        call.url.searchParams.get("scope") === "local",
    ),
  );
  assert.ok(
    res.headers["set-cookie"].some((value) => value.includes("Max-Age=0")),
  );
});

test("password updates and deletion requests require verified identity and bind writes to that identity", async (t) => {
  environment(t);
  const calls = fixture(t);
  for (const action of ["password", "delete-request"]) {
    const anonymous = response();
    await account(request({ action, password: "fixture-password" }), anonymous);
    assert.equal(anonymous.statusCode, 401);
    const signedIn = response();
    await account(
      authenticated({
        action,
        password: "fixture-password",
        user_id: "forged-user",
      }),
      signedIn,
    );
    assert.equal(signedIn.statusCode, 200);
  }
  assert.deepEqual(
    calls.find((call) => call.url.pathname === "/rest/v1/rwn_account_requests")
      .body,
    { user_id: user.id },
  );
  assert.ok(
    calls.some(
      (call) => call.url.pathname === "/auth/v1/user" && call.method === "PUT",
    ),
  );
});

test("anonymous catalog access is denied and contributor metadata cannot grant editor access", async (t) => {
  environment(t);
  const calls = fixture(t, {
    user: { ...user, user_metadata: { role: "admin" } },
  });
  const anonymous = response();
  await catalog(request({}, { method: "GET", url: "/api/catalog" }), anonymous);
  assert.equal(anonymous.statusCode, 401);
  const forged = response();
  await catalog(
    authenticated(
      { id: "fixture", role: "admin" },
      { method: "PATCH", url: "/api/catalog" },
    ),
    forged,
  );
  assert.equal(forged.statusCode, 403);
  assert.equal(
    calls.filter((call) => call.url.pathname === "/rest/v1/rwn_locations")
      .length,
    0,
  );
});

test("editor updates use membership and optimistic concurrency with a synthetic listing", async (t) => {
  environment(t);
  const updatedAt = "2026-01-01T00:00:00.000Z";
  const record = {
    id: "fixture-listing",
    kind: "direct",
    lat: 42,
    lng: -71,
    name: "Synthetic test fixture",
  };
  const calls = fixture(t, {
    role: "editor",
    reply(url, method, body) {
      if (url.pathname !== "/rest/v1/rwn_locations") return;
      if (method === "PATCH")
        return Response.json({
          id: record.id,
          record: body.record,
          published: body.published,
          updated_at: "2026-01-02T00:00:00.000Z",
        });
      return Response.json({ record, updated_at: updatedAt });
    },
  });
  const body = {
    id: record.id,
    updatedAt,
    reason: "Synthetic test fixture only.",
    published: true,
    changes: { name: "Synthetic edited fixture" },
  };
  const res = response();
  await catalog(
    authenticated(body, { method: "PATCH", url: "/api/catalog" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const write = calls.find((call) => call.method === "PATCH");
  assert.equal(write.url.searchParams.get("id"), `eq.${record.id}`);
  assert.equal(write.url.searchParams.get("updated_at"), `eq.${updatedAt}`);
  assert.equal(write.body.record.name, body.changes.name);
  const stale = response();
  await catalog(
    authenticated(
      { ...body, updatedAt: "2025-01-01T00:00:00.000Z" },
      { method: "PATCH", url: "/api/catalog" },
    ),
    stale,
  );
  assert.equal(stale.statusCode, 409);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
});

test("private workspace denies missing and unverified sessions and serves no cacheable private HTML", async (t) => {
  environment(t);
  const calls = fixture(t, { user: { ...user, email_confirmed_at: null } });
  for (const req of [
    request(undefined, { method: "GET", url: "/workspace" }),
    authenticated(undefined, { method: "GET", url: "/workspace" }),
  ]) {
    const res = response();
    await workspace(req, res);
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, "/join");
    assert.match(res.headers["cache-control"], /private, no-store/);
    assert.equal(res.headers.vary, "Cookie");
    assert.ok(!res.body);
  }
  assert.equal(calls.length, 1);
});

test("upstream failures do not reveal provider errors or fixture tokens and preserve rate limits", async (t) => {
  environment(t);
  fixture(t, {
    reply: () =>
      Response.json(
        { msg: "sensitive fixture provider error", code: "fixture_error" },
        { status: 429 },
      ),
  });
  const res = response();
  await account(
    request({
      action: "signin",
      email: user.email,
      password: "fixture-password",
    }),
    res,
  );
  assert.equal(res.statusCode, 429);
  assert.match(parsed(res).error, /Too many attempts/);
  assert.doesNotMatch(res.body, /sensitive|fixture-password|fixture_error/);
});

test("deployment canonicalizes only the apex hostname and keeps live release metadata out of shared caches", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  const protectedPaths = [
    "/join",
    "/workspace",
    "/api/account",
    "/api/catalog",
    "/api/workspace",
  ];
  assert.deepEqual(
    config.redirects,
    protectedPaths.map((path) => ({
      source: path,
      has: [{ type: "host", value: "realworldneeds.org" }],
      destination: `${origin}${path}`,
      permanent: true,
    })),
  );
  // Public apex pages retain access to the user's existing origin-scoped
  // Saved IDs and offline caches until an explicit transfer path is shipped.
  assert.ok(
    !config.redirects.some((rule) =>
      ["/:path*", "/", "/saved", "/directory"].includes(rule.source),
    ),
  );
  assert.equal(config.ignoreCommand, undefined);
  const broad = config.headers.findIndex(
    (rule) => rule.source === "/(media|data|vendor)/(.*)",
  );
  const release = config.headers.findIndex(
    (rule) => rule.source === "/data/release.json",
  );
  assert.ok(
    release > broad,
    "the release exception must override broad data caching",
  );
  const headers = Object.fromEntries(
    config.headers[release].headers.map(({ key, value }) => [
      key.toLowerCase(),
      value,
    ]),
  );
  assert.equal(headers["cache-control"], "no-store, max-age=0");
  assert.equal(headers["vercel-cdn-cache-control"], "no-store");
});

test("service worker leaves account, workspace and release probes outside offline caches", async () => {
  const handlers = new Map();
  const forbidden = () =>
    assert.fail("Private/probe requests must pass directly to the network");
  vm.runInNewContext(await readFile("public/sw.js", "utf8"), {
    URL,
    Request,
    Response,
    caches: { open: forbidden },
    fetch: forbidden,
    self: {
      location: { origin },
      addEventListener(name, callback) {
        handlers.set(name, callback);
      },
    },
  });
  for (const path of [
    "/api/account",
    "/api/catalog",
    "/api/workspace",
    "/workspace",
    "/join",
    "/data/release.json",
  ]) {
    handlers.get("fetch")({
      request: new Request(`${origin}${path}`),
      respondWith: forbidden,
    });
  }
});
