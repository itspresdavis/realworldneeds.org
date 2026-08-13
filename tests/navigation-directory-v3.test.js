import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resources } from "../src/data/resources.js";

const text = (path) => readFile(path, "utf8");
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function directPhoneResource() {
  return resources.find((resource) => resource.kind === "direct" && resource.phone && Number.isFinite(resource.lat) && Number.isFinite(resource.lng));
}

test("major generated page families use one main navigation model", async () => {
  const paths = [
    "dist/directory/index.html",
    "dist/privacy.html",
    "dist/editorial-policy.html",
    "dist/transparency.html",
    "dist/sources/index.html"
  ];

  for (const path of paths) {
    const html = await text(path);
    assert.match(html, /class="legal-header rwn-unified-header"/, `${path} is missing unified header`);
    assert.match(html, /class="rwn-primary-nav" aria-label="Main navigation"/, `${path} is missing primary nav`);
    assert.match(html, />Find help<\/a>/, `${path} is missing Find help`);
    assert.match(html, />How listings are checked<\/a>/, `${path} is missing checking policy`);
    assert.match(html, />Transparency<\/a>/, `${path} is missing Transparency`);
    assert.match(html, /class="rwn-header-action" href="\/directory"/, `${path} is missing directory action`);
    assert.match(html, /<details class="rwn-site-menu">\s*<summary>Menu<\/summary>/, `${path} is missing plain-language mobile Menu`);
    assert.match(html, /\/navigation-directory\.css\?v=[a-f0-9]{12}/, `${path} is missing unified navigation CSS`);
  }
});

test("directory records put call and both direction choices before secondary details", async () => {
  const resource = directPhoneResource();
  assert.ok(resource, "A direct service with phone and coordinates is required for action QA.");
  const html = await text("dist/directory/index.html");
  const block = html.match(new RegExp(`<article class="directory-record" id="${escapeRegex(resource.id)}">([\\s\\S]*?)<\\/article>`))?.[0] || "";
  assert.ok(block, `Directory does not contain ${resource.id}`);
  assert.match(block, /class="directory-quick-actions"/);
  assert.match(block, /class="is-call" href="tel:/);
  assert.match(block, /maps\.apple\.com\/\?daddr=/);
  assert.match(block, /google\.com\/maps\/dir\/\?api=1&amp;destination=/);
  assert.match(block, />View details<\/strong>/);
  assert.ok(block.indexOf("directory-quick-actions") < block.indexOf("<dl>"), "contact actions must appear before detailed facts");
});

test("service pages use the same call and map vocabulary as the directory", async () => {
  const resource = directPhoneResource();
  const html = await text(`dist/service/${resource.id}/index.html`);
  assert.match(html, /service-next-steps service-next-steps--v3/);
  assert.match(html, />Contact and directions<\/span>/);
  assert.match(html, />Call<\/strong>/);
  assert.match(html, />Apple Maps<\/strong>/);
  assert.match(html, />Google Maps<\/strong>/);
  assert.match(html, /maps\.apple\.com\/\?daddr=/);
  assert.match(html, /google\.com\/maps\/dir\/\?api=1&amp;destination=/);
  assert.match(html, />RWN map<\/strong>/);
});

test("directory search index carries only public fields needed for immediate contact actions", async () => {
  const payload = JSON.parse(await text("dist/data/search-index.json"));
  assert.equal(payload.schemaVersion, "1.3");
  const resource = directPhoneResource();
  const record = payload.records.find((entry) => entry.id === resource.id);
  assert.ok(record);
  assert.equal(record.phone, resource.phone);
  assert.equal(record.lat, resource.lat);
  assert.equal(record.lng, resource.lng);
  assert.equal(record.sourceUrl, resource.sourceUrl);
  assert.match(payload.privacy, /Search terms remain in the visitor's browser/);
});

test("secondary directory browsing and machine-data links no longer compete with search", async () => {
  const html = await text("dist/directory/index.html");
  assert.match(html, /<details class="directory-data-tools"><summary>Downloads and directory data<\/summary>/);
  assert.match(html, /<details class="directory-browse"><summary>Browse by need or place<\/summary>/);
  assert.match(html, /<h1>Find a service\.<\/h1>/);
  assert.match(html, /choose Apple Maps or Google Maps for directions/);
});

test("navigation release is locked to the content-derived build release", async () => {
  const release = JSON.parse(await text("dist/data/release.json"));
  assert.match(release.release, /^[a-f0-9]{12}$/);
  assert.equal(release.navigationRelease, release.release);
  const css = await text("dist/navigation-directory.css");
  assert.match(css, /\.rwn-site-menu > summary/);
  assert.match(css, /min-height:\s*48px/);
  assert.match(css, /\.directory-quick-actions/);
});
