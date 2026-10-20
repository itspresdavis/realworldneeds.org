import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const ORIGIN = "https://www.realworldneeds.org";
const sitemap = await readFile("dist/sitemap.xml", "utf8");
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
const collectionPaths = paths.filter((path) => path === "/directory" || path.startsWith("/directory/") && !path.startsWith("/directory/local/"));
const pageHref = (base, number) => number === 1 ? base : `${base}/page/${number}`;
const pagination = (html) => [...html.matchAll(/<nav class="directory-downloads directory-pagination"[^>]*>([\s\S]*?)<\/nav>/g)].map((match) => match[1]);

test("every paginated collection has crawlable page choices and correct previous, next, and current-page states", async () => {
  const groups = new Map();
  for (const path of collectionPaths) {
    const base = path.replace(/\/page\/\d+$/, "");
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(path);
  }
  let checked = 0;
  for (const [base, members] of groups) {
    for (const path of members) {
      const page = Number(path.match(/\/page\/(\d+)$/)?.[1] || 1);
      const html = await readFile(`dist${path}/index.html`, "utf8");
      const navs = pagination(html);
      if (members.length === 1) {
        assert.equal(navs.length, 0, `${path}: single-page collections need no pager`);
        continue;
      }
      checked += 1;
      assert.equal(navs.length, 2, `${path}: pagination belongs above and below listings`);
      assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}${path}"`), `${path}: pages remain self-canonical`);
      for (const nav of navs) {
        assert.ok(nav.includes(`<span>Page ${page} of ${members.length}</span>`), path);
        const previous = nav.match(/<a rel="prev" href="([^"]+)">Previous<\/a>/)?.[1];
        const next = nav.match(/<a rel="next" href="([^"]+)">Next<\/a>/)?.[1];
        assert.equal(previous, page > 1 ? pageHref(base, page - 1) : undefined, `${path}: previous page`);
        assert.equal(next, page < members.length ? pageHref(base, page + 1) : undefined, `${path}: next page`);
        assert.match(nav, /<details class="directory-page-picker"><summary>Choose a page<\/summary>/, `${path}: closed native disclosure`);
        const list = nav.match(/<ol class="directory-page-list">([\s\S]*?)<\/ol>/)?.[1];
        assert.ok(list, `${path}: page list is present in initial HTML`);
        assert.equal([...list.matchAll(/<li>/g)].length, members.length, `${path}: each actual page is offered`);
        assert.equal([...list.matchAll(/aria-current="page"/g)].length, 1, `${path}: exactly one current page`);
        assert.ok(list.includes(`<span aria-current="page" aria-label="Page ${page}, current page">${page}</span>`), path);
        const actual = [...list.matchAll(/<a href="([^"]+)" aria-label="Page (\d+)">(\d+)<\/a>/g)];
        const expected = Array.from({ length: members.length }, (_, i) => i + 1).filter((n) => n !== page);
        assert.deepEqual(actual.map((match) => Number(match[2])), expected, `${path}: ascending labeled pages`);
        for (const match of actual) {
          assert.equal(match[1], pageHref(base, Number(match[2])), path);
          assert.equal(match[2], match[3], `${path}: visible and accessible page labels agree`);
          assert.ok(members.includes(match[1]), `${path}: page choice must exist`);
          assert.doesNotMatch(match[1], /[?#]|\/page\/1$/, `${path}: no duplicate query, fragment, or page-one URL`);
        }
      }
    }
  }
  assert.equal(checked, 42, `expected the paginated states that remain after withheld rows, checked ${checked}`);
});

test("the full directory makes every browse page one link away without loading the entire catalog", async () => {
  const first = await readFile("dist/directory/index.html", "utf8");
  const choices = pagination(first)[0];
  const later = paths.filter((path) => /^\/directory\/page\/\d+$/.test(path));
  assert.equal(later.length, 8, "the full directory still paginates past the first 60 listings");
  for (const path of later) assert.ok(choices.includes(`href="${path}"`), `first page must link directly to ${path}`);
  assert.equal([...first.matchAll(/<article class="directory-record"/g)].length, 60, "keep the 60-listing payload boundary");
});

test("page choices retain native focus behavior, wrap on narrow screens, and stay out of filtered or Saved results", async () => {
  const [css, searchCss, savedCss] = await Promise.all([
    readFile("public/professional-pages.css", "utf8"),
    readFile("public/directory-enhancements.css", "utf8"),
    readFile("public/saved-services.css", "utf8")
  ]);
  assert.match(css, /:where\([^)]*summary[^)]*\):focus-visible\s*\{[^}]*outline:\s*3px/);
  assert.match(css, /\.directory-page-picker\s*\{[^}]*flex-basis:100%;[^}]*min-width:0/);
  assert.match(css, /\.directory-page-list\s*\{[^}]*display:flex;[^}]*flex-wrap:wrap/);
  assert.match(css, /\.directory-page-list \[aria-current="page"\]\s*\{[^}]*min-width:44px;[^}]*min-height:44px/);
  assert.match(searchCss, /\.directory-shell\.has-global-search nav\[aria-label="Directory pages"\]\{display:none\}/);
  assert.match(savedCss, /\.has-saved-view\s*>\s*:not\(\.saved-services\):not\(#offlineDirectoryNotice\):not\(\[aria-label="Breadcrumb"\]\)\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});
