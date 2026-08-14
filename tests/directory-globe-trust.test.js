import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const text = (path) => readFile(path, "utf8");

test("globe point layer uses one semantic RWN marker language with adaptive density", async () => {
  const source = await text("src/globe-points.js");
  assert.match(source, /RWN_POINT_COLORS/);
  assert.match(source, /direct:\s*"#45b64a"/);
  assert.match(source, /locator:\s*"#0b5f9e"/);
  assert.match(source, /network:\s*"#5b8094"/);
  assert.match(source, /densityGridDegrees/);
  assert.match(source, /consolidateResources/);
  assert.match(source, /pointDensity/);
  assert.match(source, /densityBucketKey/);
  assert.match(source, /THREE\.NormalBlending/);
  assert.doesNotMatch(source, /categories\[resource\.category\]\.color/);
  assert.doesNotMatch(source, /AdditiveBlending/);
});

test("directory search results expose direct actions without turning the record into one giant link", async () => {
  const client = await text("public/directory.js");
  assert.match(client, /directory-global-result-wrap/);
  assert.match(client, /directory-global-result-actions/);
  assert.match(client, /actionLink\("Call"/);
  assert.match(client, /maps\.apple\.com\/\?daddr=/);
  assert.match(client, /google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(client, /actionLink\("View details"/);
  assert.match(client, /setAttribute\("aria-label",\s*`Actions for/);
});

test("directory visual system stays registry-first and action-led", async () => {
  const directoryCss = await text("public/directory-enhancements.css");
  const actionCss = await text("public/navigation-actions.css");
  assert.match(directoryCss, /Search is a tool surface, not a promotional card/);
  assert.match(directoryCss, /\.directory-record\s*\{[\s\S]*border-radius:\s*0\s*!important/);
  assert.match(directoryCss, /\.directory-category-chips button\s*\{[\s\S]*border:\s*1px solid/);
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
