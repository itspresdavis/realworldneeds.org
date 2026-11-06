import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  DIRECTORY_PAGINATION_VIEWPORTS, directoryPaginationSnapshot, directoryPaginationIdentity,
  directoryPaginationViolations, directoryPaginationKey, withDirectoryScriptsDisabled,
  waitForDirectoryPagination, verifyDirectoryPagination
} from '../scripts/qa-directory-pagination.mjs';

const box = (left = 20, top = 120, width = 44, height = 44) => ({ left, top, right: left + width, bottom: top + height, width, height });
const href = page => page === 1 ? '/directory' : `/directory/page/${page}`;
const expected = (page = 1) => ({ href: `http://127.0.0.1:4175${href(page)}`, page, total: 4, width: 320, height: 844, timeOrigin: 100 });
const target = extra => ({ tag: 'A', text: '', href: null, label: null, current: null, role: null, tabIndex: 0,
  visible: true, box: box(), hit: true, focused: false, focusVisible: false, ring: box(17, 117, 50, 50), clips: [],
  outline: { width: 3, offset: 0, style: 'solid', color: 'rgb(53, 108, 78)' }, ...extra });
function fixture(page = 1) {
  const nav = () => ({ tag: 'NAV', label: 'Directory pages before listings', classes: ['directory-downloads', 'directory-pagination'], visible: true,
    box: box(16, 90, 288, 200), status: `Page ${page} of 4`, pickerTag: 'DETAILS', open: true,
    summary: target({ tag: 'SUMMARY', text: 'Choose a page' }), listTag: 'OL', listBox: box(16, 150, 288, 100), listClientWidth: 288, listScrollWidth: 288,
    previous: page === 1 ? [] : [target({ text: 'Previous', href: href(page - 1) })],
    next: page === 4 ? [] : [target({ text: 'Next', href: href(page + 1) })],
    items: Array.from({ length: 4 }, (_, index) => {
      const number = index + 1, current = page === number;
      return target({ li: true, children: 1, tag: current ? 'SPAN' : 'A', text: String(number), href: current ? null : href(number),
        label: `Page ${number}${current ? ', current page' : ''}`, current: current ? 'page' : null, tabIndex: current ? -1 : 0 });
    }) });
  return { ready: true, ...expected(page), title: 'Directory | RWN', heading: 'Free essential services', overlay: false,
    clientWidth: 320, scrollWidth: 320, scrollX: 0, scrollY: 0, headerBottom: 60, navs: [nav(), nav()], staticRows: ['/service/example'] };
}
const issues = (state, options) => directoryPaginationViolations(state, expected(), options);

test('matrix covers desktop and narrow 320px reflow', () => {
  assert.deepEqual(DIRECTORY_PAGINATION_VIEWPORTS, [[1440, 1000], [320, 844]]);
});

test('first, middle and last page semantics pass with two complete native pickers', () => {
  for (const page of [1, 2, 3, 4]) assert.deepEqual(directoryPaginationViolations(fixture(page), expected(page)), []);
});

test('document identity rejects stale, blank, wrong-route, wrong-size and invalid-metric snapshots', () => {
  assert.equal(directoryPaginationIdentity(fixture(), expected()), true);
  assert.equal(directoryPaginationIdentity(fixture(), { ...expected(), previousTimeOrigin: 99 }), true);
  assert.equal(directoryPaginationIdentity(fixture(), { ...expected(), previousTimeOrigin: 100 }), false);
  for (const change of [
    { ready: false }, { href: 'http://other.example/directory' }, { href: `${expected().href}#saved` }, { timeOrigin: 99 },
    { timeOrigin: NaN }, { title: '' }, { heading: '' }, { overlay: true }, { width: 319 }, { height: 843 },
    { clientWidth: 0 }, { clientWidth: undefined }, { scrollWidth: Infinity }, { scrollX: NaN }, { scrollY: null }
  ]) assert.equal(directoryPaginationIdentity({ ...fixture(), ...change }, expected()), false, JSON.stringify(change));
  for (const value of [null, undefined, Infinity, NaN]) {
    assert.equal(directoryPaginationIdentity(fixture(), { ...expected(), timeOrigin: value }), false);
    assert.equal(directoryPaginationIdentity(fixture(), { ...expected(), previousTimeOrigin: value }), false);
  }
});

test('native landmark, summary, ordered list and page-count contracts cannot silently degrade', () => {
  const mutations = [
    s => s.navs.pop(), s => { s.navs[0].tag = 'DIV'; }, s => { s.navs[0].label = 'Pages'; },
    s => { s.navs[0].classes = ['directory-pagination']; }, s => { s.navs[0].status = 'Page 2 of 4'; },
    s => { s.navs[0].pickerTag = 'DIV'; }, s => { s.navs[0].summary.tag = 'BUTTON'; },
    s => { s.navs[0].summary.text = ''; }, s => { s.navs[0].summary.role = 'button'; },
    s => { s.navs[0].listTag = 'DIV'; }, s => { s.navs[1].items.pop(); }
  ];
  for (const mutate of mutations) { const state = fixture(); mutate(state); assert.ok(issues(state).length, mutate.toString()); }
  for (const total of [1, 0, 3.5, null]) assert.ok(directoryPaginationViolations(fixture(), { ...expected(), total }).includes('invalid-expectation'));
});

test('every numbered page has exact visible and accessible labels, route and list semantics', () => {
  for (const mutate of [
    item => { item.li = false; }, item => { item.children = 2; }, item => { item.text = 'Page 2'; },
    item => { item.label = null; }, item => { item.label = 'Page 3'; }, item => { item.tag = 'BUTTON'; },
    item => { item.href = '/directory/page/1'; }, item => { item.href = '/directory/page/2?q=private'; },
    item => { item.current = 'page'; }, item => { item.tabIndex = -1; }
  ]) { const state = fixture(); mutate(state.navs[1].items[1]); assert.ok(issues(state).includes('1:page-2-semantics'), mutate.toString()); }
});

test('current page is a noninteractive labelled span and cannot masquerade as a link or tab stop', () => {
  for (const change of [{ href: '/directory' }, { current: null }, { label: 'Page 1' }, { tag: 'A' }, { tabIndex: 0 }]) {
    const state = fixture(); Object.assign(state.navs[0].items[0], change);
    assert.ok(issues(state).includes('0:page-1-semantics'), JSON.stringify(change));
  }
});

test('Previous and Next have correct boundary presence, labels, counts and destinations', () => {
  for (const [page, mutate, violation] of [
    [1, n => n.previous.push(target({ href: '/directory', text: 'Previous' })), 'previous-semantics'],
    [4, n => n.next.push(target({ href: '/directory/page/5', text: 'Next' })), 'next-semantics'],
    [2, n => { n.previous[0].href = '/directory/page/1'; }, 'previous-semantics'],
    [2, n => { n.next[0].href = '/directory/page/4'; }, 'next-semantics'],
    [2, n => { n.next[0].text = 'Go'; }, 'next-semantics'],
    [2, n => n.previous.push(n.previous[0]), 'previous-semantics']
  ]) { const state = fixture(page); mutate(state.navs[0]); assert.ok(directoryPaginationViolations(state, expected(page)).includes(`0:${violation}`)); }
});

test('44px targets, wrapping and overflow are checked independently for both pickers', () => {
  for (const mutate of [
    s => { s.navs[1].summary.box.height = 43; }, s => { s.navs[0].next[0].box.width = 43; },
    s => { s.navs[1].items[3].box.height = 43; }, s => { s.navs[0].items[2].box.width = NaN; },
    s => { s.navs[0].items[3].visible = false; }, s => { s.navs[1].items[3].box.right = 322; },
    s => { s.navs[0].listScrollWidth = 290; }, s => { s.scrollWidth = 322; }, s => { s.scrollX = 1; }
  ]) { const state = fixture(); mutate(state); assert.ok(issues(state).length, mutate.toString()); }
});

test('closed native details hide links, while search and Saved hide every pagination control', () => {
  const state = fixture();
  for (const nav of state.navs) { nav.open = false; nav.items.forEach(item => { item.visible = false; }); }
  assert.deepEqual(issues(state), []);
  state.navs[0].items[1].visible = true;
  assert.ok(issues(state).includes('0:collapsed-list-visible'));
  for (const nav of state.navs) {
    nav.visible = false; nav.summary.visible = false;
    [...nav.items, ...nav.previous, ...nav.next].forEach(item => { item.visible = false; });
  }
  assert.deepEqual(issues(state, { hidden: true }), []);
  for (const mutate of [s => { s.navs[0].visible = true; }, s => { s.navs[1].summary.visible = true; },
    s => { s.navs[0].items[3].visible = true; }, s => { s.navs[1].next[0].visible = true; }]) {
    const broken = structuredClone(state); mutate(broken); assert.ok(issues(broken, { hidden: true }).some(issue => issue.endsWith('hidden-state')));
  }
});

test('keyboard checks require real focus, hit testing, visible ring, and sticky-header/ancestor containment', () => {
  const state = fixture(); state.navs[0].items[1].focused = true; state.navs[0].items[1].focusVisible = true;
  const focus = { nav: 0, target: 2 };
  assert.deepEqual(issues(state, { focus }), []);
  for (const mutate of [
    s => { s.navs[0].items[1].focused = false; }, s => { s.navs[0].items[1].focusVisible = false; },
    s => { s.navs[0].items[1].hit = false; }, s => { s.navs[0].items[1].box.top = 50; },
    s => { s.navs[0].items[1].outline.width = 0; }, s => { s.navs[0].items[1].outline.style = 'none'; },
    s => { s.navs[0].items[1].outline.color = 'transparent'; }, s => { s.navs[0].items[1].ring.bottom = 846; },
    s => { s.navs[0].items[1].clips = [{ ...box(21, 120, 44, 44), x: true, y: false }]; }
  ]) { const broken = structuredClone(state); mutate(broken); assert.ok(issues(broken, { focus }).length, mutate.toString()); }
});

test('Enter and Space send complete native activation sequences; Tab preserves Shift and Ctrl+A selects text', async () => {
  for (const [key, code, name, text] of [['Enter', 13, 'Enter', '\r'], [' ', 32, 'Space', ' ']]) {
    const calls = []; await directoryPaginationKey({ call: async (method, params) => calls.push({ method, params }) }, key);
    assert.deepEqual(calls, [
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: 0, text, unmodifiedText: text } },
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: 0 } }
    ]);
  }
  for (const [key, options, modifiers] of [['Tab', { shift: true }, 8], ['a', { control: true }, 2]]) {
    const calls = []; await directoryPaginationKey({ call: async (_method, params) => calls.push(params) }, key, options);
    assert.deepEqual(calls.map(call => [call.type, call.modifiers]), [['rawKeyDown', modifiers], ['keyUp', modifiers]]);
    assert.ok(calls.every(call => !('text' in call)));
  }
  await assert.rejects(directoryPaginationKey({}, 'Fake'), /Unsupported/);
});

test('JavaScript-disabled fixture restores script execution after success and failure', async () => {
  for (const fail of [false, true]) {
    const calls = [], error = new Error('fixture failed');
    const task = withDirectoryScriptsDisabled({ call: async (method, params) => { calls.push([method, params]); } }, async () => {
      calls.push('run'); if (fail) throw error; return 'native details worked';
    });
    if (fail) await assert.rejects(task, value => value === error); else assert.equal(await task, 'native details worked');
    assert.deepEqual(calls, [['Emulation.setScriptExecutionDisabled', { value: true }], 'run', ['Emulation.setScriptExecutionDisabled', { value: false }]]);
  }
});

test('failed JavaScript restoration does not conceal the original fixture failure', async () => {
  const failure = new Error('fixture'), cleanup = new Error('restore');
  await assert.rejects(withDirectoryScriptsDisabled({ call: async (_method, params) => { if (!params.value) throw cleanup; } }, async () => { throw failure; }),
    error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === cleanup);
});

test('quiet sampler waits for native focus/scroll movement to end', async () => {
  let time = 0, calls = 0;
  const result = await waitForDirectoryPagination({ sample: async () => ({ ...fixture(), scrollY: ++calls < 3 ? calls * 10 : 30 }),
    predicate: state => directoryPaginationIdentity(state, expected()), now: () => time, wait: async ms => { time += ms; }, label: 'test' });
  assert.equal(result.scrollY, 30); assert.ok(time >= 240);
});

test('quiet sampler rejects nonstop motion and tolerates only expected navigation-context loss', async () => {
  let time = 0;
  await assert.rejects(waitForDirectoryPagination({ sample: async () => ({ ...fixture(), scrollY: time }), predicate: () => true,
    now: () => time, wait: async ms => { time += ms; }, timeoutMs: 240, label: 'moving' }), /moving did not settle/);
  let attempts = 0; time = 0;
  const result = await waitForDirectoryPagination({ sample: async () => { if (!attempts++) throw new Error('Runtime.evaluate: Execution context was destroyed'); return fixture(); },
    predicate: () => true, now: () => time, wait: async ms => { time += ms; }, label: 'navigation' });
  assert.equal(result.href, expected().href);
  await assert.rejects(waitForDirectoryPagination({ sample: async () => { throw new Error('Unrelated failure'); }, predicate: () => true, label: 'bad' }), /Unrelated failure/);
});

test('snapshot serializes without imported state and never creates DOM interaction or state', () => {
  const snapshot = vm.runInNewContext(`(${directoryPaginationSnapshot.toString()})()`, {});
  assert.equal(snapshot.ready, false); assert.equal(snapshot.navs.length, 0);
  assert.doesNotMatch(directoryPaginationSnapshot.toString(), /\.focus\(|\.click\(|scrollIntoView\(|scrollTo\(|dispatchEvent\(|\.open\s*=|\.value\s*=/);
  assert.doesNotMatch(verifyDirectoryPagination.toString(), /\.focus\(|\.click\(|scrollIntoView\(|scrollTo\(|dispatchEvent\(|\.open\s*=|\.value\s*=/);
});

test('runner uses real generated routes, both pickers, keyboard links, Next/Previous, last page and hidden modes', () => {
  const source = verifyDirectoryPagination.toString();
  for (const pattern of [/await exercise\(expected, 0/, /await exercise\(expected, 1/, /keyboard: true, page: later/,
    /keyboard: true, nav: 1, page: 1/, /s\.navs\[0\]\.next\[0\]/, /s\.navs\[0\]\.previous\[0\]/,
    /page: expected.total/, /check\(record.search, expected, \{ hidden: true \}\)/,
    /check\(record.saved, savedExpected, \{ hidden: true \}\)/, /withDirectoryScriptsDisabled\(client, \(\) => runCase\(320, 844, false\)\)/,
    /previousTimeOrigin: expected.timeOrigin/, /Input\.dispatchMouseEvent/, /Input\.insertText/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /spawn\(|launch\(|new WebSocket|Page\.addScriptToEvaluateOnNewDocument/);
});
