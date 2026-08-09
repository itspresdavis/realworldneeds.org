import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function parseVariables(css) {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || "";
  return Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2]]));
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => channel(Number.parseInt(value.slice(offset, offset + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function assertAa(label, foreground, background) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 4.5, `${label} contrast is ${ratio.toFixed(2)}:1; normal-text AA requires 4.5:1`);
}

test("interactive finder core palette retains normal-text AA contrast", async () => {
  const variables = parseVariables(await readFile("src/styles.css", "utf8"));
  assertAa("finder muted text on white", variables["--muted"], variables["--white"]);
  assertAa("finder ink on paper", variables["--ink"], variables["--paper"]);
  assertAa("finder soft green on navy", variables["--green-soft"], variables["--navy-900"]);
  assertAa("finder bright green on navy", variables["--green-bright"], variables["--navy-900"]);
});

test("directory/legal core palette retains normal-text AA contrast", async () => {
  const variables = parseVariables(await readFile("public/legal.css", "utf8"));
  assertAa("directory green links on white", variables["--green-dark"], variables["--white"]);
  assertAa("directory muted text on white", variables["--muted"], variables["--white"]);
  assertAa("directory ink on paper", variables["--ink"], variables["--paper"]);
  assertAa("directory soft green on navy", variables["--green-soft"], variables["--navy"]);
});
