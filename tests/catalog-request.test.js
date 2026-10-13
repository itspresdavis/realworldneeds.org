import assert from "node:assert/strict";
import test from "node:test";
import { catalogFixture, deferred, payload, response, settle } from "./helpers/catalog-fixture.js";

for (const kind of ["directory", "saved"]) {
  for (const stage of ["headers", "JSON"]) {
    test(`${kind}: a hung ${stage} request reaches failure after one whole-request deadline`, async () => {
      const stalled = deferred();
      const f = catalogFixture(kind, () => stage === "headers" ? stalled.promise : { ok: true, json: () => stalled.promise });
      let state = "pending";
      f.load().then(() => { state = "success"; }, () => { state = "failure"; });
      await settle();
      f.advance(7999); await settle();
      assert.equal(state, "pending");
      f.advance(1); await settle();
      assert.equal(state, "failure", "stalled catalog must reach the entry's existing catch/Retry path");
      assert.equal(f.calls[0][1].signal.aborted, true);
      assert.equal(f.timers.size, 0);
    });
  }

  test(`${kind}: body reading shares the remaining header deadline`, async () => {
    const headers = deferred(), body = deferred();
    const f = catalogFixture(kind, () => headers.promise);
    let failed = false;
    f.load().catch(() => { failed = true; });
    await settle(); f.advance(7000);
    headers.resolve({ ok: true, json: () => body.promise }); await settle();
    f.advance(1000); await settle();
    assert.equal(failed, true);
  });

  test(`${kind}: late headers/body success cannot revive a timed-out request or replace retry data`, async () => {
    for (const stage of ["headers", "JSON"]) {
      const old = deferred();
      let attempts = 0;
      const f = catalogFixture(kind, () => ++attempts === 1 ? (stage === "headers" ? old.promise : { ok: true, json: () => old.promise }) : response());
      let revived = false;
      f.load().then(() => { revived = true; }, () => {});
      await settle(); f.advance(8000); await settle();
      const retry = f.load();
      assert.equal(f.load(), retry);
      await retry;
      old.resolve(stage === "headers" ? response({ records: [{ id: "withdrawn" }], scopes: {} }) : { records: [{ id: "withdrawn" }], scopes: {} });
      await settle();
      assert.equal(revived, false);
      assert.equal(await f.load(), payload);
      assert.equal(attempts, 2);
      assert.equal(f.timers.size, 0);
    }
  });

  for (const failure of ["reject", "HTTP", "JSON rejection", "invalid"]) {
    test(`${kind}: ${failure} clears the failed promise and coalesces repeated retry`, async () => {
      let attempts = 0;
      const f = catalogFixture(kind, () => {
        if (++attempts > 1) return response();
        if (failure === "reject") throw new Error("offline");
        if (failure === "HTTP") return { ok: false };
        if (failure === "JSON rejection") return { ok: true, json: async () => { throw new Error("body"); } };
        return response({ records: null });
      });
      await assert.rejects(f.load());
      const retry = f.load();
      for (let i = 0; i < 10; i++) assert.equal(f.load(), retry);
      assert.equal(await retry, payload);
      assert.equal(attempts, 2);
      assert.equal(f.timers.size, 0);
      assert.equal(f.calls[1][1].credentials, "same-origin");
      assert.equal(f.calls[1][1].cache, "force-cache");
      assert.equal(f.calls[1][0], "/data/search-index.json?v=old");
    });
  }

  test(`${kind}: release replacement rejects old work and never revives withdrawn data`, async () => {
    const old = deferred(), current = deferred();
    let attempts = 0, oldState = "pending";
    const f = catalogFixture(kind, () => ++attempts === 1 ? old.promise : current.promise);
    f.load().then(() => { oldState = "success"; }, () => { oldState = "rejected"; });
    await settle(); f.reset();
    const request = f.load(); await settle();
    assert.equal(oldState, "rejected");
    assert.equal(f.calls[0][1].signal.aborted, true);
    assert.equal(f.calls[1][0], "/data/search-index.json");
    assert.equal(f.calls[1][1].cache, "reload");
    old.resolve(response({ records: [{ id: "withdrawn" }], scopes: {} })); await settle();
    assert.equal(f.load(), request);
    current.resolve(response());
    assert.equal(await request, payload);
    assert.equal(oldState, "rejected");
  });

  test(`${kind}: offline/online retries replace unfinished work but retain a successful versioned cache`, async () => {
    const stalled = deferred();
    let attempts = 0;
    const f = catalogFixture(kind, () => ++attempts === 1 ? stalled.promise : response());
    const before = f.load(); before.catch(() => {});
    await settle(); f.retry();
    const after = f.load();
    assert.notEqual(after, before);
    assert.equal(await after, payload);
    f.retry();
    assert.equal(f.load(), after);
    assert.equal(attempts, 2);
    assert.equal(f.calls[1][0], "/data/search-index.json?v=old");
  });
}
