import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("generated directory search has an accessible name without a visible helper-label leak", async () => {
  const html = await readFile("dist/directory/index.html", "utf8");
  assert.match(html, /data-directory-query[^>]*aria-label="Search this directory"/);
  assert.doesNotMatch(html, /class="sr-only">Search this directory<\/span>/);
});

test("desktop finder uses one vertical scroll context at every viewport height", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  assert.match(css, /\.rwn-professional \.finder-sidebar,\s*\.rwn-professional \.resource-panel\s*\{/);
  assert.match(css, /position:\s*static !important/);
  assert.match(css, /max-height:\s*none !important/);
  assert.match(css, /overflow:\s*visible !important/);
  assert.match(css, /overscroll-behavior:\s*auto !important/);
  assert.doesNotMatch(css, /@media \(min-width:\s*1100px\)[\s\S]{0,600}\.finder-sidebar[\s\S]{0,300}overflow:\s*auto/);
});
