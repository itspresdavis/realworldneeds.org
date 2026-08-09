import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("generated directory search has an accessible name without a visible helper-label leak", async () => {
  const html = await readFile("dist/directory/index.html", "utf8");
  assert.match(html, /data-directory-query[^>]*aria-label="Search this directory"/);
  assert.doesNotMatch(html, /class="sr-only">Search this directory<\/span>/);
});

test("laptop-height desktop finder uses one vertical scroll context", async () => {
  const css = await readFile("src/world-class.css", "utf8");
  assert.match(css, /@media \(min-width: 1100px\) and \(max-height: 1049px\)/);
  const laptopRule = css.match(/@media \(min-width: 1100px\) and \(max-height: 1049px\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(laptopRule, /\.finder-sidebar/);
  assert.match(laptopRule, /max-height:\s*none/);
  assert.match(laptopRule, /overflow:\s*visible/);
});
