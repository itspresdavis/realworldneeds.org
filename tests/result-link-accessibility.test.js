import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile("src/app.js", "utf8");
const actions = await readFile("src/result-actions.js", "utf8");
const css = await readFile("src/styles.css", "utf8");

test("enhancing a result preserves descriptive content in a permanent, naturally named link", () => {
  const source = actions.slice(actions.indexOf("function replaceResultTrigger("), actions.indexOf("\nfunction enhanceCard("));
  const attrs = new Map();
  const link = { setAttribute: (name, value) => attrs.set(name, value) };
  const context = vm.createContext({ document: { createElement: () => link } });
  vm.runInContext(source, context);
  let replacement;
  const markup = "<strong>Example service</strong><span>New York</span><span>Food · Shelter</span><time>2026-09-09</time>";
  context.replaceResultTrigger({ className: "", innerHTML: markup, replaceWith: (value) => { replacement = value; } }, { id: "example-service", name: "Example service" });
  assert.equal(replacement, link);
  assert.equal(link.href, "/service/example-service");
  assert.equal(link.className, "result-row-link");
  assert.equal(link.innerHTML, markup);
  assert.equal(attrs.has("aria-label"), false, "a name-only label must not hide the visible location and help types");
});

test("finder cards express help types in text instead of hover-only colored dots", () => {
  assert.match(app, /const aidLabels = allTypes\(resource\)\.map\(\(type\) => categories\[type\]\.label\)\.join\(" · "\)/);
  assert.match(app, /<span class="resource-row__aid">\$\{aidLabels\}<\/span>/);
  assert.doesNotMatch(app, /const aidDots =/);
});

test("result links participate in the existing grid and its small-screen override", () => {
  assert.doesNotMatch(css, /\.resource-row button/);
  assert.match(css, /\.resource-list-head,\s*\.resource-row :is\(button, \.result-row-link\)\s*\{\s*display: grid/);
  const finalMobile = css.lastIndexOf("@media (max-width: 600px)");
  assert.match(css.slice(finalMobile), /\.resource-row__aid\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/);
  assert.match(css.slice(finalMobile), /\.resource-row :is\(button, \.result-row-link\)\s*\{\s*grid-template-columns: minmax\(0, 1fr\) 1\.5rem;/);
});
