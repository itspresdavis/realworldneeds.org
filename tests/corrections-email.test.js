import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const EMAIL = ["PLACEHOLDER-corrections", "realworldneeds.org"].join("@");
const SKIP = new Set(["node_modules", "dist", ".git", "qa-screenshots"]);

async function sourceFiles(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await sourceFiles(path, found);
    else if (/\.(?:js|mjs|html|css|json|md)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test("the corrections address is one config constant", async () => {
  const hits = [];
  for (const path of await sourceFiles(".")) {
    const text = await readFile(path, "utf8");
    if (text.includes(EMAIL)) hits.push(path.split("\\").join("/"));
  }
  assert.deepEqual(hits, ["src/data/corrections.js"]);
  const config = await readFile("src/data/corrections.js", "utf8");
  assert.match(config, new RegExp(`export const CORRECTIONS_EMAIL = "${EMAIL}";`));
  for (const path of ["public/editorial-policy.html", "public/privacy.html"]) {
    assert.match(await readFile(path, "utf8"), /\{\{CORRECTIONS_EMAIL\}\}/);
  }
  for (const path of ["scripts/build.mjs", "scripts/professional-seo.mjs", "src/professional.js"]) {
    assert.match(await readFile(path, "utf8"), /from "\.\.?\/(?:src\/)?data\/corrections\.js"/);
  }
});
