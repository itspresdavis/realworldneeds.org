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

test("directory text stays readable and long names do not depend on Saved styling to wrap", async () => {
  const css = await readFile("public/directory-enhancements.css", "utf8");
  const pages = await readFile("public/professional-pages.css", "utf8");
  assert.match(css, /\.directory-global-result strong\{[^}]*white-space:normal;overflow-wrap:anywhere/);
  assert.match(css, /\.directory-global-result small\{color:#52666e;font-size:\.8125rem;/);
  assert.match(pages, /\.directory-search-field input\s*\{[^}]*font-size:1rem;/);
  assert.match(pages, /#directory \.directory-global-result-actions a\s*\{\s*min-height:\s*44px;/);
  assert.match(pages, /@media\s*\(min-width:\s*651px\)\s*and\s*\(max-width:\s*900px\)[\s\S]*#directory \.directory-global-result-wrap\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\);\s*\}/);
});
