import test from "node:test";
import assert from "node:assert/strict";
import { relatedResources } from "../scripts/related-resources.mjs";

const record = (id, fields = {}) => ({ id, name: id, category: "food", kind: "direct", city: "Dublin", country: "Ireland", lat: 53.35, lng: -6.27, ...fields });
const ids = (source, catalog) => relatedResources(source, catalog).map(({ candidate }) => candidate.id);

test("country membership cannot be outweighed by category, city, or nearby cross-border coordinates", () => {
  const source = record("source", { secondaryCategories: ["hygiene", "health"] });
  const foreign = record("foreign", { country: "United Kingdom", secondaryCategories: ["hygiene", "health"] });
  const global = record("global", { country: "Global", kind: "locator" });
  assert.deepEqual(ids(source, [foreign, global, record("in-country", { lat: 51 })]), ["in-country"]);
});

test("sparse and empty countries are not padded with unrelated or overseas services", () => {
  const source = record("source");
  const unrelated = record("unrelated", { category: "water" });
  assert.deepEqual(ids(source, [source, unrelated, record("foreign", { country: "France" })]), []);
  assert.deepEqual(ids(source, [record("only-match"), unrelated]), ["only-match"]);
  assert.deepEqual(ids({ ...source, country: "" }, [record("unknown", { country: "" })]), []);
});

test("physical distances can rank exact sites without turning country scope into a nearby claim", () => {
  const source = record("source");
  const results = relatedResources(source, [record("far", { lat: 51 }), record("near", { lat: 53.36 })]);
  assert.deepEqual(results.map(({ candidate }) => candidate.id), ["near", "far"]);
  assert.ok(results[0].distance > 0 && results[0].distance < 2);
});

test("coarse coverage markers and shared city names never produce proximity", () => {
  const source = record("source");
  const coverage = record("coverage", { kind: "locator", locationPrecision: "coverage" });
  const network = record("network", { kind: "network" });
  const explicitExactFinder = record("exact-finder", { kind: "locator", locationPrecision: "exact" });
  for (const candidate of [coverage, network, explicitExactFinder]) {
    assert.equal(relatedResources(source, [candidate])[0].distance, Infinity);
    assert.equal(relatedResources(candidate, [source])[0].distance, Infinity);
  }
  assert.deepEqual(ids(source, [coverage, record("physical-nearby", { lat: 53.36 })]), ["physical-nearby", "coverage"]);
});

test("contact-only phone and online routes remain discoverable without distances even with stale coordinates", () => {
  const source = record("source");
  for (const contact of [record("phone", { kind: "network", locationPrecision: "contact-only", lat: undefined, lng: undefined, phone: "1800 123456" }),
    record("web", { kind: "locator", locationPrecision: "contact-only", accessUrl: "https://example.org/help" })]) {
    assert.deepEqual(ids(source, [contact]), [contact.id]);
    assert.equal(relatedResources(source, [contact])[0].distance, Infinity);
    assert.equal(relatedResources(contact, [source])[0].distance, Infinity);
  }
});

test("Global pages recommend only category-related broader finders and networks", () => {
  const source = record("source", { kind: "locator", country: "Global" });
  const network = record("network", { country: "Global", kind: "network", coverageNote: "United States and Canada only" });
  assert.deepEqual(ids(source, [network, record("local"), record("global-site", { country: "Global" }), record("unrelated", { kind: "locator", country: "Global", category: "water" })]), ["network"]);
  assert.equal(relatedResources(source, [network])[0].distance, Infinity);
});

test("current, closed, duplicate and over-limit entries do not leak into recommendations", () => {
  const source = record("source");
  const closed = record("closed", { collectionStatus: "Closed" });
  const candidates = Array.from({ length: 9 }, (_, index) => record(`candidate-${index}`));
  assert.deepEqual(ids(source, [source, closed, ...candidates, candidates[0]]), candidates.slice(0, 6).map(({ id }) => id));
});

test("ties are stable across catalog order and records are never mutated", () => {
  const source = record("source");
  const candidates = [record("z", { name: "Same" }), record("a", { name: "Same" }), record("b", { name: "Same" })];
  const before = structuredClone(candidates);
  assert.deepEqual(ids(source, candidates), ["a", "b", "z"]);
  assert.deepEqual(ids(source, [...candidates].reverse()), ["a", "b", "z"]);
  assert.deepEqual(candidates, before);
});


test("both supported source closure states are excluded before ranking", () => {
  const source = record("source");
  for (const collectionStatus of ["Closed", "Temporarily closed"]) {
    assert.deepEqual(ids(source, [record("closed-only", { collectionStatus })]), []);
    assert.deepEqual(ids(source, [record("closed-first", { collectionStatus }), record("open")]), ["open"]);
  }
});
