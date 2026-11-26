import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { siteHeader } from '../scripts/site-shell.mjs';
import { translateInterfaceText } from '../src/utils/interface-copy.js';

test('every public surface keeps the same navigation destinations and order', () => {
  const expected = ['/', '/impact', '/our-story', '/get-involved', '/contact'];
  for (const path of ['/', '/directory', '/directory/page/2', '/service/bowery-mission', '/our-story', '/get-involved', '/contact', '/impact', '/donate']) {
    const header = siteHeader(path);
    const navs = [...header.matchAll(/<nav[^>]*>([\s\S]*?)<\/nav>/g)];
    assert.equal(navs.length, 2, path);
    for (const [, nav] of navs) {
      assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]), expected, path);
      assert.equal((nav.match(/lang="es"/g) || []).length, expected.length, path);
    }
    assert.equal((header.match(/rwn-language-control/g) || []).length, 1);
  }
});

test('map boot leaves the build-rendered header and its controls outside its root', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  assert.ok(html.indexOf('class="rwn-site-header"') < html.indexOf('id="root"'));
  assert.equal((html.match(/class="rwn-site-header"/g) || []).length, 1);
  assert.equal((html.match(/data-language-control/g) || []).length, 1);
  assert.match(html, /language-preference\.[a-f0-9]{12}\.js/);
  const app = await readFile('src/app.js', 'utf8');
  assert.doesNotMatch(app, /<header|class="site-menu"/);
});

test('Spanish retains provider identity and the exact free-service income condition', () => {
  assert.equal(translateInterfaceText('Why RWN?', 'es'), '¿Por qué RWN?');
  assert.equal(translateInterfaceText('Contact RWN', 'es'), 'Contacta a RWN');
  assert.equal(translateInterfaceText('227 Bowery, New York, NY 10002', 'es'), '227 Bowery, New York, NY 10002');
  const cost = translateInterfaceText('Free with eligibility — Free Title X services for clients with family income at or below 100% of the federal poverty level.', 'es');
  assert.match(cost, /iguales o inferiores al 100 %/);
  assert.match(cost, /Título X/);
  assert.equal(translateInterfaceText('Unreviewed provider instructions', 'es'), 'Unreviewed provider instructions');
  assert.equal(translateInterfaceText('Call 989-426-9431 for Central Michigan District Health Department — Title X', 'es'), 'Llamar a Central Michigan District Health Department — Title X al 989-426-9431');
});


test('old transparency routes lead to the combined page with its disclosures and data links', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  for (const source of ['/transparency', '/transparency.html']) {
    const redirect = config.redirects.find(item => item.source === source);
    assert.equal(redirect?.destination, '/our-story#transparency');
    assert.equal(redirect?.permanent, true);
  }
  const html = await readFile('dist/our-story.html', 'utf8');
  for (const id of ['transparency', 'scope', 'quality', 'data', 'privacy', 'governance', 'technology']) assert.ok(html.includes(`id="${id}"`), id);
  for (const href of ['/directory', '/sources', '/directory.csv', '/data/resources.json', '/data/release.json', '/editorial-policy', '/contact']) assert.ok(html.includes(`href="${href}"`), href);
  assert.doesNotMatch(await readFile('dist/sitemap.xml', 'utf8'), /<loc>[^<]*\/transparency<\/loc>/);
});
