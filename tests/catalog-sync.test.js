import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resources } from "../src/data/resources.js";
import {
  fetchPublishedCatalog,
  fingerprint,
  assertFreshExport,
  summarizeCatalogDrift,
} from "../scripts/catalog-sync-core.mjs";
const row = (id, extra = {}) => ({
  id,
  record: { id, lastChecked: "2026-10-10" },
  updated_at: "2026-10-11T00:00:00Z",
  ...extra,
});
const response = (rows, range, status = 200) =>
  new Response(JSON.stringify(rows), {
    status,
    headers: { "content-range": range },
  });
const read = (fetchImpl) =>
  fetchPublishedCatalog({
    url: "https://catalog.example",
    key: "public-test-key",
    fetchImpl,
  });

test("catalog fingerprint ignores record and object-key order, preserving nested differences", () => {
  assert.equal(
    fingerprint([{ id: "b", x: { b: 1, a: 2 } }, { id: "a" }]),
    fingerprint([{ id: "a" }, { x: { a: 2, b: 1 }, id: "b" }]),
  );
  assert.notEqual(
    fingerprint([{ id: "a", x: [1, 2] }]),
    fingerprint([{ id: "a", x: [2, 1] }]),
  );
});
test("short capped pages are fully consumed and stable snapshot is read twice", async () => {
  const offsets = [];
  const records = await read(async (url, options) => {
    assert.equal(options.headers.Prefer, "count=exact");
    assert.equal(options.cache, "no-store");
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    return offset === 0
      ? response([row("a"), row("b")], "0-1/3")
      : response([row("c")], "2-2/3");
  });
  assert.deepEqual(
    records.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(offsets, [0, 2, 0, 2]);
});
test("missing exact count, malformed or truncated ranges fail closed", async () => {
  for (const range of ["", "0-0/*", "0-1/3", "1-1/3", "0-0/0", "0-0/100001"]) {
    await assert.rejects(read(async () => response([row("a")], range)));
  }
  await assert.rejects(
    read(async () => response({ error: "unexpected" }, "0-0/1")),
    /malformed page/,
  );
});
test("empty catalog is represented explicitly, incomplete empty pages are refused", async () => {
  assert.deepEqual(await read(async () => response([], "*/0")), []);
  await assert.rejects(
    read(async () => response([], "*/3")),
    /incomplete empty/,
  );
});
test("changing totals and duplicate IDs cannot silently withhold records", async () => {
  let calls = 0;
  await assert.rejects(
    read(async () =>
      ++calls === 1
        ? response([row("a")], "0-0/2")
        : response([row("b")], "1-1/3"),
    ),
    /changed during pagination/,
  );
  calls = 0;
  await assert.rejects(
    read(async () =>
      ++calls === 1
        ? response([row("a")], "0-0/2")
        : response([row("a")], "1-1/2"),
    ),
    /duplicate IDs/,
  );
});
test("record revisions changing between reads are refused", async () => {
  let calls = 0;
  await assert.rejects(
    read(async () =>
      response(
        [
          row("a", {
            updated_at:
              ++calls === 1 ? "2026-10-10T00:00:00Z" : "2026-10-11T00:00:00Z",
          }),
        ],
        "0-0/1",
      ),
    ),
    /changed between complete reads/,
  );
});
test("malformed identities, revisions and HTTP failures are refused", async () => {
  for (const value of [
    row("a", { record: { id: "b" } }),
    row("a", { updated_at: null }),
    row("a", { record: [] }),
    row("", {}),
  ]) {
    await assert.rejects(
      read(async () => response([value], "0-0/1")),
      /malformed record/,
    );
  }
  await assert.rejects(
    read(async () => response([], "*/0", 503)),
    /503/,
  );
});
test("export cannot rewind newer source facts or resurrect old dataset rows", () => {
  const local = [{ id: "a", datasetId: "source", lastChecked: "2026-10-10" }];
  assert.throws(
    () => assertFreshExport([{ id: "a", lastChecked: "2026-08-07" }], local),
    /older than the reviewed source/,
  );
  assert.throws(
    () =>
      assertFreshExport(
        [{ id: "removed", datasetId: "source", lastChecked: "2026-08-07" }],
        local,
      ),
    /older than the reviewed source/,
  );
  assert.throws(
    () => assertFreshExport([{ id: "a" }], local),
    /older than the reviewed source/,
  );
  assert.doesNotThrow(() =>
    assertFreshExport([{ id: "a", lastChecked: "2026-10-10" }], local),
  );
  assert.doesNotThrow(() =>
    assertFreshExport([{ id: "new", lastChecked: "2026-10-11" }], local),
  );
});

test("catalog drift samples are bounded and IDs are not escaped into log instructions", () => {
  const local = [
    { id: "changed", metadata: { a: 1, b: 2 } },
    { id: "local-z" }, { id: "local-a" },
    { id: "same", x: { b: 1, a: 2 } },
  ];
  const remote = [
    { id: "remote" }, { id: "bad\nsecret" },
    { id: "same", x: { a: 2, b: 1 } },
    { id: "changed", metadata: { b: 3, a: 1 } },
  ];
  assert.deepEqual(summarizeCatalogDrift(local, remote, 1), {
    releaseOnly: { count: 2, sample: ["local-a"] },
    databaseOnly: { count: 2, sample: ["remote"] },
    changed: { count: 1, sample: ["changed"] },
  });
  assert.deepEqual(summarizeCatalogDrift(local, local).changed, { count: 0, sample: [] });
});

test("actual verify CLI is GET-only, reports all three drift classes, and fails closed", async (t) => {
  const first = resources[0];
  const snapshots = [
    row(first.id, { record: { ...first, name: "PRIVATE_FIXTURE_VALUE_DO_NOT_LOG" } }),
    row("fixture-db-only"),
  ];
  const requests = [];
  const mock = createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.setHeader("Content-Range", "0-1/2");
    res.end(JSON.stringify(snapshots));
  });
  await new Promise((ok) => mock.listen(0, "127.0.0.1", ok));
  t.after(() => new Promise((ok) => mock.close(ok)));
  const url = `http://127.0.0.1:${mock.address().port}`;
  await assert.rejects(
    promisify(execFile)(process.execPath, ["scripts/catalog-sync.mjs", "verify"], {
      env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "local-fixture-only" },
      timeout: 5000,
    }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, new RegExp(`Release only: ${resources.length - 1}`));
      assert.match(err.stderr, /database only: 1 \(sample: fixture-db-only\)/);
      assert.match(err.stderr, new RegExp(`changed shared IDs: 1 \\(sample: ${first.id}\\)`));
      assert.match(err.stderr, /Read-only preflight: nothing changed/);
      assert.doesNotMatch(err.stderr, /PRIVATE_FIXTURE_VALUE|local-fixture-only/);
      return true;
    },
  );
  assert.equal(requests.length, 2);
  for (const [method, path] of requests) {
    assert.equal(method, "GET");
    const u = new URL(path, url);
    assert.equal(u.pathname, "/rest/v1/rwn_locations");
    assert.equal(u.searchParams.get("published"), "eq.true");
  }
});
