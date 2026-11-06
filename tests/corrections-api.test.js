import test from "node:test";
import assert from "node:assert/strict";
import corrections from "../api/corrections.js";
import review from "../api/correction-review.js";
import {
  correctionConfig,
  correctionActor,
  validateCorrection,
  validateDecision,
} from "../server/corrections.js";
import { CORRECTION_CATEGORIES } from "../public/correction-contract.js";
import { projectUrl } from "../server/supabase.js";

const origin = "https://www.realworldneeds.org";
const submissionId = "cb2579c2-e9b0-4e9b-8469-dac86b54f2ec";
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "test@example.invalid",
  email_confirmed_at: "2026-01-01",
  is_anonymous: false,
};
const token = "synthetic-test-capability-never-configured-remotely-123456";
const body = () => ({
  resourceId: "bowery-mission",
  category: "wrong-address",
  note: "The official intake page lists another entrance.",
  submissionId,
});
function env(t, enabled = true) {
  const keys = [
    "RWN_CORRECTIONS_ENABLED",
    "RWN_CORRECTIONS_INGEST_TOKEN",
    "RWN_CORRECTIONS_APPROVAL_REF",
    "SITE_URL",
    "VERCEL",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  if (enabled)
    Object.assign(process.env, {
      RWN_CORRECTIONS_ENABLED: "true",
      RWN_CORRECTIONS_INGEST_TOKEN: token,
      RWN_CORRECTIONS_APPROVAL_REF: "fixture-approval-only",
    });
  t.after(() => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
}
function req(payload, method = "POST", url = "/api/corrections") {
  return {
    body: payload,
    method,
    url,
    headers: {
      host: "www.realworldneeds.org",
      origin,
      "content-type": "application/json",
    },
    socket: { remoteAddress: "192.0.2.10" },
  };
}
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[k.toLowerCase()];
    },
    end(body) {
      this.body = body;
    },
  };
}
const parsed = (r) => JSON.parse(r.body);
function authRequest(payload, method = "GET", url = "/api/correction-review") {
  const request = req(payload, method, url),
    expires = Math.floor(Date.now() / 1000) + 3600;
  const access =
    [
      { alg: "HS256", typ: "JWT" },
      { sub: user.id, exp: expires },
    ]
      .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
      .join(".") + ".fixture-signature";
  const session = {
    access_token: access,
    refresh_token: "fixture-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  request.headers.cookie = `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return request;
}
function mock(t, reply = () => Response.json({ accepted: true })) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const payload = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, payload, headers: init.headers });
    if (url.pathname === "/auth/v1/user") return Response.json(user);
    return reply(url, payload, init);
  });
  return calls;
}

test("corrections are disabled by default without a backend request or receipt", async (t) => {
  env(t, false);
  const calls = mock(t);
  assert.equal(correctionConfig(), null);
  const get = response();
  await corrections(req(undefined, "GET"), get);
  assert.deepEqual(parsed(get), { enabled: false });
  const post = response();
  await corrections(req(body()), post);
  assert.equal(post.statusCode, 503);
  assert.doesNotMatch(post.body, /was saved/);
  assert.equal(calls.length, 0);
  assert.match(post.headers["cache-control"], /private, no-store/);
});

test("enabled state requires matching database readiness, not only the environment switch", async (t) => {
  env(t);
  let result = false;
  mock(t, () => Response.json(result));
  for (const enabled of [false, true]) {
    result = enabled;
    const res = response();
    await corrections(req(undefined, "GET"), res);
    assert.deepEqual(parsed(res), { enabled });
  }
});

test("public intake validates scope, bodies and methods before attempting storage", async (t) => {
  env(t);
  const calls = mock(t);
  for (const [payload, status] of [
    ["{", 400],
    [{ ...body(), category: "other" }, 400],
    [{ ...body(), resourceId: "not-a-listing" }, 400],
    [{ ...body(), email: "person@example.invalid" }, 400],
    [{ ...body(), website: "https://bot.invalid" }, 400],
    [{ ...body(), note: "x".repeat(1001) }, 400],
    ["x".repeat(12001), 413],
  ]) {
    const res = response();
    await corrections(req(payload), res);
    assert.equal(res.statusCode, status);
  }
  const cross = req(body());
  cross.headers.origin = "https://foreign.invalid";
  const res = response();
  await corrections(cross, res);
  assert.equal(res.statusCode, 403);
  const getReport = response();
  await corrections(req(body(), "PATCH"), getReport);
  assert.equal(getReport.statusCode, 405);
  assert.equal(calls.length, 0);
  assert.equal(CORRECTION_CATEGORIES.length, 8);
  for (const category of CORRECTION_CATEGORIES)
    assert.equal(
      validateCorrection({ ...body(), category: category.value }),
      null,
    );
});

test("public success requires committed acceptance, with a scoped capability and no raw client address", async (t) => {
  env(t);
  const calls = mock(t);
  const res = response();
  await corrections(req(body()), res);
  assert.equal(res.statusCode, 201);
  assert.equal(parsed(res).ok, true);
  assert.equal(parsed(res).id, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/rest/v1/rpc/rwn_submit_correction");
  assert.equal(calls[0].payload.p_resource_id, "bowery-mission");
  assert.match(calls[0].payload.p_actor, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(
    JSON.stringify(calls[0].payload),
    /192\.0\.2\.10|synthetic-test-capability/,
  );
  assert.equal(
    new Headers(calls[0].headers).get("x-rwn-correction-key"),
    token,
  );
  assert.doesNotMatch(
    res.body,
    /p_actor|submissionId|synthetic-test-capability/,
  );
});

test("unavailable storage, malformed success and quota failures never produce a receipt", async (t) => {
  env(t);
  let upstream;
  mock(t, () => upstream);
  for (const [reply, status] of [
    [
      Response.json(
        { code: "PT429", message: "private detail" },
        { status: 429 },
      ),
      429,
    ],
    [
      Response.json(
        { code: "PT503", message: "private detail" },
        { status: 503 },
      ),
      503,
    ],
    [Response.json({ accepted: false }), 503],
    [Response.json({}), 503],
  ]) {
    upstream = reply;
    const res = response();
    await corrections(req(body()), res);
    assert.equal(res.statusCode, status);
    assert.equal(parsed(res).ok, undefined);
    assert.doesNotMatch(res.body, /private detail/);
    if (status === 429) assert.equal(res.headers["retry-after"], "3600");
  }
});

test("actor rate keys ignore spoofable headers, rotate daily and fail closed without trusted client identity", (t) => {
  env(t);
  const request = req(body());
  request.headers["x-forwarded-for"] = "203.0.113.9";
  const a = correctionActor(request, token, "2026-11-06");
  request.headers["x-forwarded-for"] = "203.0.113.10";
  assert.equal(correctionActor(request, token, "2026-11-06"), a);
  assert.notEqual(correctionActor(request, token, "2026-11-07"), a);
  process.env.VERCEL = "1";
  assert.equal(correctionActor(request, token), null);
  request.headers["x-vercel-forwarded-for"] = "192.0.2.10,203.0.113.9";
  assert.equal(correctionActor(request, token), null);
  request.headers["x-vercel-forwarded-for"] = "192.0.2.10";
  assert.equal(correctionActor(request, token, "2026-11-06"), a);
});

test("review queue denies anonymous callers and delegates editor authorization to user-scoped database RPC", async (t) => {
  env(t);
  const calls = mock(t, () =>
    Response.json(
      { code: "42501", message: "private permission detail" },
      { status: 403 },
    ),
  );
  const anon = response();
  await review(req(undefined, "GET", "/api/correction-review"), anon);
  assert.equal(anon.statusCode, 401);
  const contributor = response();
  await review(authRequest(), contributor);
  assert.equal(contributor.statusCode, 403);
  assert.doesNotMatch(contributor.body, /private permission/);
  assert.equal(calls.at(-1).url.pathname, "/rest/v1/rpc/rwn_correction_queue");
  assert.equal(
    new Headers(calls.at(-1).headers).get("x-rwn-correction-key"),
    null,
  );
});

test("review decisions require source evidence, revision and explicit bounded fields", async (t) => {
  env(t);
  const decision = {
    id: submissionId,
    revision: 1,
    status: "ready",
    priority: "urgent",
    assignment: "self",
    reason: "Official source confirms the changed intake.",
    evidenceUrl: "https://example.org/intake",
  };
  assert.equal(validateDecision(decision), null);
  for (const changes of [
    { evidenceUrl: "" },
    { evidenceUrl: "javascript:alert(1)" },
    { evidenceUrl: "https://user:pass@example.org" },
    { reason: "short" },
    { revision: 0 },
    { status: "published" },
    { assignedTo: user.id },
  ])
    assert.ok(validateDecision({ ...decision, ...changes }));
  const calls = mock(t, () =>
    Response.json({
      report: { id: submissionId, status: "ready", revision: 2 },
    }),
  );
  const res = response();
  await review(authRequest(decision, "PATCH"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(parsed(res).report.status, "ready");
  assert.equal(calls.at(-1).url.pathname, "/rest/v1/rpc/rwn_decide_correction");
  assert.equal(
    calls.filter((c) => /rwn_locations/.test(c.url.pathname)).length,
    0,
  );
});
