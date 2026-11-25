import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");
const routes = ["our-story", "get-involved", "contact", "impact", "donate"];

test("editorial routes have static, crawlable clean-URL navigation and the original brand image", async () => {
  const sitemap = await read("dist/sitemap.xml");
  for (const slug of routes) {
    const html = await read(`dist/${slug}.html`);
    assert.ok(sitemap.includes(`<loc>https://www.realworldneeds.org/${slug}</loc>`));
    assert.ok(html.includes(`rel="canonical" href="https://www.realworldneeds.org/${slug}"`));
    assert.match(html, /src="\/brand\/rwn-logo-192\.png"/);
    assert.match(html, /class="editorial-skip" href="#main"/);
    assert.match(html, /<main id="main" tabindex="-1">/);
    for (const label of ["Primary navigation", "Mobile navigation"]) {
      const nav = html.split(`aria-label="${label}">`)[1]?.split("</nav>")[0];
      assert.equal((nav?.match(/aria-current="page"/g) || []).length, 1, label);
    }
    assert.match(html, /<details class="editorial-mobile-menu">\s*<summary>Menu<\/summary>/);
    assert.doesNotMatch(html, /care-drawing\.svg|editorial-graphic/);
    for (const path of ["/", "/directory", ...routes.map((route) => `/${route}`)]) {
      assert.ok(html.includes(`href="${path}"`));
    }
  }
});

test("homepage supplies a direct text directory route without geolocation, WebGL or JavaScript", async () => {
  const html = await read("dist/index.html");
  const fallback = html.match(/<main class="preboot-finder"[\s\S]*?<\/main>/)?.[0] || "";
  assert.match(fallback, /href="\/directory"><strong>Find Help<\/strong>/);
  for (const slug of routes) assert.ok(fallback.includes(`href="/${slug}"`));
  assert.match(html, /<noscript>/);
});

test("story and contact are independently useful and do not publish private records", async () => {
  const story = await read("dist/our-story.html");
  const contact = await read("dist/contact.html");
  assert.match(story, /Why we started/);
  assert.match(story, /Pastor Donn Fisher/);
  assert.match(story, /Calvary Chapel Raynham/);
  assert.match(story, /Michael Basiliere joined RWN as a partner in August 2026/);
  assert.doesNotMatch(story, /docs\.google\.com|tax-deductible|754/);
  assert.match(contact, /mailto:team@realworldneeds\.org/);
  assert.match(contact, /contact the service provider directly/);
  assert.doesNotMatch(contact, /<form/);
});

test("donations page announces coming soon without receiving payments", async () => {
  const html = await read("dist/donate.html");
  assert.match(html, /type="button" disabled>Donate now <span>· Coming soon<\/span>/);
  assert.doesNotMatch(html, /<form|stripe\.com|paypal\.com|givebutter\.com/);
});

test("impact page has explicit units and a truthful no-script empty state", async () => {
  const html = await read("dist/impact.html");
  assert.match(html, /type="module" src="\/impact\.js"/);
  assert.match(html, /data-impact-value>Not yet published/);
  assert.match(html, /<details class="editorial-impact-details" open>/);
  assert.match(html, /Shoes<small>Pairs<\/small><\/dt><dd data-count="shoes">Not yet published<\/dd>/);
  assert.match(html, /Clean socks<small>Pairs<\/small><\/dt><dd data-count="socks">Not yet published<\/dd>/);
  assert.match(html, /Individual bottles/);
  assert.match(html, /Individual food units, not meals/);
  assert.doesNotMatch(html, /\$0\b/);
  const directory = await read("dist/directory/index.html");
  assert.match(directory, /Start with a need or a place/);
  assert.match(directory, /href="\/directory\/help\/food"/);
});
