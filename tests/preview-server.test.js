import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production preview serves the SVG brand mark with an image MIME type", async () => {
  const server = await readFile("scripts/serve.mjs", "utf8");
  assert.match(server, /"\.svg":\s*"image\/svg\+xml; charset=utf-8"/);
});
