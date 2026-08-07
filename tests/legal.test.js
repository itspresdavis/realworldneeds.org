import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const policies = ["privacy", "terms", "accessibility", "editorial-policy", "transparency"];

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
  assert.match(sitemap, /<loc>https:\/\/www\.realworldneeds\.org\/directory<\/loc>/);
});

test("production headers minimize referral and browser capability exposure", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  const globalHeaders = Object.fromEntries(
    config.headers.find((entry) => entry.source === "/(.*)").headers.map(({ key, value }) => [key, value])
  );
  assert.equal(globalHeaders["Referrer-Policy"], "no-referrer");
  assert.equal(globalHeaders["X-Content-Type-Options"], "nosniff");
  assert.match(globalHeaders["Content-Security-Policy"], /default-src 'self'/);
  assert.match(globalHeaders["Content-Security-Policy"], /connect-src 'self' https:\/\/services1\.arcgis\.com/);
  assert.match(globalHeaders["Permissions-Policy"], /geolocation=\(self\)/);
  assert.match(globalHeaders["Permissions-Policy"], /camera=\(\)/);
  assert.equal(config.rewrites, undefined);
});

test("production build has no mutable network download step", async () => {
  const build = await readFile("scripts/build.mjs", "utf8");
  assert.doesNotMatch(build, /\bfetch\s*\(/);
  assert.match(build, /cp\("public", "dist"/);
  assert.match(build, /writePagedDirectory\("dist\/directory", "\/directory"/);
  assert.match(build, /dist\/data\/resources\.json/);
  assert.match(build, /dist\/data\/map-index\.json/);
  assert.match(build, /dist\/data\/sources\.json/);
});

test("privacy notice discloses the bounded official-source location query", async () => {
  const html = await readFile("public/privacy.html", "utf8");
  assert.match(html, /rounds latitude and longitude to one decimal degree/);
  assert.match(html, /public USDA Food and Nutrition Service ArcGIS (?:map|layer)/);
  assert.match(html, /happens only after you approve location/);
});

test("homepage provides a complete no-JavaScript route", async () => {
  const html = await readFile("index.html", "utf8");
  assert.match(html, /<noscript>/);
  assert.match(html, /href="\/directory"/);
  assert.match(html, /href="\/data\/resources\.json"/);
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
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.match(html, /href="\/directory"/);
  assert.match(html, /<main id="content">/);
});
