import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, index, seo, pagesCss, refinement, professional] = await Promise.all([
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../scripts/professional-seo.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/professional-pages.css", import.meta.url), "utf8"),
  readFile(new URL("../src/refinement.js", import.meta.url), "utf8"),
  readFile(new URL("../src/professional.js", import.meta.url), "utf8")
]);

test("preboot and initialized finder use one canonical task message and need order", () => {
  assert.match(app, /<h1>Find essential services near you\.<\/h1>/);
  assert.match(app, /placeholder="Search by service or place"/);
  assert.match(index, /<h1>Find essential services near you\.<\/h1>/);
  assert.match(index, /Find food, shelter and everyday essentials\. Clear contact details\. Sources you can check\./);
  assert.match(refinement, /Search by service or place/);
  assert.match(professional, /Find food, shelter and everyday essentials\. Clear contact details\. Sources you can check\./);
  assert.match(index, /Food[\s\S]*Water[\s\S]*Shelter[\s\S]*Clothing[\s\S]*Hygiene[\s\S]*Health care/);
});

test("static preboot needs wrap on narrow screens and explain the short initialization handoff", () => {
  assert.match(index, /preboot-finder__status/);
  assert.match(index, /Preparing the interactive finder/);
  assert.doesNotMatch(index, /\.preboot-finder nav \{ flex-wrap:nowrap; overflow-x:auto/);
});

test("resource-finder actions stay capability-aware instead of promising a route", () => {
  assert.match(seo, /const isDirectLocation = resource\.kind === "direct"/);
  assert.match(seo, /not a walk-in location/);
  assert.match(seo, /Contact or verify current details/);
  assert.match(pagesCss, /\.service-next-steps__context/);
});
