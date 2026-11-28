import test from 'node:test';
import assert from 'node:assert/strict';
import { siteFooter } from '../src/utils/site-footer.js';

const currentLinks = html => [...html.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map(match => match[1]);

test('footer authors current-page semantics only for the exact destination', () => {
  for (const path of ['/directory', '/account', '/our-story', '/get-involved', '/donate', '/contact', '/editorial-policy', '/sources', '/privacy', '/terms', '/accessibility']) {
    assert.deepEqual(currentLinks(siteFooter({ currentPath: path })), [path]);
  }
});

test('homepage and scoped listings never claim the directory root is the current page', () => {
  for (const path of ['', '/', '/directory/help/food', '/directory/united-states', '/service/example', '/directory#saved']) {
    assert.deepEqual(currentLinks(siteFooter({ currentPath: path })), []);
  }
  assert.match(siteFooter({ currentPath: '/directory' }), /<a href="\/directory#saved">Saved services<\/a>/);
});

test('current-page input cannot add markup and the optional privacy control is preserved', () => {
  const html = siteFooter({ currentPath: '\" onclick=\"alert(1)', clearBrowserData: true });
  assert.deepEqual(currentLinks(html), []);
  assert.doesNotMatch(html, /onclick|alert/);
  assert.match(html, /<button id="clearBrowserData" type="button">Clear browser data<\/button>/);
  assert.doesNotMatch(siteFooter(), /clearBrowserData/);
});
