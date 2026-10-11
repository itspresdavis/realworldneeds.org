import assert from "node:assert/strict";
import test from "node:test";
import { groupLocalities, localitySignature } from "../scripts/locality-groups.mjs";

const record = (id, fields = {}) => ({ id, city: "Springfield", country: "United States", address: "Coverage area only", ...fields });
const summarize = resources => groupLocalities(resources).map(({ info, ambiguousBase, items }) => ({
  ...info, ambiguousBase, ids: items.map(item => item.id)
}));

test("unambiguous city groups retain unqualified records without modifying their geography", () => {
  const records = [record("known", { address: "1 Main St, MA 01103" }), record("coverage"), record("comma-zip", { address: "2 Main St, MA, 01103" })];
  const original = structuredClone(records);
  assert.deepEqual(summarize(records), [{ city: "Springfield", country: "United States", administrativeArea: "MA", ambiguousBase: false, ids: ["known", "coverage", "comma-zip"] }]);
  assert.deepEqual(records, original, "a group area is not a new location fact on its records");
  assert.equal(records[1].administrativeArea, undefined);
});

test("homonymous cities keep known areas separate and withhold unqualified records", () => {
  const records = [record("massachusetts", { address: "1 Main St, MA 01103" }), record("unknown"), record("illinois", { address: "2 Main St, IL 62701" })];
  assert.deepEqual(summarize(records), [
    { city: "Springfield", country: "United States", administrativeArea: "MA", ambiguousBase: true, ids: ["massachusetts"] },
    { city: "Springfield", country: "United States", administrativeArea: "IL", ambiguousBase: true, ids: ["illinois"] }
  ]);
  assert.equal(groupLocalities(records).flatMap(group => group.items).some(item => item.id === "unknown"), false);
});

test("Canadian provinces use the same conservative known-area and ambiguity policy", () => {
  const known = record("ontario", { country: "Canada", address: "1 Main St, ON N5P 1A1" });
  const unknown = record("coverage", { country: "Canada" });
  assert.deepEqual(summarize([unknown, known]), [{ city: "Springfield", country: "Canada", administrativeArea: "ON", ambiguousBase: false, ids: ["coverage", "ontario"] }]);
  const other = record("nova-scotia", { country: "Canada", address: "2 Main St, ns B0R 1H0" });
  assert.deepEqual(summarize([unknown, known, other]).map(group => [group.administrativeArea, group.ids]), [["ON", ["ontario"]], ["NS", ["nova-scotia"]]]);
});

test("city and country facts are required and global coverage cannot become a locality", () => {
  const records = [record("no-city", { city: " " }), record("no-country", { country: "" }), record("global", { country: "Global" }), record("us"), record("canada", { country: "Canada" }), record("trimmed", { city: " Springfield ", country: " United States " })];
  assert.deepEqual(summarize(records), [
    { city: "Springfield", country: "United States", administrativeArea: "", ambiguousBase: false, ids: ["us", "trimmed"] },
    { city: "Springfield", country: "Canada", administrativeArea: "", ambiguousBase: false, ids: ["canada"] }
  ]);
});

test("locality identity preserves spelling and separates country and administrative area", () => {
  const values = [
    { city: "Québec", country: "Canada", administrativeArea: "QC" },
    { city: "Quebec", country: "Canada", administrativeArea: "QC" },
    { city: "Québec", country: "Canada", administrativeArea: "ON" },
    { city: "Québec", country: "United States", administrativeArea: "QC" }
  ];
  assert.equal(new Set(values.map(localitySignature)).size, values.length);
  assert.equal(localitySignature({ city: "London", country: "United Kingdom", administrativeArea: null }), localitySignature({ city: "London", country: "United Kingdom", administrativeArea: "" }));
});
