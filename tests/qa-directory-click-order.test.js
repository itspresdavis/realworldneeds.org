import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { directoryStartupClickPoint, directoryStartupClickWasDelivered } from '../scripts/qa-directory-startup.mjs';

const source = await readFile(new URL('../scripts/qa-directory-startup.mjs', import.meta.url), 'utf8');
// Execute the actual orchestration closures, with their dependencies supplied.
// This tests ordering rather than a second copy of the production test logic.
const closure = (name, context) => {
  const body = source.match(new RegExp(`  const ${name} = async [\\s\\S]*?\\n  };`))?.[0];
  assert.ok(body, `Missing actual ${name} helper`);
  return vm.runInNewContext(`${body}; ${name}`, context);
};
function clickFixture(positions = [100, 100]) {
  let frame = 0, y = 100;
  const listeners = new Map();
  const node = { tagName: 'BUTTON', textContent: 'Food', hidden: false, disabled: false,
    scrollIntoView() {}, contains: () => false,
    getBoundingClientRect: () => ({ x: 100, y, width: 80, height: 44 }) };
  const other = { tagName: 'BODY', textContent: 'Outside the intended control' };
  const hit = (x, py) => x >= 100 && x <= 180 && py >= y && py <= y + 44 ? node : other;
  const globals = {
    innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    requestAnimationFrame: callback => { y = positions[Math.min(frame++, positions.length - 1)]; queueMicrotask(() => callback(frame)); },
    document: {
      querySelector: () => node, elementFromPoint: hit,
      addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }
    }
  };
  return { globals, node, hit, frame: () => frame, shift: amount => { y += amount; },
    dispatch(type, target, x, py) { listeners.get(type)?.({ type, target, isTrusted: true, clientX: x, clientY: py }); } };
}
const prepare = globals => vm.runInNewContext(`(${directoryStartupClickPoint.toString()})('[data-directory-category="Food"]')`, globals);

test('click delivery requires exactly one ordered trusted expected-target sequence', () => {
  const events = ['mousedown', 'mouseup', 'click'].map(type => ({ type, trusted: true, expected: true }));
  assert.equal(directoryStartupClickWasDelivered({ events }), true);
  for (const invalid of [undefined, {}, { events: [] }, { events: [...events, events[2]] },
    { events: [events[1], events[0], events[2]] },
    { events: events.map((event, index) => index === 2 ? { ...event, trusted: false } : event) },
    { events: events.map((event, index) => index === 1 ? { ...event, expected: false } : event) }]) {
    assert.equal(directoryStartupClickWasDelivered(invalid), false);
  }
});

test('native click coordinates wait for scroll/layout to stabilize across rendering frames', async () => {
  const f = clickFixture([229, 240, 240]);
  const point = await prepare(f.globals);
  assert.equal(f.frame(), 3);
  assert.equal(point.y, 262);
  assert.equal(f.hit(point.x, point.y), f.node);
  assert.equal(f.globals.__rwnDirectoryClickQA.frames, 3);
});

test('continuously moving geometry fails before any native click is attempted', async () => {
  const f = clickFixture(Array.from({ length: 60 }, (_, i) => 100 + i));
  await assert.rejects(() => prepare(f.globals), /geometry did not settle/);
  assert.equal(f.frame(), 60);
  assert.equal(f.globals.__rwnDirectoryClickQA, undefined);
});

for (const shift of ['none', 'post-click-mutation', 'after-preparation', 'between-down-and-up']) {
  test(`actual native click orchestration records target delivery (${shift}) without retries`, async () => {
    const f = clickFixture(), calls = [];
    let down;
    const client = { call: async (_method, { type, x, y }) => {
      calls.push(type);
      const target = f.hit(x, y);
      f.dispatch(type === 'mousePressed' ? 'mousedown' : 'mouseup', target, x, y);
      if (type === 'mousePressed') { down = target; if (shift === 'between-down-and-up') f.shift(129); }
      else if (target === down) {
        f.dispatch('click', target, x, y);
        if (shift === 'post-click-mutation') { f.node.hidden = true; f.shift(129); }
      }
    } };
    const evaluate = async (_client, expression) => {
      const result = await vm.runInNewContext(expression, f.globals);
      if (shift === 'after-preparation' && expression.includes('directoryStartupClickPoint')) f.shift(129);
      return result;
    };
    const click = closure('click', { client, evaluate, directoryStartupClickPoint, directoryStartupClickWasDelivered,
      assert: (condition, label, detail) => assert.ok(condition, `${label}: ${JSON.stringify(detail)}`) });
    const delivered = ['none', 'post-click-mutation'].includes(shift);
    if (delivered) await click('[data-directory-category="Food"]');
    else await assert.rejects(() => click('[data-directory-category="Food"]'), /Native click did not reach the intended control/);
    assert.deepEqual(calls, ['mousePressed', 'mouseReleased']);
    assert.equal(directoryStartupClickWasDelivered(f.globals.__rwnDirectoryClickQA), delivered);
    assert.ok(f.globals.__rwnDirectoryClickQA.events.every(event => event.trusted));
  });
}

test('stale-history setup commits WIC/country before Food and Food/history before Show more', async () => {
  const rows = count => Array.from({ length: count }, (_, i) => ({ href: `/service/wic-${i}` }));
  const state = { ready: true, query: 'London', country: '', category: 'All help', rows: rows(1), count: '1 matching listing', resultsHidden: false,
    history: { path: '/directory', query: 'London', category: '', country: '', shown: 1, focus: '' }, scroll: 0 };
  const order = [];
  let pending = '';
  const helper = closure('seedStaleHistory', {
    client: {}, type: async query => { order.push('type'); state.query = query; },
    evaluate: async () => { order.push('country'); state.country = 'United States'; state.count = 'Searching this directory…'; pending = 'country'; },
    click: async selector => {
      if (selector.includes('Food')) {
        assert.equal(state.history.query, 'WIC', 'Food was clicked before WIC committed');
        assert.equal(state.history.country, 'United States'); assert.equal(state.history.shown, 60);
        order.push('Food'); state.category = 'Food'; state.count = 'Searching this directory…'; pending = 'Food';
      } else {
        assert.equal(state.history.category, 'food', 'Show more was clicked before Food committed');
        assert.equal(state.count, '395 matching listings');
        order.push('more'); state.rows = rows(120); state.history.shown = 120; state.history.focus = state.rows[60].href; state.scroll = 900;
      }
    },
    wait: async (predicate, label) => {
      if (pending) {
        assert.equal(predicate(state), false, `Pending ${pending} state must not satisfy ${label}`);
        state.rows = rows(60); state.count = '395 matching listings';
        state.history = { path: '/directory', query: 'WIC', country: 'United States', category: pending === 'Food' ? 'food' : '', shown: 60, focus: '' };
        order.push(`committed-${pending}`); pending = '';
      }
      assert.equal(predicate(state), true, label); return state;
    }
  });
  const result = await helper();
  assert.deepEqual(order, ['type', 'country', 'committed-country', 'Food', 'committed-Food', 'more']);
  assert.equal(result.rows.length, 120); assert.equal(result.history.focus, '/service/wic-60');
});
