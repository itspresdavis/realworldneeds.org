import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resources } from "../src/data/resources.js";

const text = (path) => readFile(path, "utf8");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

test("RWN publishes one crawlable brand mark across favicon, manifest, organization schema, and app chrome", async () => {
  const [homepage, manifestText, mark, presentation, logo] = await Promise.all([
    text("dist/index.html"),
    text("dist/site.webmanifest"),
    text("dist/rwn-mark.svg"),
    text("dist/src/professional.js"),
    readFile("dist/brand/rwn-logo-192.png")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(homepage, /<link rel="icon" type="image\/svg\+xml" href="\/rwn-mark\.svg"/);
  assert.match(homepage, /"logo":\s*"https:\/\/www\.realworldneeds\.org\/rwn-mark\.svg"/);
  assert.doesNotMatch(homepage, /"logo":\s*"https:\/\/www\.realworldneeds\.org\/media\/earth-blue-marble\.jpg"/);
  assert.ok(manifest.icons?.some((icon) => icon.src === "/rwn-mark.svg" && icon.type === "image/svg+xml"));
  assert.match(mark, /viewBox="0 0 512 512"/);
  assert.match(mark, /Real World Needs/);
  assert.match(presentation, /\/brand\/rwn-logo-192\.png/);
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "canonical app logo should be a real PNG, not encoded text");
  assert.ok(logo.length > 5000, "canonical app logo should contain production image data");
});

test("every major public page family carries the same official RWN logo in its visible header", async () => {
  const sampleService = resources.find((resource) => resource.id === "whitechapel-mission") || resources[0];
  const pages = [
    "dist/directory/index.html",
    `dist/service/${sampleService.id}/index.html`,
    "dist/transparency.html",
    "dist/privacy.html",
    "dist/editorial-policy.html",
    "dist/accessibility.html",
    "dist/sources/index.html",
    "dist/404.html"
  ];

  for (const path of pages) {
    const html = await text(path);
    assert.match(
      html,
      /<img class="legal-brand__mark" src="\/brand\/rwn-logo-192\.png" alt="" width="192" height="192" decoding="async" \/>/,
      `${path} must use the official RWN logo in its visible header`
    );
    assert.doesNotMatch(html, /<span class="legal-brand__mark">RWN<\/span>/, `${path} must not fall back to a text placeholder logo`);
  }
});

test("service landing pages surface reviewed next steps before the caution/detail block", async () => {
  const samples = [
    resources.find((resource) => resource.kind === "direct" && resource.phone),
    resources.find((resource) => resource.kind === "locator"),
    resources.find((resource) => resource.kind === "network")
  ].filter(Boolean);
  assert.ok(samples.length >= 2, "catalog should expose more than one service listing type");

  for (const resource of samples) {
    const html = await text(`dist/service/${resource.id}/index.html`);
    const actionsAt = html.indexOf('class="service-next-steps service-next-steps--v3"');
    const cautionAt = html.indexOf('class="policy-note"');
    assert.ok(actionsAt >= 0, `${resource.id} should have a next-step action bar`);
    assert.ok(cautionAt > actionsAt, `${resource.id} should show next steps before caution/details`);
    assert.ok(html.includes(`href="${escapeHtml(resource.sourceUrl)}"`), `${resource.id} should link its reviewed source in the next steps`);
    assert.ok(html.includes(`/#resource=${encodeURIComponent(resource.id)}`), `${resource.id} should link back to its interactive RWN map state`);

    if (resource.phone) {
      assert.ok(html.includes(`href="tel:${escapeHtml(resource.phone.replace(/[^+\d]/g, ""))}"`), `${resource.id} should expose its reviewed phone number as a call action`);
    }
    if (resource.kind === "direct") {
      assert.match(html, /maps\.apple\.com\/\?daddr=/);
      assert.match(html, /google\.com\/maps\/dir\/\?api=1&amp;destination=/);
      assert.match(html, />Apple Maps<\/strong>/);
      assert.match(html, />Google Maps<\/strong>/);
    }
  }
});
