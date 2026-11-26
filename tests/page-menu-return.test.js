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
  const listen = (type, fn) => { (events[type] ||= []).push(fn); };
  const rect = visible => ({ width: visible ? 80 : 0, height: visible ? 44 : 0, top: 10, bottom: 54 });
  const nodes = Object.fromEntries(['summary', 'link', 'brand', 'desktop', 'input', 'result', 'body'].map(name => [name, {
    name, closest(selector) {
      if (selector.includes('dialog')) return name === 'input' ? this : null;
      return ['summary', 'link', 'brand', 'desktop', 'result'].includes(name) ? this : null;
    }, getBoundingClientRect: () => rect(name === 'summary' ? narrow : name === 'desktop' ? !narrow : true),
    focus(options) { focused.push({ name, options: JSON.parse(JSON.stringify(options)) }); document.activeElement = this; }
  }]));
  const header = { querySelectorAll: () => [nodes.brand, nodes.desktop] };
  const menu = { addEventListener: listen, open, contains: node => [nodes.summary, nodes.link].includes(node),
    removeAttribute(name) { assert.equal(name, 'open'); mutations.push(name); this.open = false; },
    querySelector: () => nodes.summary, closest: () => header };
  const document = { body: nodes.body, hasFocus: () => true, addEventListener: listen, activeElement: nodes[active], querySelector(selector) { assert.equal(selector, '.rwn-page-menu'); return present ? menu : null; } };
  const context = { document, window: { matchMedia: () => ({ get matches() { return context.window.innerWidth <= 1088; } }), innerHeight: 844, innerWidth: narrow ? 390 : 1180, addEventListener: listen },
    getComputedStyle: node => ({ visibility: 'visible', display: node === menu && !narrow ? 'none' : 'block' }) };
  vm.runInNewContext(source, context);
  const fire = (type, event = {}) => {
    const input = { target: document.activeElement, preventDefault() { this.defaultPrevented = true; }, ...event };
    for (const fn of events[type] || []) fn(input);
    return input;
  };
  return { nodes, menu, document, focused, mutations, events, fire, context };
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
  for (const type of ['hashchange', 'popstate', 'pagehide']) f.fire(type, { key: 'Escape', persisted: true });
  assert.equal(f.menu.open, true);
  assert.deepEqual(Object.keys(f.events).sort(), ['click', 'focusout', 'keydown', 'pageshow', 'resize']);
  assert.ok(Object.values(f.events).every(listeners => listeners.length === 1), 'one listener per event and no extra state owners');
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
  assert.ok(Buffer.byteLength(source) <= 2_300, 'shared generated header lifecycle, dismissal and native focus repair stay below 2.3 KB');
  assert.doesNotMatch(source, /localStorage|sessionStorage|history\.|location\.|scrollTo|scrollIntoView|fetch\(|setTimeout|requestAnimationFrame|querySelectorAll\([^)]*directory/);
});

test('local, global, service and trust pages load the same byte-addressed controller once', async () => {
  const release = JSON.parse(await readFile('dist/data/release.json', 'utf8'));
  const asset = release.offlineAssets['/page-menu.js'];
  assert.match(asset || '', /^\/page-menu\.[a-f0-9]{12}\.js$/);
  assert.equal(await readFile(`dist${asset}`, 'utf8'), source);
  for (const path of ['directory/index.html', 'directory/local/united-states/new-york-city/help/referral/index.html',
    'service/new-york-public-library-access/index.html', 'sources/index.html', 'editorial-policy.html', 'transparency.html']) {
    const html = await readFile(`dist/${path}`, 'utf8');
    assert.equal(html.split(`src="${asset}?v=`).length - 1, 1, path);
    assert.doesNotMatch(html, /<details class="rwn-page-menu" open/, path);
    assert.match(html, /<summary aria-label="Navigation menu">[\s\S]*?lang="en">Menu<\/span>[\s\S]*?<\/summary>/, path);
    assert.doesNotMatch(html.match(/<details class="rwn-page-menu">[\s\S]*?<\/details>/)?.[0], /aria-expanded|role="(?:menu|button)"/, 'native details retains expanded semantics');
  }
  const home = await readFile('dist/index.html', 'utf8');
  assert.ok(home.includes('src="/page-menu.'), 'homepage uses the shared menu owner');
});

test('Escape from summary or a menu link closes once and restores visible summary without scrolling', () => {
  for (const active of ['summary', 'link']) {
    const f = fixture({ active });
    const event = f.fire('keydown', { key: 'Escape' });
    assert.equal(f.menu.open, false);
    assert.equal(f.document.activeElement, f.nodes.summary);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(f.focused, [{ name: 'summary', options: { preventScroll: true } }]);
    assert.equal(f.fire('keydown', { key: 'Escape' }).defaultPrevented, undefined);
    assert.equal(f.focused.length, 1);
    f.menu.open = true; f.document.activeElement = f.nodes.link;
    f.fire('keydown', { key: 'Escape' });
    assert.equal(f.focused.length, 2);
  }
});

test('Escape outside the menu and events owned by other controls are untouched', () => {
  for (const active of ['input', 'result', 'brand', 'body']) {
    const f = fixture({ active });
    assert.equal(f.fire('keydown', { key: 'Escape' }).defaultPrevented, undefined);
    assert.equal(f.menu.open, true);
    assert.deepEqual(f.focused, []);
  }
  const mismatched = fixture(); mismatched.fire('keydown', { key: 'Escape', target: mismatched.nodes.input });
  assert.equal(mismatched.menu.open, true, 'target outside the menu keeps keyboard ownership even if focus is retained');
  for (const event of [{ key: 'Enter' }, { key: 'Escape', defaultPrevented: true }, { key: 'Escape', isComposing: true }]) {
    const f = fixture(); f.fire('keydown', event);
    assert.equal(f.menu.open, true);
    assert.deepEqual(f.focused, []);
  }
  const f = fixture();
  f.nodes.link.closest = selector => selector.includes('dialog') ? f.nodes.link : f.nodes.link;
  f.fire('keydown', { key: 'Escape' });
  assert.equal(f.menu.open, true, 'nested control or dialog keeps Escape ownership');
});

test('outside click closes without stealing focus from the clicked control', () => {
  for (const active of ['input', 'result', 'brand', 'body']) {
    const f = fixture({ active }); f.fire('click');
    assert.equal(f.menu.open, false);
    assert.equal(f.document.activeElement, f.nodes[active]);
    assert.deepEqual(f.focused, []);
  }
  const f = fixture(); f.fire('click', { target: f.nodes.body });
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.nodes.summary, 'repair only focus left in the hidden menu');
  const inside = fixture(); inside.fire('click');
  assert.equal(inside.menu.open, false, 'a selected navigation link dismisses the overlay without intercepting navigation');
});

test('desktop resize closes and repairs hidden menu focus, while narrow resize preserves it', () => {
  const narrow = fixture(); narrow.context.window.innerWidth = 900; narrow.fire('resize');
  assert.equal(narrow.menu.open, true, '900px remains mobile');
  const desktop = fixture({ narrow: false }); desktop.fire('resize');
  assert.equal(desktop.menu.open, false);
  assert.equal(desktop.document.activeElement, desktop.nodes.brand);
  assert.deepEqual(desktop.focused, [{ name: 'brand', options: { preventScroll: true } }]);
  const closed = fixture({ narrow: false, open: false, active: 'summary' }); closed.fire('resize');
  assert.equal(closed.menu.open, false);
  assert.equal(closed.document.activeElement, closed.nodes.brand, 'Escape focus cannot remain on a hidden summary after resize');
  const external = fixture({ narrow: false, active: 'input' }); external.fire('resize');
  assert.equal(external.menu.open, false); assert.deepEqual(external.focused, []);
});

test('no visible focus target, a closed menu or absent header never causes focus theft', () => {
  const f = fixture();
  for (const node of Object.values(f.nodes)) node.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, bottom: 0 });
  f.fire('keydown', { key: 'Escape' });
  assert.equal(f.menu.open, false); assert.deepEqual(f.focused, []);
  for (const options of [{ open: false }, { present: false }]) {
    const missing = fixture(options);
    for (const type of ['keydown', 'click', 'resize']) missing.fire(type, { key: 'Escape', target: missing.nodes.body });
    assert.deepEqual(missing.mutations, []); assert.deepEqual(missing.focused, []);
  }
});

test('responsive focusout repairs browser-cleared menu focus before or after resize', () => {
  for (const open of [true, false]) for (const resizeFirst of [true, false]) {
    const f = fixture({ narrow: false, open, active: 'body' });
    if (resizeFirst) f.fire('resize');
    f.fire('focusout', { target: open ? f.nodes.link : f.nodes.summary, relatedTarget: null });
    if (!resizeFirst) f.fire('resize');
    assert.equal(f.menu.open, false);
    assert.equal(f.document.activeElement, f.nodes.brand, 'browser-cleared menu focus must reach a visible header target');
    assert.deepEqual(f.focused, [{ name: 'brand', options: { preventScroll: true } }]);
  }
});

test('responsive focus repair never claims deliberate focus moves, visible controls or an unfocused document', () => {
  for (const change of [
    f => { f.context.window.innerWidth = 900; },
    f => { f.context.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }); },
    f => { f.document.hasFocus = () => false; },
    f => { f.document.activeElement = f.nodes.input; },
    f => { f.nodes.link.closest = () => f.nodes.link; }
  ]) {
    const f = fixture({ narrow: false, active: 'body' }); change(f);
    f.fire('focusout', { target: f.nodes.link, relatedTarget: null });
    assert.equal(f.menu.open, true); assert.deepEqual(f.focused, []);
  }
  for (const relatedTarget of ['input', 'brand', 'body']) {
    const f = fixture({ narrow: false, active: 'body' });
    f.fire('focusout', { target: f.nodes.link, relatedTarget: f.nodes[relatedTarget] });
    assert.equal(f.menu.open, true); assert.deepEqual(f.focused, []);
  }
  const closed = fixture({ narrow: false, open: false, active: 'body' }); closed.fire('resize');
  assert.equal(closed.document.activeElement, closed.nodes.body); assert.deepEqual(closed.focused, [], 'closed menu cannot claim unrelated BODY focus');
  const external = fixture({ narrow: false, active: 'body' });
  external.fire('focusout', { target: external.nodes.input, relatedTarget: null });
  assert.equal(external.menu.open, true); assert.deepEqual(external.focused, []);
});

test('reentrant responsive blur repairs once and preserves a new outside focus destination', () => {
  for (const destination of ['brand', 'input']) {
    const f = fixture({ narrow: false });
    const remove = f.menu.removeAttribute.bind(f.menu);
    f.menu.removeAttribute = name => {
      remove(name);
      f.document.activeElement = f.nodes.body;
      f.fire('focusout', { target: f.nodes.link, relatedTarget: null });
      if (destination === 'input') f.nodes.input.focus({ preventScroll: true });
    };
    f.fire('resize');
    assert.equal(f.menu.open, false);
    assert.equal(f.document.activeElement, f.nodes[destination]);
    assert.equal(f.focused.filter(value => value.name === 'brand').length, 1, 'outer close cannot duplicate the nested repair');
    assert.equal(f.focused.at(-1).name, destination, 'outer close cannot overwrite deliberate outside focus');
  }
  const f = fixture({ narrow: false });
  const remove = f.menu.removeAttribute.bind(f.menu);
  f.menu.removeAttribute = name => {
    remove(name);
    f.document.activeElement = f.nodes.input;
    f.fire('focusout', { target: f.nodes.link, relatedTarget: f.nodes.input });
  };
  f.fire('resize');
  assert.equal(f.document.activeElement, f.nodes.input);
  assert.deepEqual(f.focused, [], 'deliberate outside focus during close requires no repair');
});
