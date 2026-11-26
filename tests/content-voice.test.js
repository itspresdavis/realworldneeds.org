import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicCopyFiles = [
  "index.html",
  "src/app.js",
  "scripts/build.mjs",
  "public/404.html",
  "public/accessibility.html",
  "public/editorial-policy.html",
  "public/privacy.html",
  "public/terms.html",
  "public/our-story.html"
];

test("public copy avoids internal audit and product-language jargon", async () => {
  const copy = (await Promise.all(publicCopyFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const phrases = [
    "free-access records",
    "bounded official live feeds",
    "resilient text directory",
    "future organizational ambitions",
    "operating boundaries",
    "engineering toward",
    "current contact boundary",
    "required next governance step",
    "this page does not invent"
  ];

  phrases.forEach((phrase) => assert.doesNotMatch(copy, new RegExp(phrase, "i"), `Remove public-facing jargon: ${phrase}`));
});

test("public copy states RWN's present organization status without inventing credentials", async () => {
  const transparency = await readFile("public/our-story.html", "utf8");
  assert.match(transparency, /does not claim registered charity or nonprofit status/i);
  assert.match(transparency, /does not accept donations/i);
  assert.match(transparency, /original source/i);
});
