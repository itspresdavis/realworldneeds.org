import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import rumHandler from "../api/rum.js";
import submitHandler from "../api/submit.js";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA"];

function saveEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function clearPersistenceEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    }
  };
}

const sample = {
  schema: 2,
  type: "performance",
  route: "finder",
  viewportClass: "large",
  lcp: 120.4,
  cls: 0.012,
  inp: 8,
  fcp: 40,
  ttfb: 20,
  domReady: 80,
  longTasks: 1
};

test("unconfigured /api/rum keeps the current response and does not call Supabase", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  let fetches = 0;
  clearPersistenceEnv();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-must-not-activate";
  console.log = (...args) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch should not run");
  };
  try {
    const res = mockRes();
    const pending = rumHandler({
      method: "POST",
      headers: { host: "www.realworldneeds.org", origin: "https://www.realworldneeds.org", "content-length": "120" },
      body: sample
    }, res);
    assert.equal(pending instanceof Promise, false);
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["cache-control"], "no-store, max-age=0");
    assert.equal(fetches, 0);
    const event = JSON.parse(logs[0]);
    assert.equal(event.msg, "rwn_client_telemetry");
    assert.equal(event.type, "performance");
    assert.equal(event.route, "finder");
    assert.equal(event.viewportClass, "large");
    assert.equal(event.lcp, 120.4);
    assert.equal("ip" in event, false);
    assert.equal("userAgent" in event, false);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("unconfigured /api/rum preserves rejection statuses", async () => {
  const saved = saveEnv();
  clearPersistenceEnv();
  try {
    const wrongMethod = mockRes();
    rumHandler({ method: "GET", headers: {} }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, "POST");

    const crossOrigin = mockRes();
    rumHandler({
      method: "POST",
      headers: { host: "www.realworldneeds.org", origin: "https://example.com", "content-length": "20" },
      body: sample
    }, crossOrigin);
    assert.equal(crossOrigin.statusCode, 403);

    const tooLarge = mockRes();
    rumHandler({ method: "POST", headers: { "content-length": "4097" }, body: sample }, tooLarge);
    assert.equal(tooLarge.statusCode, 413);

    const badType = mockRes();
    rumHandler({ method: "POST", headers: { "content-length": "40" }, body: { type: "click", schema: 2 } }, badType);
    assert.equal(badType.statusCode, 400);
  } finally {
    restoreEnv(saved);
  }
});

test("configured /api/rum inserts the coarse row and still returns 204", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const calls = [];
  clearPersistenceEnv();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_only";
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
  console.log = () => {};
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify([{ id: 1 }]), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const res = mockRes();
    await rumHandler({
      method: "POST",
      headers: { host: "preview.example", origin: "https://preview.example", "content-length": "180" },
      body: { ...sample, path: "/service/private-id", viewport: "1440x900" }
    }, res);
    assert.equal(res.statusCode, 204);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/example\.supabase\.co\/rest\/v1\/rum_events/);
    assert.equal(calls[0].init.headers.get("apikey"), "sb_secret_test_only");
    const row = JSON.parse(calls[0].init.body);
    assert.equal(row.event_type, "performance");
    assert.equal(row.route, "finder");
    assert.equal(row.viewport_class, "large");
    assert.equal(row.lcp_ms, 120);
    assert.equal(row.schema_version, 2);
    assert.equal(row.release, "abcdef123456");
    assert.equal(row.vercel_env, "preview");
    assert.equal("path" in row, false);
    assert.equal("viewport" in row, false);
    assert.equal("ip" in row, false);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("unconfigured /api/submit stores nothing", async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  clearPersistenceEnv();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch should not run");
  };
  try {
    const res = mockRes();
    await submitHandler({
      method: "POST",
      headers: { host: "www.realworldneeds.org", "content-type": "application/json", "content-length": "80" },
      body: { kind: "contact", message: "A real message", contactEmail: "person@example.com" }
    }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { ok: false });
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("telemetry source does not record visitor identifiers", async () => {
  const server = await readFile("api/rum.js", "utf8");
  const migration = await readFile("supabase/migrations/20261020000000_rum_and_submissions.sql", "utf8");
  assert.doesNotMatch(server, /payload\.path|user-agent|x-forwarded-for|req\.socket/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.rum_events, public\.submissions from public, anon, authenticated/);
  assert.doesNotMatch(migration, /\b(ip_address|user_agent|query_string)\b/i);
});
