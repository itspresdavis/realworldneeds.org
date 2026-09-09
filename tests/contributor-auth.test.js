import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateEdit } from "../server/catalog-validation.js";
import {
  sameOrigin,
  requireUser,
  requestOrigin,
  clientFor,
} from "../server/supabase.js";
import account from "../api/account.js";

function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    getHeader(k) {
      return this.headers[k];
    },
    end(body) {
      this.body = body;
    },
    statusCode: 0,
  };
}
const edit = () => ({
  id: "example",
  updatedAt: "2026-09-01T10:00:00.000Z",
  reason: "Confirmed directly with the original source.",
  published: true,
  changes: {
    lat: 42,
    lng: -71,
    sourceUrl: "https://example.org/help",
    lastChecked: "2026-09-01",
    name: "Community help",
  },
});
test("edits reject invalid coordinates, fabricated dates, identity changes and unsafe sources", () => {
  assert.equal(validateEdit(edit()), null);
  for (const changes of [
    { lat: NaN },
    { lng: 181 },
    { lat: "42" },
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://user:pass@example.org" },
    { lastChecked: "2026-02-30" },
    { lastChecked: "2999-01-01" },
    { id: "another-record" },
    { name: "   " },
    { __proto__: null, role: "admin" },
  ])
    assert.ok(validateEdit({ ...edit(), changes }));
  assert.ok(validateEdit({ ...edit(), updatedAt: "" }));
  assert.ok(validateEdit({ ...edit(), reason: "short" }));
});
test("cross-site writes are refused before account work", async () => {
  const req = {
    url: "/api/account",
    method: "POST",
    headers: {
      host: "127.0.0.1:5173",
      origin: "https://attacker.example",
      "content-type": "application/json",
    },
    body: { action: "signout" },
  };
  assert.equal(sameOrigin(req), false);
  const res = response();
  await account(req, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.headers["Cache-Control"], /no-store/);
  assert.equal(
    sameOrigin({
      ...req,
      headers: { ...req.headers, origin: "http://127.0.0.1:5173" },
    }),
    true,
  );
});
test("auth gates reject absent, anonymous and unverified identities", async () => {
  for (const user of [
    null,
    { id: "a", is_anonymous: true, email_confirmed_at: "today" },
    { id: "b", email_confirmed_at: null },
  ]) {
    const res = response();
    const client = {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    };
    assert.equal(await requireUser(client, res), null);
    assert.equal(res.statusCode, 401);
  }
  const user = { id: "editor", email_confirmed_at: "2026-09-01" };
  assert.equal(
    await requireUser(
      { auth: { getUser: async () => ({ data: { user }, error: null }) } },
      response(),
    ),
    user,
  );
});
test("callback failures redirect to a fixed same-origin route", async () => {
  const res = response();
  await account(
    {
      url: "/api/account?action=callback&next=https://evil.example",
      method: "GET",
      headers: { host: "127.0.0.1:5173" },
    },
    res,
  );
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, "/join?notice=expired");
});
test("private workspace has a server gate and never enters the static output or offline cache", async () => {
  const [server, worker, config] = await Promise.all(
    ["api/workspace.js", "public/sw.js", "vercel.json"].map((p) =>
      readFile(p, "utf8"),
    ),
  );
  assert.match(server, /auth.getUser/);
  assert.match(server, /private, no-store/);
  assert.match(worker, /url.pathname === "\/workspace"/);
  assert.ok(
    JSON.parse(config).rewrites.some(
      (r) => r.source === "/workspace" && r.destination === "/api/workspace",
    ),
  );
  await assert.rejects(readFile("dist/workspace.html"));
});
