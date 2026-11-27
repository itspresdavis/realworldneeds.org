import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("function initialResultCount()"), source.indexOf("function loadSavedResources()"));
test("initial result density follows viewport breakpoints without forcing an innerWidth layout read", () => {
  let width;
  const window = {
    get innerWidth() { throw new Error("Layout-triggering read after DOM writes"); },
    matchMedia(query) { return { matches: width <= Number(query.match(/\d+/)[0]) }; }
  };
  const context = vm.createContext({ window });
  vm.runInContext(body, context);
  for (const [viewport, expected] of [[320,5],[600,5],[601,6],[900,6],[901,8],[1920,8]]) {
    width = viewport;
    assert.equal(context.initialResultCount(), expected);
  }
});
