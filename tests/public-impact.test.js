import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadImpact, validImpact } from "../public/impact.js";

const empty = { schemaVersion: 1, status: "unpublished", updatedAt: null, currency: "USD", estimatedValueCents: null, totals: null };
const exampleCounts = { shoes: 2, clothing: 12, socks: 1, water: 4, food: 7, hygiene: 3, other: 0 };
const published = { ...empty, status: "published", updatedAt: "2026-11-25T20:00:00Z", totals: exampleCounts };

test("default release contains no fabricated distributions or dollar values", async () => {
  const data = JSON.parse(await readFile("dist/impact-summary.json", "utf8"));
  assert.deepEqual(data, empty);
  assert.equal(validImpact(data), true);
});

test("verified counts can publish without an unsupported estimated value", () => {
  assert.equal(validImpact(published), true);
  assert.equal(validImpact({ ...published, estimatedValueCents: 12345 }), true);
  assert.equal(validImpact({ ...published, updatedAt: "2026-11-25T20:00:00.000Z" }), true);
});

test("public contract rejects extra data, partial counts and noncanonical dates", () => {
  for (const malformed of [
    { ...published, notes: "private fixture" },
    { ...published, totals: { ...exampleCounts, familyNames: [] } },
    { ...published, totals: { ...exampleCounts, shoes: null } },
    { ...published, totals: { ...exampleCounts, socks: -1 } },
    { ...published, totals: { ...exampleCounts, water: 2.5 } },
    { ...published, totals: { ...exampleCounts, food: 1e30 } },
    { ...published, updatedAt: "2026-02-30T00:00:00Z" },
    { ...published, updatedAt: "2026-11-25T13:00:00-07:00" },
    { ...empty, estimatedValueCents: 0 },
  ]) assert.equal(validImpact(malformed), false);
});

test("load is same-origin, credential-free and restricted to bounded JSON", async () => {
  const res = (body, opts = {}) => new Response(body, { headers: { "Content-Type": "application/json" }, ...opts });
  assert.deepEqual(await loadImpact(async (path, options) => {
    assert.equal(path, "/impact-summary.json");
    assert.deepEqual([options.credentials, options.mode, options.redirect], ["omit", "same-origin", "error"]);
    return res(JSON.stringify(published));
  }), published);
  await assert.rejects(loadImpact(() => res("{}".repeat(5000))), /too large/);
  await assert.rejects(loadImpact(() => res("{}", { status: 503 })), /unavailable/);
  await assert.rejects(loadImpact(() => res("<html>", { headers: { "Content-Type": "text/html" } })), /unavailable/);
  await assert.rejects(loadImpact(() => res(JSON.stringify({ ...published, personal: true }))), /Invalid/);
});
