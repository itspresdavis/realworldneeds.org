import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

const budgets = [
  ["src/app.js", 180_000],
  ["src/globe-points.js", 20_000],
  ["src/utils/globe-clustering.js", 16_000],
  ["src/utils/globe-demand.js", 3_000],
  ["src/data/generated/melbourne-water.js", 150_000],
  ["src/data/generated/massachusetts-wic.js", 300_000],
  ["src/data/generated/new-york-wic.js", 750_000],
  ["src/data/generated/trussell-foodbanks.js", 600_000]
];

const generatedCatalogFiles = [
  "src/data/generated/melbourne-water.js",
  "src/data/generated/massachusetts-wic.js",
  "src/data/generated/new-york-wic.js",
  "src/data/generated/trussell-foodbanks.js"
];

const GENERATED_CATALOG_BUDGET = 1_500_000;

test("critical client modules stay within deliberate parse/download budgets", async () => {
  for (const [file, maximumBytes] of budgets) {
    const { size } = await stat(file);
    assert.ok(size <= maximumBytes, `${file} is ${size.toLocaleString()} bytes; budget is ${maximumBytes.toLocaleString()} bytes`);
  }
});

test("generated catalog modules cannot grow past the current architectural ceiling unnoticed", async () => {
  const sizes = await Promise.all(generatedCatalogFiles.map(async (file) => ({ file, size: (await stat(file)).size })));
  const total = sizes.reduce((sum, entry) => sum + entry.size, 0);
  assert.ok(total <= GENERATED_CATALOG_BUDGET, `generated catalog is ${total.toLocaleString()} bytes; architectural ceiling is ${GENERATED_CATALOG_BUDGET.toLocaleString()} bytes`);
});
