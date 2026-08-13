import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const HOME_TITLE = "Find Essential Services Near You | Real World Needs";

test("production homepage uses the institutional presentation and aligned search language", async () => {
  const [html, bootstrap] = await Promise.all([
    readFile("dist/index.html", "utf8"),
    readFile("dist/src/bootstrap.js", "utf8")
  ]);
  assert.match(html, new RegExp(`<title>${HOME_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
  assert.match(html, /<html lang="en" class="rwn-professional">/);
  assert.match(html, /<h1>Find food, shelter, health care and other essentials\.<\/h1>/);
  assert.match(html, /\/src\/clarity\.css\?v=[a-f0-9]{12}/);
  assert.doesNotMatch(html, /\/src\/professional\.css\?v=/);
  assert.doesNotMatch(html, /<script[^>]+src="\/src\/professional\.js/);
  assert.match(bootstrap, /import\("\.\/professional\.js\?v=[a-f0-9]{12}"\)/);
  assert.match(html, /twitter:card[^>]+summary_large_image/i);
  assert.match(html, /og:image[^>]+earth-blue-marble\.jpg/i);
});

test("generated directory, service, and trust pages share the same professional system", async () => {
  const pages = [
    "dist/directory/index.html",
    "dist/service/whitechapel-mission/index.html",
    "dist/sources/index.html",
    "dist/transparency.html"
  ];

  for (const path of pages) {
    const html = await readFile(path, "utf8");
    assert.match(html, /\/professional-pages\.css\?v=[a-f0-9]{12}/, `${path} is missing professional page CSS`);
    assert.match(html, /\/brand\/rwn-logo-192\.png/, `${path} is missing the official RWN mark`);
    assert.match(html, /twitter:card[^>]+summary_large_image/i, `${path} is missing Twitter card metadata`);
    assert.match(html, /og:image[^>]+earth-blue-marble\.jpg/i, `${path} is missing social imagery`);
    assert.match(html, /professional-need-links/, `${path} is missing crawlable need navigation`);
  }
});

test("institutional presentation stays intentionally lightweight and release-versioned", async () => {
  const [finalCss, pageCss, release, html] = await Promise.all([
    stat("src/clarity.css"),
    stat("public/professional-pages.css"),
    readFile("dist/data/release.json", "utf8").then(JSON.parse),
    readFile("dist/index.html", "utf8")
  ]);

  assert.ok(finalCss.size < 30_000, `interactive institutional CSS grew to ${finalCss.size} bytes`);
  assert.ok(pageCss.size < 32_000, `generated-page professional CSS grew to ${pageCss.size} bytes`);
  assert.doesNotMatch(html, /\/src\/professional\.css/);
  assert.match(release.presentationRelease || "", /^[a-f0-9]{12}$/);
  assert.equal(release.presentationRelease, release.release);
});
