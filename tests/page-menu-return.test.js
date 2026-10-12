import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/page-menu.js', import.meta.url), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return ''; // Baseline has no generated-header lifecycle owner.
  throw error;
});

function fixture({ open = true, active = 'link', narrow = true, present = true } = {}) {
  const events = {}, focused = [], mutations = [];
  const rect = visible => ({ width: visible ? 80 : 0, height: visible ? 44 : 0, top: 10, bottom: 54 });
  const nodes = Object.fromEntries(['summary', 'link', 'brand', 'desktop', 'input', 'result', 'body'].map(name => [name, {
    name, getBoundingClientRect: () => rect(name === 'summary' ? narrow : name === 'desktop' ? !narrow : true),
    focus(options) { focused.push({ name, options: JSON.parse(JSON.stringify(options)) }); document.activeElement = this; }
  }]));
  const header = { querySelectorAll: () => [nodes.brand, nodes.desktop] };
  const menu = { open, contains: node => [nodes.summary, nodes.link].includes(node),
    removeAttribute(name) { assert.equal(name, 'open'); mutations.push(name); this.open = false; },
    querySelector: () => nodes.summary, closest: () => header };
  const document = { activeElement: nodes[active], querySelector(selector) { assert.equal(selector, '.rwn-page-menu'); return present ? menu : null; } };
  const context = { document, window: { innerHeight: 844, addEventListener(type, fn) { (events[type] ||= []).push(fn); } },
    getComputedStyle: () => ({ visibility: 'visible' }) };
  vm.runInNewContext(source, context);
  const fire = (type, event = {}) => { for (const fn of events[type] || []) fn(event); };
  return { nodes, menu, document, focused, mutations, events, fire };
}

test('persisted cross-document return closes retained menu and repairs only its hidden focus', () => {
  const f = fixture();
  f.fire('pageshow', { persisted: true });
  assert.equal(f.menu.open, false, 'native retained details must not cover the restored page');
  assert.equal(f.document.activeElement, f.nodes.summary);
  assert.deepEqual(f.focused, [{ name: 'summary', options: { preventScroll: true } }]);
  assert.deepEqual(f.mutations, ['open']);
});

test('fresh pageshow preserves a deliberately opened menu and focus', () => {
  for (const active of ['link', 'summary', 'input']) {
    const f = fixture({ active });
    f.fire('pageshow', { persisted: false });
    assert.equal(f.menu.open, true);
    assert.equal(f.document.activeElement, f.nodes[active]);
    assert.deepEqual(f.mutations, []);
    assert.deepEqual(f.focused, []);
  }
});

test('persisted return never steals deliberate query, result, header or body focus', () => {
  for (const active of ['input', 'result', 'brand', 'body']) {
    const f = fixture({ active });
    f.fire('pageshow', { persisted: true });
    assert.equal(f.menu.open, false);
    assert.equal(f.document.activeElement, f.nodes[active]);
    assert.deepEqual(f.focused, []);
  }
});

test('return after a desktop resize uses a visible header fallback instead of hidden summary', () => {
  const f = fixture({ narrow: false });
  f.fire('pageshow', { persisted: true });
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.nodes.brand);
  assert.deepEqual(f.focused, [{ name: 'brand', options: { preventScroll: true } }]);
});

test('closed menus, missing generated headers and unrelated same-document events remain untouched', () => {
  for (const options of [{ open: false }, { present: false }]) {
    const f = fixture(options);
    f.fire('pageshow', { persisted: true });
    assert.deepEqual(f.focused, []);
    assert.deepEqual(f.mutations, []);
  }
  const f = fixture();
  for (const type of ['click', 'keydown', 'hashchange', 'popstate', 'pagehide']) f.fire(type, { key: 'Escape', persisted: true });
  assert.equal(f.menu.open, true);
  assert.deepEqual(Object.keys(f.events), ['pageshow']);
});

test('menu can reopen normally and each later retained return repairs it once', () => {
  const f = fixture();
  f.fire('pageshow', { persisted: true });
  f.fire('pageshow', { persisted: true });
  assert.equal(f.focused.length, 1);
  f.menu.open = true;
  f.document.activeElement = f.nodes.link;
  f.fire('pageshow', { persisted: true });
  assert.equal(f.menu.open, false);
  assert.equal(f.focused.length, 2);
});

test('generated header lifecycle is bounded and does not write browsing state or navigate', () => {
  assert.ok(Buffer.byteLength(source) <= 1_000, 'shared generated header lifecycle stays under 1 KB');
  assert.doesNotMatch(source, /localStorage|sessionStorage|history\.|location\.|scrollTo|scrollIntoView|fetch\(|setTimeout|requestAnimationFrame|preventDefault|querySelectorAll\([^)]*directory/);
});

test('local, global, service and trust pages load the same byte-addressed controller once', async () => {
  const release = JSON.parse(await readFile('dist/data/release.json', 'utf8'));
  const asset = release.offlineAssets['/page-menu.js'];
  assert.match(asset || '', /^\/page-menu\.[a-f0-9]{12}\.js$/);
  assert.equal(await readFile(`dist${asset}`, 'utf8'), source);
  for (const path of ['directory/index.html', 'directory/local/united-states/new-york/help/referral/index.html',
    'service/new-york-public-library-access/index.html', 'sources/index.html', 'editorial-policy.html', 'transparency.html']) {
    const html = await readFile(`dist/${path}`, 'utf8');
    assert.equal(html.split(`src="${asset}?v=`).length - 1, 1, path);
    assert.doesNotMatch(html, /<details class="rwn-page-menu" open/, path);
  }
  const home = await readFile('dist/index.html', 'utf8');
  assert.ok(!home.includes('src="/page-menu.'), 'homepage keeps its existing menu owner');
});
