import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Run the real navigation functions without executing the build script on dist.
const source = await readFile(new URL("../scripts/professional-seo.mjs", import.meta.url), "utf8");
const start = source.indexOf("function navKey(");
const end = source.indexOf("function unifiedHeader(", start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

for (const path of ["/privacy", "/terms", "/accessibility", "/transparency", "/404", "/missing-page"]) {
  test(`${path} does not falsely announce Find help as the current page`, () => {
    assert.equal(context.navigationLinks(path).includes("aria-current"), false);
  });
}

for (const [path, href] of [["/", "/"], ["/directory", "/directory"], ["/directory/help/food", "/directory"], ["/service/example", "/directory"], ["/editorial-policy", "/editorial-policy"], ["/sources", "/sources"], ["/join", "/join"]]) {
  test(`${path} has exactly its intended primary navigation item current`, () => {
    const links = context.navigationLinks(path);
    assert.equal((links.match(/aria-current="page"/g) || []).length, 1);
    assert.ok(links.includes(`href="${href}" aria-current="page"`));
  });
}
