import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../public/navigation-actions.css', import.meta.url), 'utf8');
const mobile = css.slice(css.indexOf('@media(max-width:900px)'), css.indexOf('@media(max-width:650px)'));
const nav = mobile.match(/\.legal-header\.rwn-unified-header \.rwn-page-menu nav\s*\{([^}]+)\}/)?.[1] || '';

test('generated mobile menu remains bounded by the short dynamic viewport', () => {
  assert.match(nav, /max-height:\s*calc\(100vh - 6rem\)/);
  assert.match(nav, /max-height:\s*calc\(100dvh - 6rem\)/);
  assert.match(nav, /overflow:\s*auto\s*!important/);
  assert.doesNotMatch(nav, /overflow[^:]*:\s*(?:hidden|clip)/);
  assert.match(nav, /overscroll-behavior:\s*contain/);
});

test('generated menu scrollport leaves room around keyboard focus rings', () => {
  assert.match(nav, /padding:\s*\.55rem/);
  assert.match(nav, /scroll-padding-block:\s*\.55rem/);
  assert.match(nav, /scrollbar-width:\s*thin/);
  assert.match(mobile, /\.rwn-page-menu nav::\-webkit-scrollbar\s*\{\s*display:\s*block/);
  assert.match(mobile, /\.rwn-page-menu nav a:focus-visible\s*\{outline:3px solid #356c4e;outline-offset:3px\}/);
});

test('short-height reflow retains generated link targets and every navigation label', async () => {
  assert.match(css, /\.rwn-page-menu nav a\{display:flex;min-height:50px/);
  const html = await readFile(new URL('../dist/directory/index.html', import.meta.url), 'utf8');
  const menu = html.match(/<details class="rwn-page-menu">([\s\S]*?)<\/details>/)?.[1] || '';
  assert.deepEqual([...menu.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([,href,label]) => [href,label]), [
    ['/', 'Find help'], ['/directory', 'Directory'],
    ['/editorial-policy', 'How listings are checked'], ['/sources', 'Sources'], ['/join', 'Contribute']
  ]);
});
