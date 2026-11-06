import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { menuViewports } from '../scripts/qa-menu-reflow.mjs';

const css = await readFile(new URL('../src/clarity.css', import.meta.url), 'utf8');
const mobile = css.slice(css.search(/@media \(max-width:\s*900px\)/));
const nav = mobile.match(/\.rwn-professional \.site-menu nav \{([^}]+)\}/)?.[1] || '';

test('mobile menu is bounded by the full header instead of the summary control', () => {
  assert.match(mobile, /\.rwn-professional \.site-menu \{ position:\s*static;/);
  assert.match(nav, /width:\s*min\(17rem, calc\(100% - 2rem\)\)/);
  assert.match(nav, /min-width:\s*0/);
});

test('short menus reserve their actual wrapped header height before scrolling links', () => {
  assert.match(nav, /max-height:\s*calc\(100vh - 100% - \.9rem\)/);
  assert.match(nav, /max-height:\s*calc\(100dvh - 100% - \.9rem\)/);
  assert.match(nav, /top:\s*calc\(100% \+ \.45rem\)/);
  assert.match(nav, /overflow:\s*auto/);
  assert.doesNotMatch(nav, /overflow[^:]*:\s*(hidden|clip)/);
  assert.match(nav, /scroll-padding-block/);
});

test('rendered menu coverage includes narrow, short, landscape and zoom-sized viewports', async () => {
  for (const expected of [[320, 379], [320, 250], [568, 250], [320, 189], [900, 250]]) {
    assert.ok(menuViewports.some((viewport) => viewport[0] === expected[0] && viewport[1] === expected[1]));
  }
  const runner = await readFile(new URL('../scripts/browser-institutional.mjs', import.meta.url), 'utf8');
  assert.match(runner, /await verifyMenuReflow\(/);
});
