import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public policy pages are indexable, titled, and canonical", async () => {
  for (const [path, title] of [
    ["public/privacy.html", "Privacy | Real World Needs"],
    ["public/terms.html", "Terms | Real World Needs"],
    ["public/accessibility.html", "Accessibility | Real World Needs"],
    ["public/editorial-policy.html", "How Listings Are Checked | Real World Needs"]
  ]) {
    const html = await readFile(path, "utf8");
    assert.match(html, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.realworldneeds\.org\//);
    assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/i);
    assert.match(html, /href="\/"/);
    assert.match(html, /href="\/transparency"/);
  }
});

test("sitemap publishes every policy route", async () => {
  const sitemap = await readFile("public/sitemap.xml", "utf8");
  for (const route of ["/privacy", "/terms", "/accessibility", "/editorial-policy", "/transparency"]) {
    assert.match(sitemap, new RegExp(`<loc>https://www\\.realworldneeds\\.org${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/loc>`));
  }
});

test("production headers minimize referral and browser capability exposure", async () => {
  const config = await readFile("vercel.json", "utf8");
  assert.match(config, /Referrer-Policy/);
  assert.match(config, /strict-origin-when-cross-origin/);
  assert.match(config, /Permissions-Policy/);
  assert.match(config, /geolocation=\(self\)/);
  assert.match(config, /interest-cohort=\(\)/);
});

test("production build has no mutable network download step", async () => {
  const packageJson = await readFile("package.json", "utf8");
  const build = JSON.parse(packageJson).scripts?.build || "";
  assert.doesNotMatch(build, /curl|wget|http[s]?:\/\//i);
});

test("privacy notice discloses the bounded official-source location query", async () => {
  const html = await readFile("public/privacy.html", "utf8");
  assert.match(html, /one decimal degree/);
  assert.match(html, /USDA/);
  assert.match(html, /Esri/);
  assert.match(html, /href="\/directory"/);
  assert.match(html, /href="\/data\/resources\.json"/);
});

test("homepage provides a complete no-JavaScript route", async () => {
  const html = await readFile("index.html", "utf8");
  assert.match(html, /<noscript>/);
  assert.match(html, /href="\/directory"/);
});

test("local preview supports production clean URLs", async () => {
  const server = await readFile("scripts/serve.mjs", "utf8");
  assert.match(server, /resolve\(join\(root, `\$\{relative\}\.html`\)\)/);
  assert.match(server, /resolve\(join\(root, relative, "index\.html"\)\)/);
  assert.match(server, /resolved\.startsWith/);
  assert.match(server, /127\.0\.0\.1/);
  assert.match(server, /join\(root, "404\.html"\)/);
});

test("unknown routes have a useful, non-indexable recovery page", async () => {
  const html = await readFile("public/404.html", "utf8");
  assert.match(html, /<meta name="robots" content="[^"]*noindex[^"]*"/i);
  assert.match(html, /<meta name="robots" content="[^"]*follow[^"]*"/i);
  assert.match(html, /href="\/directory"/);
  assert.match(html, /href="\/directory\/help\/food"/);
  assert.match(html, /<main id="content">/);
});