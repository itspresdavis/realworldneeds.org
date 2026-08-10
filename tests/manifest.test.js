import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("web app manifest exposes task-first essential-help shortcuts", async () => {
  const manifest = JSON.parse(await read("public/site.webmanifest"));
  assert.equal(manifest.name, "Real World Needs");
  assert.equal(manifest.short_name, "RWN");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons?.some((icon) => icon.src === "/rwn-mark.svg" && /maskable/.test(icon.purpose || "")));

  const shortcuts = new Map((manifest.shortcuts || []).map((item) => [item.short_name, item]));
  for (const [name, url] of [
    ["Find help", "/#finder"],
    ["Food", "/directory/help/food"],
    ["Shelter", "/directory/help/shelter"],
    ["Health", "/directory/help/health"],
    ["Directory", "/directory"]
  ]) {
    assert.equal(shortcuts.get(name)?.url, url, `missing installed-app shortcut ${name}`);
    assert.ok(shortcuts.get(name)?.description, `${name} shortcut needs a useful description`);
  }
});

test("manifest shortcut destinations are present in the built site", async () => {
  await read("dist/index.html");
  await read("dist/directory/index.html");
  await read("dist/directory/help/food/index.html");
  await read("dist/directory/help/shelter/index.html");
  await read("dist/directory/help/health/index.html");
});
