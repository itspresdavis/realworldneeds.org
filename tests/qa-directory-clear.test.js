import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { directoryClearClickEvidence, verifyDirectoryClear } from '../scripts/qa-directory-discovery.mjs';

// Exact page-side helpers with synthetic nodes/events test orchestration only.
// Actual trusted native input and layout still require the unchanged CI browser.
async function fixture({ shiftedRelease = false, resetBroken = false, untrusted = false, covered = false, screenshotFailure = false } = {}) {
  const qaDir = await mkdtemp(join(tmpdir(), 'rwn-clear-diagnostic-'));
  const listeners = new Map(), calls = [], captures = [];
  let frames = 0, downTarget, waitCalls = 0, predicate;
  const context = vm.createContext({ innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 34 });
  let rect = { x: 290, y: 485, width: 94, height: 44 };
  const target = { hidden: false, disabled: false, tagName: 'BUTTON', id: '', textContent: 'Clear filters',
    scrollIntoView() {}, getBoundingClientRect: () => ({ ...rect }), contains: node => node === target, closest: () => null };
  const other = { tagName: 'DIV', textContent: 'Directory', closest: () => null };
  const snapshot = { documentPresent: true, ready: true, query: '', country: 'United States', category: 'Food', rows: Array.from({ length: 60 }, (_, id) => ({ id })), count: '419 matching listings', scroll: 34 };
  const hit = point => !covered && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height ? target : other;
  const dispatch = (type, point, node) => {
    for (const listener of listeners.get(type) || []) listener({ type, isTrusted: !untrusted, target: node, clientX: point.x, clientY: point.y });
  };
  context.document = { activeElement: null,
    querySelector: selector => selector === '[data-directory-clear]' ? target : null,
    elementFromPoint: (x, y) => hit({ x, y }),
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); } };
  context.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  context.requestAnimationFrame = callback => queueMicrotask(() => {
    frames++;
    if (frames >= 2) { rect.y = 519; context.scrollY = 0; snapshot.scroll = 0; }
    callback();
  });
  const client = { call: async (method, args) => {
    calls.push({ method, ...args }); assert.equal(method, 'Input.dispatchMouseEvent');
    const node = hit(args);
    if (args.type === 'mousePressed') {
      downTarget = node; context.document.activeElement = node; dispatch('mousedown', args, node);
      if (shiftedRelease) rect.y += 34;
    } else {
      assert.equal(args.type, 'mouseReleased'); dispatch('mouseup', args, node);
      if (node === downTarget) {
        dispatch('click', args, node);
        if (node === target && !resetBroken) Object.assign(snapshot, { country: '', category: 'All help', rows: [], count: '60 listings on this page' });
      }
    }
  } };
  const evaluate = async (_, expression) => {
    const result = await vm.runInContext(expression, context);
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  };
  const state = async () => JSON.parse(JSON.stringify(snapshot));
  const wait = async (condition, message) => {
    waitCalls++; predicate = condition;
    const current = await state(); if (!condition(current)) throw new Error(message);
    return current;
  };
  const capture = async (_, name) => { captures.push(name); if (screenshotFailure && name.includes('after')) throw new Error('Secondary screenshot failure'); };
  return { qaDir, run: overrides => verifyDirectoryClear({ client, evaluate, state, wait, capture, width: 1440, qaDir, ...overrides }), calls, captures, listeners,
    evidence: async () => JSON.parse(await readFile(join(qaDir, 'directory-clear-1440.json'), 'utf8')),
    cleanup: () => rm(qaDir, { recursive: true, force: true }),
    get frames() { return frames; }, get waitCalls() { return waitCalls; }, get predicate() { return predicate; } };
}

test('Clear observer returns only serialized geometry and event evidence', () => {
  const result = vm.runInNewContext(`(${directoryClearClickEvidence.toString()})()`, { __rwnDirectoryClickQA: { selector: 'clear', point: { x: 1, y: 2 }, rect: {}, scroll: [0, 0], frames: 2, events: [], stop() {}, secret: 'not included' } });
  assert.deepEqual(Object.keys(result), ['selector', 'point', 'rect', 'scroll', 'frames', 'events']);
  assert.equal(vm.runInNewContext(`(${directoryClearClickEvidence.toString()})()`), null);
});

test('Clear settles its target, sends one native pair and preserves the original reset predicate', async () => {
  const f = await fixture();
  try {
    const result = await f.run(), evidence = await f.evidence();
    assert.equal(result.category, 'All help'); assert.equal(f.frames, 3);
    assert.deepEqual(f.calls.map(call => call.type), ['mousePressed', 'mouseReleased']);
    assert.equal(f.calls[0].y, 541); assert.equal(f.calls[1].y, 541);
    assert.equal(evidence.before.country, 'United States'); assert.equal(evidence.target.rect.y, 519);
    assert.equal(evidence.target.events.length, 0, 'pre-action target witness is immutable');
    assert.equal(evidence.input.events.length, 3); assert.equal(evidence.delivered, true); assert.equal(evidence.phase, 'complete');
    assert.equal(evidence.after.country, ''); assert.equal(evidence.after.rows.length, 0); assert.equal(f.waitCalls, 1);
    for (const change of [{ query: 'old' }, { country: 'United States' }, { category: 'Food' }, { rows: [{}] }]) assert.equal(f.predicate({ ...result, ...change }), false);
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
    assert.deepEqual(f.captures, ['directory-clear-before-1440.png', 'directory-clear-after-1440.png']);
  } finally { await f.cleanup(); }
});

for (const [label, options] of [['between-event movement', { shiftedRelease: true }], ['untrusted events', { untrusted: true }]]) {
  test(`Clear ${label} fails without another click or a weaker outcome`, async () => {
    const f = await fixture(options);
    try {
      await assert.rejects(f.run(), /native click was not delivered/);
      const evidence = await f.evidence();
      assert.equal(evidence.phase, 'delivery'); assert.equal(evidence.delivered, false);
      assert.equal(f.calls.length, 2); assert.equal(f.waitCalls, 0);
      assert.ok(evidence.before && evidence.target && evidence.input && evidence.after && evidence.error);
      assert.ok([...f.listeners.values()].every(set => set.size === 0));
    } finally { await f.cleanup(); }
  });
}

test('delivered click with broken reset remains a blocking behavioral failure', async () => {
  const f = await fixture({ resetBroken: true });
  try {
    await assert.rejects(f.run(), /Clear filters did not restore ordinary browsing/);
    const evidence = await f.evidence();
    assert.equal(evidence.delivered, true); assert.equal(evidence.phase, 'reset'); assert.equal(evidence.after.country, 'United States');
    assert.equal(f.calls.length, 2); assert.equal(f.waitCalls, 1);
  } finally { await f.cleanup(); }
});

test('covered Clear sends no native input and saves preparation failure', async () => {
  const f = await fixture({ covered: true });
  try {
    await assert.rejects(f.run(), /covered or clipped/);
    const evidence = await f.evidence();
    assert.equal(evidence.phase, 'prepare'); assert.equal(evidence.delivered, false); assert.equal(f.calls.length, 0);
    assert.ok(evidence.before && evidence.after && evidence.error);
  } finally { await f.cleanup(); }
});

test('secondary screenshot failure cannot conceal a delivered-click reset failure', async () => {
  const f = await fixture({ resetBroken: true, screenshotFailure: true });
  try {
    await assert.rejects(f.run(), /Clear filters did not restore ordinary browsing/);
    const evidence = await f.evidence();
    assert.match(evidence.error, /did not restore/); assert.match(evidence.screenshotError, /Secondary/);
    assert.equal(f.calls.length, 2); assert.ok([...f.listeners.values()].every(set => set.size === 0));
  } finally { await f.cleanup(); }
});

test('real discovery invokes the Clear witness and preserves cleared-state reload check', async () => {
  const source = await readFile(new URL('../scripts/qa-directory-discovery.mjs', import.meta.url), 'utf8');
  assert.match(source, /const cleared = await verifyDirectoryClear\(\{ client, evaluate, state, wait, capture, width \}\)/);
  assert.match(source, /s\.timeOrigin !== cleared\.timeOrigin && s\.query === '' && s\.country === '' && s\.rows\.length === 0/);
  const originalGate = source.slice(source.indexOf('export async function verifyDirectoryDiscovery'), source.indexOf('// This is separate from the original detail/Back'));
  assert.equal((originalGate.match(/await click\('\[data-directory-clear\]'\)/g) || []).length, 0);
});

for (const resetBroken of [false, true]) {
  test(`artifact write failure ${resetBroken ? 'preserves the original reset failure' : 'blocks an otherwise successful gate'}`, async t => {
    const messages = [];
    t.mock.method(console, 'error', message => messages.push(message));
    const f = await fixture({ resetBroken });
    try {
      const qaDir = join(f.qaDir, 'not-a-directory');
      await writeFile(qaDir, 'Synthetic artifact write blocker');
      await assert.rejects(f.run({ qaDir }), error => {
        if (resetBroken) {
          assert.equal(error.message, 'Clear filters did not restore ordinary browsing');
          assert.ok(error.artifactError);
          assert.match(error.artifactError.code, /EEXIST|ENOTDIR/);
        } else assert.match(error.code, /EEXIST|ENOTDIR/);
        return true;
      });
      assert.equal(f.calls.length, 2);
      assert.equal(messages.length, resetBroken ? 1 : 0);
      if (resetBroken) assert.match(messages[0], /Clear diagnostic artifact could not be saved:/);
      assert.ok([...f.listeners.values()].every(set => set.size === 0));
    } finally { await f.cleanup(); }
  });
}
