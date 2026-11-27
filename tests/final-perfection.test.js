import { serviceContactMarkup } from "../scripts/service-contact.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, index, seo, pagesCss, refinement, professional] = await Promise.all([
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../scripts/service-contact.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/professional-pages.css", import.meta.url), "utf8"),
  readFile(new URL("../src/refinement.js", import.meta.url), "utf8"),
  readFile(new URL("../src/professional.js", import.meta.url), "utf8")
]);

test("preboot and initialized finder use one canonical task message and need order", () => {
  assert.match(app, /<h1>Find help<\/h1>/);
  assert.match(app, /placeholder="Search by service or place"/);
  assert.match(index, /<h1>Find help<\/h1>/);
  assert.match(index, /Look for food, shelter, clothing and other essentials\. Contact the provider directly\./);
  assert.match(refinement, /Search by service or place/);
  assert.match(professional, /Look for food, shelter, clothing and other essentials\. Contact the provider directly\./);
  assert.match(index, /Food[\s\S]*Water[\s\S]*Shelter[\s\S]*Clothing[\s\S]*Hygiene[\s\S]*Health care/);
});

test("static preboot needs wrap on narrow screens and explain the short initialization handoff", () => {
  assert.match(index, /preboot-finder__status/);
  assert.match(index, /Loading the map/);
  assert.doesNotMatch(index, /\.preboot-finder nav \{ flex-wrap:nowrap; overflow-x:auto/);
});

test("resource-finder actions stay capability-aware instead of promising a route", () => {
  for (const kind of ["locator", "network"]) {
    const markup = serviceContactMarkup({ id: "fixture", kind, name: "Regional help", sourceUrl: "https://example.org/", lat: 42, lng: -71 });
    assert.doesNotMatch(markup, /maps\.apple|google\.com\/maps|Directions/);
    assert.match(markup, /not a walk-in location/);
  }
  const direct = serviceContactMarkup({ id: "fixture", kind: "direct", name: "Service site", sourceUrl: "https://example.org/", lat: 42, lng: -71 });
  assert.match(direct, /google\.com\/maps\/dir/);
  assert.match(direct, /Directions/);
  assert.match(seo, /not a walk-in location/);
  assert.match(seo, /Contact the provider/);
  assert.match(pagesCss, /\.service-next-steps__context/);
});
