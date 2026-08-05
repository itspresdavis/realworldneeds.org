import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const policies = ["privacy", "terms", "accessibility", "editorial-policy"];

test("public policy pages are indexable, titled, and canonical", async () => {
  for (const policy of policies) {
    const html = await readFile(`public/${policy}.html`, "utf8");
    assert.match(html, /<html lang="en">/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www\\.realworldneeds\\.org/${policy}"`));
    assert.match(html, /<title>[^<]+ \| Real World Needs<\/title>/);
    assert.match(html, /<main id="content">/);
    assert.doesNotMatch(html, /lorem ipsum|\[insert|example\.com/i);
  }
});

test("sitemap publishes every policy route", async () => {
  const sitemap = await readFile("public/sitemap.xml", "utf8");
  for (const policy of policies) {
    assert.match(sitemap, new RegExp(`<loc>https://www\\.realworldneeds\\.org/${policy}</loc>`));
  }
});

test("production headers minimize referral and browser capability exposure", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  const globalHeaders = Object.fromEntries(
    config.headers.find((entry) => entry.source === "/(.*)").headers.map(({ key, value }) => [key, value])
  );
  assert.equal(globalHeaders["Referrer-Policy"], "no-referrer");
  assert.equal(globalHeaders["X-Content-Type-Options"], "nosniff");
  assert.match(globalHeaders["Content-Security-Policy"], /default-src 'self'/);
  assert.match(globalHeaders["Permissions-Policy"], /geolocation=\(self\)/);
  assert.match(globalHeaders["Permissions-Policy"], /camera=\(\)/);
});

test("production build has no mutable network download step", async () => {
  const build = await readFile("scripts/build.mjs", "utf8");
  assert.doesNotMatch(build, /\bfetch\s*\(/);
  assert.match(build, /cp\("public", "dist"/);
});

test("local preview supports production clean URLs", async () => {
  const server = await readFile("scripts/serve.mjs", "utf8");
  assert.match(server, /extname\(relative\) \? relative : `\$\{relative\}\.html`/);
  assert.match(server, /candidate\.startsWith/);
  assert.match(server, /127\.0\.0\.1/);
});
