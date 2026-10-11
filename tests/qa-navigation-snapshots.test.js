import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { localDirectorySnapshot } from '../scripts/qa-local-search.mjs';
import { directoryDiscoverySnapshot } from '../scripts/qa-directory-discovery.mjs';
import { footerReflowSnapshot } from '../scripts/qa-footer-reflow.mjs';

// These are the actual functions serialized by the CI browser helpers. Do not
// duplicate their snapshot expressions or use a browser to test partial DOMs.
const read = (snapshot, globals, args = []) => vm.runInNewContext(`(${snapshot.toString()})(...${JSON.stringify(args)})`, { URL, ...globals });
const node = (text = '', attrs = {}, box = {}) => ({
  textContent: text, dataset: {}, hidden: false, children: [], scrollWidth: 100, clientWidth: 100,
  getAttribute: name => attrs[name] ?? null, href: attrs.href ? `http://127.0.0.1:4175${attrs.href}` : undefined,
  getBoundingClientRect: () => ({ x: 12, y: 100, left: 12, right: 212, top: 100, bottom: 144, width: 200, height: 44, ...box }),
  classList: { contains: () => false }, matches: () => false, scrollIntoView() {}
});
function fixture() {
  const path = '/directory/local/united-states/new-york';
  const link = node('New York library', { href: '/service/new-york-public-library-access' });
  const input = node(); input.value = 'library';
  const category = node('All help'); category.dataset.directoryCategory = '';
  const hiddenMore = node('', {}, { width: 0, height: 0 }); hiddenMore.hidden = true;
  const nodes = new Map([
    ['[data-directory-query]', input], ['[data-directory-category][aria-pressed="true"]', category],
    ['.directory-global-results', node()], ['.directory-shell.has-global-search', node()],
    ['.directory-records > .directory-record', node()], ['[data-directory-count]', node('1 matching listing')],
    ['[data-directory-more]', hiddenMore], ['h1', node('Free help in New York')],
    ['.legal-header', node('', {}, { bottom: 66 })]
  ]);
  const root = { scrollWidth: 390, clientWidth: 390 };
  const document = {
    documentElement: root, body: {}, title: 'New York directory', activeElement: link,
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => ['.directory-global-result', '.directory-records > .directory-record h2 a'].includes(selector) ? [link] : []
  };
  const globals = {
    document, location: { href: `http://127.0.0.1:4175${path}`, pathname: path }, performance: { timeOrigin: 123 },
    history: { state: { rwnDirectory: { path, query: 'library', category: '' } } }, innerWidth: 390, innerHeight: 844, scrollY: 300,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', overflowX: 'visible', fontSize: '14px' })
  };
  return { globals, nodes, link, input, root };
}

for (const [name, snapshot] of [['local', localDirectorySnapshot], ['discovery', directoryDiscoverySnapshot]]) {
  test(`${name} snapshot treats a provisional null documentElement/body as unready`, () => {
    const f = fixture();
    f.globals.document.documentElement = null; f.globals.document.body = null;
    f.globals.document.activeElement = null; f.globals.document.querySelector = () => null; f.globals.document.querySelectorAll = () => [];
    const state = read(snapshot, f.globals);
    assert.equal(state.documentPresent, false); assert.equal(state.ready, false);
    assert.equal(state.overflow, null); assert.equal(state.rows.length, 0);
    assert.equal(state.more, false); assert.equal(state.focusVisible, false);
    if (name === 'local') assert.equal(state.inputFocused, false);
  });
  test(`${name} snapshot handles missing document/location/time origin without inventing readiness`, () => {
    const state = read(snapshot, {});
    assert.equal(state.path, ''); assert.equal(state.href, ''); assert.equal(state.timeOrigin, null);
    assert.equal(state.documentPresent, false); assert.equal(state.ready, false); assert.equal(state.more, false);
  });
  test(`${name} snapshot retains exact result identity, scope, history, visible focus and geometry`, () => {
    const f = fixture(), state = read(snapshot, f.globals);
    assert.equal(state.documentPresent, true); assert.equal(state.ready, true);
    assert.equal(state.path, f.globals.location.pathname); assert.equal(state.timeOrigin, 123);
    assert.equal(state.history.query, 'library'); assert.equal(state.query, 'library');
    assert.equal(state.rows[0].href, '/service/new-york-public-library-access'); assert.equal(state.rows.length, 1);
    assert.equal(state.focusVisible, true); assert.equal(state.more, false); assert.equal(state.scroll, 300);
    assert.equal(state.overflow, name === 'local' ? 0 : false);
    if (name === 'local') {
      assert.equal(state.rows[0].id, 'new-york-public-library-access'); assert.equal(state.rows[0].visible, true);
      assert.equal(state.staticIds[0], 'new-york-public-library-access'); assert.equal(state.staticVisible, true);
      assert.equal(state.focused, state.rows[0].href); assert.equal(state.inputFocused, false);
    } else assert.equal(state.focus, state.rows[0].href);
  });
  test(`${name} snapshot does not hide genuine selector errors`, () => {
    const f = fixture(); f.globals.document.querySelector = () => { throw new Error('Broken selector'); };
    assert.throws(() => read(snapshot, f.globals), /Broken selector/);
  });
}

test('local readiness requires runtime controls and a parsed body; null geometry cannot become zero', () => {
  const f = fixture(); f.nodes.delete('.directory-global-results');
  assert.equal(read(localDirectorySnapshot, f.globals).ready, false);
  f.globals.document.body = null;
  assert.equal(read(localDirectorySnapshot, f.globals).documentPresent, false);
  f.globals.document.documentElement = null;
  assert.equal(read(localDirectorySnapshot, f.globals).overflow, null);
});

function footerFixture() {
  const f = fixture(), controls = Array.from({ length: 10 }, (_, i) => node(`Footer ${i}`, { href: `/footer-${i}` }));
  let scrolls = 0;
  const footer = node('Footer', {}, { left: 0, right: 390, width: 390 });
  footer.querySelectorAll = () => controls; footer.matches = () => true; footer.scrollIntoView = () => { scrolls++; };
  f.nodes.set('.rwn-unified-footer, .site-footer', footer);
  return { ...f, controls, footer, scrolls: () => scrolls };
}

test('footer snapshot rejects provisional DOMs and wrong paths before reading geometry', () => {
  assert.equal(read(footerReflowSnapshot, {}, ['/directory', 100]).missing, true);
  for (const phase of ['root', 'body', 'footer', 'path']) {
    const f = footerFixture(), expected = f.globals.location.pathname;
    f.footer.getBoundingClientRect = () => { throw new Error('Premature footer geometry'); };
    if (phase === 'root') f.globals.document.documentElement = null;
    if (phase === 'body') f.globals.document.body = null;
    if (phase === 'footer') f.nodes.delete('.rwn-unified-footer, .site-footer');
    if (phase === 'path') f.globals.location.pathname = '/previous-page';
    assert.equal(read(footerReflowSnapshot, f.globals, [expected, 100]).missing, true, phase);
    assert.equal(f.scrolls(), 0);
  }
});

test('footer snapshot preserves all control, clipping, readability and overflow evidence', () => {
  const f = footerFixture(), expected = f.globals.location.pathname;
  const state = read(footerReflowSnapshot, f.globals, [expected, 100]);
  assert.equal(state.path, expected); assert.equal(state.title, 'New York directory');
  assert.equal(state.links.length, 10); assert.equal(state.shared, true); assert.equal(state.viewport, 390);
  assert.equal(state.overflow, 0); assert.equal(state.hidden, 0); assert.equal(state.clipping, 0);
  assert.equal(state.outside.length, 0); assert.equal(state.unreadable, 0); assert.equal(f.scrolls(), 1);
  f.root.scrollWidth = 400;
  assert.equal(read(footerReflowSnapshot, f.globals, [expected, 100]).overflow, 10);
  f.globals.getComputedStyle = () => { throw new Error('Broken style read'); };
  assert.throws(() => read(footerReflowSnapshot, f.globals, [expected, 100]), /Broken style read/);
});

test('footer same-path reload rejects the old document and missing/nonfinite origins before geometry', () => {
  const f = footerFixture(), path = f.globals.location.pathname, geometry = f.footer.getBoundingClientRect;
  f.footer.getBoundingClientRect = () => { throw new Error('Old-document geometry must not run'); };
  for (const origin of [123, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    f.globals.performance = { timeOrigin: origin };
    assert.equal(read(footerReflowSnapshot, f.globals, [path, 123]).missing, true);
  }
  delete f.globals.performance;
  assert.equal(read(footerReflowSnapshot, f.globals, [path, 123]).missing, true);
  assert.equal(f.scrolls(), 0);
  f.globals.performance = { timeOrigin: 124 };
  f.footer.getBoundingClientRect = geometry;
  const state = read(footerReflowSnapshot, f.globals, [path, 123]);
  assert.equal(state.timeOrigin, 124); assert.equal(state.path, path); assert.equal(state.links.length, 10);
  assert.equal(f.scrolls(), 1);
});
