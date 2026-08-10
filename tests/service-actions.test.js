import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("every generated service page loads hashed handoff assets", async () => {
  const page = await read("dist/service/bowery-mission/index.html");
  assert.match(page, /href="\/service-actions\.css\?v=[a-f0-9]{12}"/);
  assert.match(page, /src="\/service-actions\.js\?v=[a-f0-9]{12}"/);
  const release = JSON.parse(await read("dist/data/release.json"));
  assert.match(release.serviceActionRelease || "", /^[a-f0-9]{12}$/);
});

test("service handoff actions stay local and useful", async () => {
  const script = await read("public/service-actions.js");
  assert.match(script, /navigator\.share/);
  assert.match(script, /navigator\.clipboard\?\.writeText/);
  assert.match(script, /window\.print\(\)/);
  assert.match(script, /Official source:/);
  assert.match(script, /Confirm current details before you go/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /sendBeacon|XMLHttpRequest|localStorage|sessionStorage/);
});

test("service handoff controls are touch-safe accessible and print-clean", async () => {
  const css = await read("public/service-actions.css");
  assert.match(css, /\.service-utility-actions button[\s\S]*?min-height:\s*44px/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print[\s\S]*?\.service-utility-actions[\s\S]*?display:\s*none !important/);
});
