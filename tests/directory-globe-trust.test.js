import { renderDirectoryRow } from "./helpers/directory-renderer.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const text = (path) => readFile(path, "utf8");

test("globe point layer uses one semantic RWN marker language without discarding catalog coordinates", async () => {
  const source = await text("src/globe-points.js");
  assert.match(source, /RWN_POINT_COLORS/);
  assert.match(source, /direct:\s*"#45b64a"/);
  assert.match(source, /locator:\s*"#0b5f9e"/);
  assert.match(source, /network:\s*"#5b8094"/);
  assert.match(source, /locationEntries/);
  assert.doesNotMatch(source, /consolidateResources|Math.round\(lat \/ grid\)/);
  assert.match(source, /pointDensity/);
  assert.match(source, /positions.set\(resourceVector\(resource\)/);
  assert.match(source, /THREE\.NormalBlending/);
  assert.doesNotMatch(source, /categories\[resource\.category\]\.color/);
  assert.doesNotMatch(source, /AdditiveBlending/);
});

test("directory search results expose direct actions without turning the record into one giant link", async () => {
  const client = await text("public/directory-results.js");
  const row = renderDirectoryRow(client, { id: "fixture", name: "Reviewed site", place: "Example", kind: "direct", categoryLabels: ["Food"], checked: "2026-11-06", lat: 42, lng: -71, phone: "211", phoneLinks: [{ label: "211", href: "tel:211" }] });
  assert.equal(row.className, "directory-global-result-wrap");
  const [listing, actions] = row.children;
  assert.equal(listing.tag, "a");
  assert.equal(listing.href, "/service/fixture");
  assert.equal(actions.tag, "nav");
  assert.equal(actions.className, "directory-global-result-actions");
  assert.equal(actions.attributes["aria-label"], "Actions for Reviewed site");
  assert.equal(actions.children.find(link => link.textContent === "Call 211")?.href, "tel:211");
  assert.equal(new URL(actions.children.find(link => link.textContent === "Apple Maps").href).searchParams.get("daddr"), "42,-71");
  assert.equal(new URL(actions.children.find(link => link.textContent === "Google Maps").href).searchParams.get("destination"), "42,-71");
  assert.equal(actions.children.find(link => link.textContent === "View details")?.href, "/service/fixture");
  assert.ok(!listing.children.includes(actions), "actions must be siblings of the listing link");
});

test("directory visual system stays registry-first and action-led", async () => {
  const directoryCss = await text("public/directory-enhancements.css");
  const actionCss = await text("public/navigation-actions.css");
  assert.match(directoryCss, /\.directory-search-tools\{[\s\S]*border-top:1px\s+solid/);
  assert.match(directoryCss, /\.directory-record\s*\{[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(directoryCss, /\.directory-category-chips button\s*\{[\s\S]*border:\s*1px\s+solid/);
  assert.match(actionCss, /\.directory-quick-actions \.is-call/);
  assert.match(actionCss, /\.directory-global-result-actions \.is-call/);
  assert.match(actionCss, /grid-column:1\/-1/);
});

test("directory interaction assets remain inside deliberate client budgets", async () => {
  const budgets = [
    ["public/directory.js", 14_000],
    ["public/directory-enhancements.css", 18_000],
    ["public/navigation-actions.css", 12_000],
    ["src/globe-points.js", 12_000]
  ];
  for (const [path, maximum] of budgets) {
    const { size } = await stat(path);
    assert.ok(size <= maximum, `${path} is ${size.toLocaleString()} bytes; budget is ${maximum.toLocaleString()} bytes`);
  }
});
