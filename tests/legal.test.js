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
  for (const route of ["/privacy", "/terms", "/accessibility", "/editorial-policy", "/our-story"]) {
    assert.match(sitemap, new RegExp(`<loc>https://www\\.realworldneeds\\.org${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/loc>`));
  }
});

test("production headers minimize referral and browser capability exposure", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  const catchAll = config.headers.find((entry) => entry.source === "/(.*)");
  assert.ok(catchAll, "expected a catch-all production header policy");
  const headers = Object.fromEntries(catchAll.headers.map(({ key, value }) => [key.toLowerCase(), value]));

  assert.ok(["no-referrer", "strict-origin-when-cross-origin"].includes(headers["referrer-policy"]), `unexpected Referrer-Policy: ${headers["referrer-policy"]}`);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(headers["cross-origin-resource-policy"], "same-origin");
  assert.match(headers["strict-transport-security"] || "", /max-age=63072000/);

  const permissions = headers["permissions-policy"] || "";
  assert.match(permissions, /geolocation=\(self\)/);
  for (const capability of ["camera", "microphone", "payment", "usb", "gyroscope", "magnetometer"]) {
    assert.match(permissions, new RegExp(`${capability}=\\(\\)`), `${capability} should be disabled`);
  }

  const csp = headers["content-security-policy"] || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
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
  assert.match(html, /exact coordinates stay in browser memory/);
  assert.match(html, /not saved, added to a shared link, or sent to an RWN database/);
  assert.match(html, /request happens only after you approve location/);
  assert.match(html, /roughly 11 kilometres of latitude/);
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
  assert.doesNotMatch(html, /<meta name="robots" content="[^"]*nofollow[^"]*"/i);
  assert.match(html, /href="\/directory"/);
  assert.match(html, /href="\/directory\/help\/food"/);
  assert.match(html, /<main id="content">/);
});