import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared footer reflows at tablet widths without hiding overflowing links", async () => {
  const css = (await readFile("public/professional-pages.css", "utf8")).replace(/\s/g, "");
  assert.match(css, /\.legal-footer\.rwn-unified-footer\{grid-template-columns:minmax\(0,1\.2fr\)repeat\(3,minmax\(0,\.8fr\)\);\}/);
  assert.match(css, /\.legal-footer\.rwn-unified-footer>\*\{min-width:0;overflow-wrap:anywhere;\}/);
  assert.match(css, /@media\(max-width:900px\)\{\.legal-footer\.rwn-unified-footer\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/);
  assert.match(css, /@media\(max-width:650px\)[\s\S]*?\.legal-footer\.rwn-unified-footer\{grid-template-columns:minmax\(0,1fr\);\}/);
  for (const rule of css.matchAll(/\.legal-footer[^{}]*\{([^{}]*)\}/g)) {
    assert.doesNotMatch(rule[1], /overflow(?:-x)?\s*:\s*(?:hidden|clip)/);
  }
});

test("all generated page types keep the complete shared footer navigation", async () => {
  const expected = ["/", "/directory", "/directory#saved", "/account", "/our-story", "/donate", "/our-work", "/get-involved", "/contact", "/transparency", "/privacy", "/terms", "/accessibility", "/editorial-policy", "/sources", "/directory/help/food", "/directory/help/shelter", "/directory/help/health", "/directory/help/hygiene", "/directory/help/clothing", "/directory/help/water"];
  for (const path of ["directory/index.html", "service/whitechapel-mission/index.html", "privacy.html", "terms.html", "accessibility.html"]) {
    const html = await readFile(`dist/${path}`, "utf8");
    const footer = html.match(/<footer class="legal-footer rwn-unified-footer">([\s\S]*?)<\/footer>/)?.[1];
    assert.ok(footer, `${path} has its shared footer`);
    assert.deepEqual([...footer.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]), expected, path);
    assert.equal([...footer.matchAll(/<nav /g)].length, 4);
  }
});
