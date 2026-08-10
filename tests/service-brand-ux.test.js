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

test("RWN publishes one crawlable brand mark across favicon, manifest, and organization schema", async () => {
  const [homepage, manifestText, mark] = await Promise.all([
    text("dist/index.html"),
    text("dist/site.webmanifest"),
    text("dist/rwn-mark.svg")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(homepage, /<link rel="icon" type="image\/svg\+xml" href="\/rwn-mark\.svg"/);
  assert.match(homepage, /"logo":\s*"https:\/\/www\.realworldneeds\.org\/rwn-mark\.svg"/);
  assert.doesNotMatch(homepage, /"logo":\s*"https:\/\/www\.realworldneeds\.org\/media\/earth-blue-marble\.jpg"/);
  assert.ok(manifest.icons?.some((icon) => icon.src === "/rwn-mark.svg" && icon.type === "image/svg+xml"));
  assert.match(mark, /viewBox="0 0 512 512"/);
  assert.match(mark, /Real World Needs/);
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
    const actionsAt = html.indexOf('class="service-next-steps"');
    const cautionAt = html.indexOf('class="policy-note"');
    assert.ok(actionsAt >= 0, `${resource.id} should have a next-step action bar`);
    assert.ok(cautionAt > actionsAt, `${resource.id} should show next steps before caution/details`);
    assert.ok(html.includes(`href="${escapeHtml(resource.sourceUrl)}"`), `${resource.id} should link its reviewed source in the next steps`);
    assert.ok(html.includes(`/#resource=${encodeURIComponent(resource.id)}`), `${resource.id} should link back to its interactive RWN map state`);

    if (resource.phone) {
      assert.ok(html.includes(`href="tel:${escapeHtml(resource.phone.replace(/[^+\d]/g, ""))}"`), `${resource.id} should expose its reviewed phone number as a call action`);
    }
    if (resource.kind === "direct") {
      assert.match(html, /maps\.apple\.com/);
      assert.match(html, /google\.com\/maps\/search/);
    }
  }
});
