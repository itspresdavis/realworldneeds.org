import test from "node:test";
import assert from "node:assert/strict";
import { globeCoordinateSnapshot, assertGlobeCoordinateFidelity } from "../scripts/qa-globe-coordinate-fidelity.mjs";

const catalog = [
  { id: "first", lat: 42.36, lng: -71.06 },
  { id: "contact", lat: null, lng: null, locationPrecision: "contact-only" },
  { id: "last", lat: -23.52, lng: -46.84 }
];
function fixture(records = catalog) {
  const mapped = [catalog[0], catalog[2]];
  const vectors = mapped.map(({ lat, lng }) => {
    const a = lat * Math.PI / 180, b = lng * Math.PI / 180;
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
  });
  let disposed = 0;
  const snapshot = globeCoordinateSnapshot(records, () => ({
    userData: { allResources: records, resources: mapped },
    geometry: { attributes: { position: { count: 2,
      getX: i => vectors[i][0], getY: i => vectors[i][1], getZ: i => vectors[i][2] } },
      dispose() { disposed++; } },
    material: { dispose() { disposed++; } }
  }), () => {});
  snapshot.contactOnlySearchIds = ["contact"];
  snapshot.addressOnlySearchIds = records.filter(record => record.locationPrecision === "address").map(record => record.id);
  assert.equal(disposed, 2);
  return snapshot;
}
test("coordinate audit handles an unmapped listing between mapped IDs at every zoom", () => {
  const result = assertGlobeCoordinateFidelity(fixture());
  assert.deepEqual(result.counts, [2, 2, 2, 2]);
  assert.equal(result.mapped, 2);
  assert.equal(result.contactOnly, 1);
  assert.ok(result.maximumError < 0.00001);
});

const addressFixture = () => fixture([
  ...catalog.slice(0, 2),
  { id: "address-only", lat: null, lng: null, locationPrecision: "address" },
  catalog[2]
]);
test("coordinate audit retains searchable address-only sites without inventing globe points", () => {
  const result = assertGlobeCoordinateFidelity(addressFixture());
  assert.equal(result.catalog, 4);
  assert.equal(result.mapped, 2);
  assert.equal(result.addressOnly, 1);
  assert.deepEqual(result.counts, [2, 2, 2, 2]);
  assert.deepEqual(result.addressOnlySearchIds, ["address-only"]);
});
for (const [label, mutate] of [
  ["invented address-only coordinates", s => { s.catalog[2].lat = 0; s.catalog[2].lng = 0; }],
  ["missing address-only null coordinates", s => { delete s.catalog[2].lng; }],
  ["address-only mapped ID", s => { s.frames[0].ids[0] = "address-only"; }],
  ["extra address-only point", s => { s.frames[0].ids.push("address-only"); s.frames[0].count++; s.frames[0].positions.push([1, 0, 0]); }],
  ["address-only removed from source layer", s => { s.retainedIds.splice(2, 1); }],
  ["address-only removed from text search", s => { s.addressOnlySearchIds = []; }],
  ["unknown mapped precision", s => { s.catalog[0].locationPrecision = "unknown"; }],
  ["malformed mapped coordinates", s => { s.catalog[0].lat = "42.36"; }],
  ["out-of-range mapped coordinates", s => { s.catalog[0].lng = 181; }]
]) test("coordinate audit independently rejects " + label, () => {
  const snapshot = structuredClone(addressFixture());
  mutate(snapshot);
  assert.throws(() => assertGlobeCoordinateFidelity(snapshot), /Catalog coordinate fidelity/);
});
for (const [label, mutate] of [
  ["missing mapped point", s => { s.frames[0].count--; s.frames[0].positions.pop(); }],
  ["extra mapped point", s => { s.frames[0].count++; s.frames[0].positions.push([...s.frames[0].positions[0]]); s.frames[0].ids.push("duplicate"); }],
  ["misaligned IDs", s => s.frames[1].ids.reverse()],
  ["misaligned coordinates", s => s.frames[2].positions.reverse()],
  ["NaN serialized as null", s => { s.frames[0].positions[0][0] = null; }],
  ["non-finite coordinates", s => { s.frames[0].positions[0][0] = NaN; }],
  ["zero coordinate vector", s => { s.frames[0].positions[0] = [0, 0, 0]; }],
  ["drift beyond unchanged tolerance", s => { s.frames[3].positions[0][0] += 0.001; }],
  ["contact-only mapped ID", s => { s.frames[0].ids[0] = "contact"; }],
  ["contact-only removed from source layer", s => { s.retainedIds.splice(1, 1); }],
  ["contact-only removed from text search", s => { s.contactOnlySearchIds = []; }],
  ["invented contact coordinates", s => { s.catalog[1].lat = 0; }],
  ["invalid mapped catalog record", s => { s.catalog[0].lat = null; }],
  ["missing zoom", s => s.frames.pop()]
]) test("coordinate audit rejects " + label, () => {
  const snapshot = structuredClone(fixture());
  mutate(snapshot);
  assert.throws(() => assertGlobeCoordinateFidelity(snapshot), /Catalog coordinate fidelity/);
});
