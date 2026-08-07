import test from "node:test";
import assert from "node:assert/strict";
import { clusterProjectedEntries } from "../src/utils/globe-clustering.js";

function entry(id, x, y, z = 0.8) {
  return { resource: { id }, point: { x, y, z } };
}

test("nearby projected resources cluster while distant resources remain separate", () => {
  const clusters = clusterProjectedEntries([
    entry("a", 100, 100),
    entry("b", 112, 108),
    entry("c", 280, 260)
  ], 44);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0].members.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(clusters[1].members.map((item) => item.id), ["c"]);
});

test("selected resources always remain individually selectable", () => {
  const clusters = clusterProjectedEntries([
    entry("a", 100, 100),
    entry("selected", 103, 102),
    entry("b", 108, 106)
  ], 44, "selected");

  const selected = clusters.find((cluster) => cluster.selected);
  assert.ok(selected);
  assert.deepEqual(selected.members.map((item) => item.id), ["selected"]);
  assert.ok(clusters.some((cluster) => cluster.members.some((item) => item.id === "a")));
});

test("large projected catalogs cluster deterministically without dropping resources", () => {
  const entries = Array.from({ length: 12000 }, (_, index) => entry(
    `resource-${index}`,
    (index * 37) % 1440,
    (index * 83) % 900,
    0.2 + (index % 80) / 100
  ));

  const first = clusterProjectedEntries(entries, 38);
  const second = clusterProjectedEntries(entries, 38);
  const firstIds = first.flatMap((cluster) => cluster.members.map((item) => item.id));
  const secondIds = second.flatMap((cluster) => cluster.members.map((item) => item.id));

  assert.equal(firstIds.length, entries.length);
  assert.equal(new Set(firstIds).size, entries.length);
  assert.deepEqual(secondIds, firstIds);
  assert.equal(first.length, second.length);
});
