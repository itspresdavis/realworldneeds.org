import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = "https://www.realworldneeds.org";

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (path.endsWith(".html")) files.push(path);
  }
  return files;
}

test("every sitemap page remains indexable and within four static link hops of home", async () => {
  const pages = new Map();
  for (const file of await htmlFiles("dist")) {
    const html = await readFile(file, "utf8");
    const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
    if (!canonical) continue;
    const links = new Set();
    // Inert templates and script strings are not navigation. Native disclosures
    // contain ordinary source anchors and need no script or click to discover.
    const navigable = html.replace(/<(template|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    for (const match of navigable.matchAll(/<a\b[^>]*>/gi)) {
      if (/\brel="[^"]*\bnofollow\b/.test(match[0])) continue;
      const href = match[0].match(/\bhref="([^"]+)"/)?.[1];
      if (!href) continue;
      const url = new URL(href.replaceAll("&amp;", "&"), canonical);
      if (url.origin !== ORIGIN || url.search) continue;
      links.add(`${ORIGIN}${url.pathname}`);
    }
    pages.set(canonical, { html, links });
  }

  const sitemap = await readFile("dist/sitemap.xml", "utf8");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(new Set(urls).size, urls.length, "no duplicate sitemap entries");
  assert.ok(urls.length > 2_000, "exercise the complete generated directory");
  const depths = new Map([[`${ORIGIN}/`, 0]]);
  const queue = [`${ORIGIN}/`];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const target of pages.get(current)?.links || []) {
      if (!pages.has(target) || depths.has(target)) continue;
      depths.set(target, depths.get(current) + 1);
      queue.push(target);
    }
  }

  for (const url of urls) {
    assert.equal(new URL(url).origin, ORIGIN, `${url}: sitemap must use the canonical host`);
    const page = pages.get(url);
    assert.ok(page, `${url}: sitemap entry must have a generated self-canonical page`);
    assert.doesNotMatch(page.html, /name="robots"[^>]*content="[^"]*\bnoindex\b/i, `${url}: sitemap must not include withheld or unindexable pages`);
    assert.ok(depths.has(url), `${url}: missing a static navigation path from home`);
    assert.ok(depths.get(url) <= 4, `${url}: ${depths.get(url)} static hops; keep directory pagination directly reachable`);
  }
});
