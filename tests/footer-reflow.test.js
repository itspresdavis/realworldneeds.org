import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { siteFooter } from '../src/utils/site-footer.js';

test('map and generated pages share the compact footer destinations', async () => {
  const expected = ['/', '/directory', '/directory#saved', '/account', '/our-story', '/get-involved', '/donate', '/contact', '/editorial-policy', '/sources', '/privacy', '/terms', '/accessibility'];
  const footers = [siteFooter({ clearBrowserData: true })];
  for (const path of ['directory/index.html', 'service/whitechapel-mission/index.html', 'our-story.html', 'impact.html', 'privacy.html', 'terms.html', 'accessibility.html']) {
    const html = await readFile(`dist/${path}`, 'utf8');
    const footer = html.match(/<footer class="rwn-site-footer">[\s\S]*?<\/footer>/)?.[0];
    assert.ok(footer, `${path} has its shared footer`);
    footers.push(footer);
  }
  for (const footer of footers) {
    assert.deepEqual([...footer.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]), expected);
    assert.equal([...footer.matchAll(/<nav /g)].length, 3);
  }
  assert.match(footers[0], /id="clearBrowserData"/);
  assert.match(await readFile('src/app.js', 'utf8'), /siteFooter\(\{ clearBrowserData: true \}\)/);
});
