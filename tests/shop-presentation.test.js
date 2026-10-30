import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PAGE_MENU_REFLOW_LINKS } from '../scripts/qa-page-menu-reflow.mjs';

const source = await readFile('scripts/professional-seo.mjs', 'utf8');
const template = await readFile('public/shop.html', 'utf8');
const css = await readFile('public/shop.css', 'utf8');
// Exercise the real page transform without generating or changing dist.
const presentation = vm.createContext({ resources: [], URL });
vm.runInContext(source.slice(0, source.indexOf('const releasePath =')).replace(/^import .*;\n/gm, ''), presentation);
const html = presentation.enhanceGeneratedPage(template, 'abcdef123456');

function links(markup) {
  return [...markup.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([,href,label]) => [href,label]);
}

test('Shop uses the shared navigation with its own current page and Contribute last', () => {
  const desktop = html.match(/<nav class="rwn-page-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  const mobile = html.match(/<nav aria-label="Mobile navigation">([\s\S]*?)<\/nav>/)?.[1];
  for (const nav of [desktop, mobile]) {
    assert.ok(nav);
    assert.deepEqual(links(nav), PAGE_MENU_REFLOW_LINKS);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
    assert.match(nav, /href="\/shop" aria-current="page">Shop/);
    assert.doesNotMatch(nav, /href="\/" aria-current/);
    assert.deepEqual(links(nav).at(-1), ['/join','Contribute']);
  }
  const footer = html.match(/<footer class="legal-footer rwn-unified-footer">([\s\S]*?)<\/footer>/)?.[1] || '';
  assert.match(footer, /href="\/shop" aria-current="page">Shop/);
  for (const landmark of ['Footer find help', 'Footer about RWN', 'Footer policies', 'Browse essential services by need']) assert.ok(footer.includes(`aria-label="${landmark}"`));
  assert.match(html, /src="\/page-menu\.js\?v=abcdef123456"/);
  assert.match(html, /href="\/directory#saved" aria-label="Open saved services"/);
});

test('Shop is an accessible coming-soon preview without commerce or data collection', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<h1 id="shop-heading">Coming Soon<\/h1>/);
  assert.match(html, /<main id="shop"[^>]*aria-labelledby="shop-heading"[^>]*tabindex="-1"/);
  assert.match(html, /class="skip-link" href="#shop"/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.realworldneeds\.org\/shop"/);
  assert.ok((html.match(/name="description" content="([^"]+)"/)?.[1].length || 0) >= 40);
  assert.doesNotMatch(html, /<form\b|<input\b|<iframe\b|checkout|add to cart|buy now|sign up|subscribe|"@type"\s*:\s*"(?:Product|Offer)"/i);
  assert.doesNotMatch(html, /\bnoindex\b|\$\d/);
});

test('the exact supplied front-and-back render is preserved and never cropped by its presentation', async () => {
  const image = await readFile('public/media/shop-coming-soon.jpg');
  assert.equal(createHash('sha256').update(image).digest('hex'), '0319dc4dbf5e12b28074bfe4875a0018dfea51e1c5ba8f8127e8f8a8769d6f68');
  assert.match(html, /src="\/media\/shop-coming-soon\.jpg" width="1312" height="1199" alt="Render of forest-green RWN shirts, showing the front and back designs on concrete\."/);
  assert.match(css, /\.shop-poster img\{[^}]*width:100%;height:auto;aspect-ratio:1312\/1199;object-fit:contain/);
  assert.doesNotMatch(css, /object-fit:\s*cover|overflow:\s*hidden/);
  assert.match(css, /\.shop-poster h1\{[^}]*background:#f5f3ed;color:#17362d/);
  assert.ok(Buffer.byteLength(css) < 2_000, 'the static poster needs no large presentation bundle');
});

test('only Shop uses the supplied image in social previews', () => {
  const ordinary = presentation.enhanceGeneratedPage(template.replaceAll('/shop"','/privacy"'), 'abcdef123456');
  for (const key of ['og:image', 'twitter:image']) {
    assert.match(html, new RegExp(`${key}" content="https://www\\.realworldneeds\\.org/media/shop-coming-soon\\.jpg"`));
    assert.match(ordinary, new RegExp(`${key}" content="https://www\\.realworldneeds\\.org/media/earth-blue-marble\\.jpg"`));
  }
  assert.match(html, /og:image:alt" content="Render of forest-green RWN shirts, showing the front and back designs"/);
  assert.match(ordinary, /og:image:alt" content="Real World Needs essential services directory"/);
});

test('Shop is included in the sitemap without claiming a service review date', async () => {
  const build = await readFile('scripts/build.mjs', 'utf8');
  assert.match(build, /const sitemapPaths = \[[^\]]*"\/shop"/);
  const expression = build.split('\n').find(line => line.startsWith('const sitemap ='));
  assert.ok(expression);
  const xml = vm.runInNewContext(`${expression}\nsitemap`, { sitemapPaths: ['/shop','/directory'], SITE_ORIGIN:'https://www.realworldneeds.org', latestReview:'2026-10-01' });
  assert.match(xml, /<url><loc>https:\/\/www\.realworldneeds\.org\/shop<\/loc><\/url>/);
  assert.match(xml, /<url><loc>https:\/\/www\.realworldneeds\.org\/directory<\/loc><lastmod>2026-10-01<\/lastmod><\/url>/);
});

test('short Shop labels retain a 44px primary navigation target on every shared header', async () => {
  const navigation = await readFile('public/navigation-actions.css', 'utf8');
  assert.match(navigation, /\.rwn-professional \.primary-nav a,\.rwn-page-nav a\{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center\}/);
  assert.match(navigation, /\.rwn-professional \.brand,\.legal-brand\{min-height:44px\}/);
  assert.ok(Buffer.byteLength(navigation) <= 12_000, 'shared navigation retains its byte budget');
});
