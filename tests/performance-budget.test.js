import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

const budgets = [
  ["src/app.js", 180_000],
  ["src/globe-points.js", 20_000],
  ["src/utils/globe-clustering.js", 16_000],
  ["src/data/generated/trussell-foodbanks.js", 600_000]
];

test("critical client modules stay within deliberate parse/download budgets", async () => {
  for (const [file, maximumBytes] of budgets) {
    const { size } = await stat(file);
    assert.ok(size <= maximumBytes, `${file} is ${size.toLocaleString()} bytes; budget is ${maximumBytes.toLocaleString()} bytes`);
  }
});
