import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function webPath(file) {
  return `/${relative("dist", file).split(sep).join("/")}`;
}

function routeSet(files) {
  const routes = new Set(["/"]);
  for (const file of files) {
    const path = webPath(file);
    routes.add(path);
    if (path.endsWith("/index.html")) routes.add(path.slice(0, -"/index.html".length) || "/");
    if (path.endsWith(".html")) routes.add(path.slice(0, -".html".length));
  }
  return routes;
}

function internalPath(href) {
  if (!href || href.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(href)) return null;
  if (href.startsWith("//")) return null;
  const withoutHash = href.split("#", 1)[0];
  const withoutQuery = withoutHash.split("?", 1)[0];
  if (!withoutQuery.startsWith("/")) return null;
  try {
    return decodeURIComponent(withoutQuery) || "/";
  } catch {
    return withoutQuery || "/";
  }
}

test("every root-relative anchor in the generated site resolves to a generated route or asset", async () => {
  const files = await walk("dist");
  const routes = routeSet(files);
  const htmlFiles = files.filter((file) => extname(file) === ".html");
  const failures = [];
  let checked = 0;

  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const hrefs = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((match) => match[1]);
    for (const href of hrefs) {
      const target = internalPath(href);
      if (!target) continue;
      checked += 1;
      if (!routes.has(target) && !routes.has(target.replace(/\/$/, ""))) {
        failures.push(`${webPath(file)} -> ${href}`);
        if (failures.length >= 25) break;
      }
    }
    if (failures.length >= 25) break;
  }

  assert.ok(checked > 5_000, `expected to verify thousands of generated navigation links, checked ${checked}`);
  assert.deepEqual(failures, [], `broken internal links:\n${failures.join("\n")}`);
});
