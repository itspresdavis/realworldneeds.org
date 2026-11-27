import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { installSkipLinkWitness, withSkipLinkEvidence } from '../scripts/qa-skip-link-evidence.mjs';
import { skipLinkDestination, hasImmediateSkipLinkArrival } from '../scripts/qa-page-interactions.mjs';

test('native skip destination uses pre-input geometry, padding and target margin with scroll bounds', () => {
  const prepared = { finderDocumentTop:122.1875, clearance:'78px', finderMargin:'0px', scrollHeight:7489, clientHeight:844 };
  assert.deepEqual(skipLinkDestination(prepared), {y:44.1875,target:78,clearance:78,margin:0});
  assert.deepEqual(skipLinkDestination({...prepared,finderMargin:'12px'}), {y:32.1875,target:90,clearance:78,margin:12});
  assert.equal(skipLinkDestination({...prepared,finderDocumentTop:74}).y, 0);
  assert.equal(skipLinkDestination({...prepared,finderDocumentTop:7400}).y, 6645);
  assert.throws(() => skipLinkDestination({...prepared,clearance:'unknown'}), /geometry is unavailable/);
});

test('immediate skip oracle rejects stale, document-top, overshot, obscured and non-native arrivals', () => {
  const expected = {y:44.1875,target:78,clearance:78,margin:0};
  const actual = {y:44,target:78.1875,header:66,clearance:78,hash:'#finder',active:'finder',smooth:'auto',overflow:false};
  assert.equal(hasImmediateSkipLinkArrival(actual, expected), true);
  for (const change of [
    {y:300,target:-177.8125}, {y:0,target:122.1875}, {y:46,target:76.1875},
    {header:79}, {target:65}, {clearance:0}, {hash:'#top'}, {active:'resourceSearch'},
    {smooth:'smooth'}, {overflow:true}, {y:NaN}, {target:undefined},
  ]) assert.equal(hasImmediateSkipLinkArrival({...actual,...change}, expected), false, JSON.stringify(change));
  assert.equal(hasImmediateSkipLinkArrival({...actual,y:0,target:74,header:74}, {...expected,y:0,target:74}), true, 'document-start clamp still permits a visible target');
});

function browserFixture() {
  const listeners = [], pendingFrames = new Map(), microtasks = [], cancelled = [];
  let at = 0, nextFrame = 1;
  const target = name => ({
    addEventListener(type, handler, options) { listeners.push({ name, type, handler, options }); },
    removeEventListener(type, handler, options) {
      const i = listeners.findIndex(item => item.name === name && item.type === type && item.handler === handler && item.options === options);
      assert.notEqual(i, -1); listeners.splice(i, 1);
    },
  });
  const page = { classList: { contains: () => false }, dataset: { pageInteractions: 'ready' }, clientHeight: 844, scrollHeight: 4000 };
  const header = { getBoundingClientRect: () => ({ top: 0, bottom: 74, height: 74 }) };
  const finder = { id: 'finder', className: 'finder', getBoundingClientRect: () => ({ top: 74 - context.scrollY, bottom: 1000 - context.scrollY, height: 926 }) };
  const skip = { id: '', className: 'skip-link', closest: selector => selector === '.skip-link' ? skip : null };
  const document = { ...target('document'), documentElement: page, activeElement: skip,
    readyState: 'complete', visibilityState: 'visible',
    getElementById: id => id === 'finder' ? finder : null,
    querySelector: selector => selector === '.site-header' ? header : null };
  const window = target('window');
  const context = vm.createContext({ window, document, location: { hash: '#top' }, history: { scrollRestoration: 'auto' },
    performance: { now: () => ++at }, scrollX: 0, scrollY: 300, innerWidth: 1180, innerHeight: 844,
    getComputedStyle: () => ({ scrollPaddingTop: '86px', scrollBehavior: 'auto', scrollMarginTop: '0px' }),
    queueMicrotask: fn => microtasks.push(fn),
    requestAnimationFrame: fn => { const id = nextFrame++; pendingFrames.set(id, fn); return id; },
    cancelAnimationFrame: id => { cancelled.push(id); pendingFrames.delete(id); },
  });
  const install = () => vm.runInContext(`(${installSkipLinkWitness.toString()})()`, context);
  const fire = (name, type, overrides = {}) => {
    for (const entry of [...listeners].filter(item => item.name === name && item.type === type)) {
      entry.handler({ isTrusted: true, defaultPrevented: false, eventPhase: entry.options.capture ? 1 : 3,
        timeStamp: ++at, key: type.startsWith('key') ? 'Enter' : undefined, target: skip, ...overrides });
    }
  };
  const frame = () => {
    const [id, callback] = pendingFrames.entries().next().value;
    pendingFrames.delete(id); callback(++at);
  };
  return { context, window, document, finder, skip, listeners, pendingFrames, microtasks, cancelled, install, fire, frame };
}

test('skip witness observes trusted input, state and two frames without changing navigation', () => {
  const f = browserFixture(), initial = f.install();
  assert.equal(initial.state.y, 300);
  assert.equal(initial.state.finderDocumentTop, 74);
  assert.equal(initial.state.header.height, 74);
  assert.equal(initial.state.enhancement, 'ready');
  assert.equal(f.listeners.length, 10);
  assert.ok(f.listeners.every(item => item.options.passive));
  assert.equal(f.pendingFrames.size, 0);
  f.fire('document', 'keydown'); f.fire('document', 'click');
  f.context.location.hash = '#finder'; f.document.activeElement = f.finder;
  f.fire('window', 'hashchange', { target: f.window });
  f.fire('document', 'keyup', { target: f.finder });
  for (const microtask of f.microtasks) microtask();
  assert.equal(f.pendingFrames.size, 0, 'input delivery does not schedule diagnostic frames');
  f.window.__rwnSkipLinkWitness.observeFrames();
  f.frame(); f.context.scrollY = 0; f.frame();
  const result = f.window.__rwnSkipLinkWitness.snapshot();
  assert.deepEqual(Array.from(result.frames, entry => entry.y), [300, 0]);
  assert.equal(result.frames.length, 2);
  assert.equal(f.pendingFrames.size, 0);
  assert.equal(result.events.find(entry => entry.label === 'click:capture').trusted, true);
  assert.equal(result.events.find(entry => entry.label === 'click:bubble').defaultPrevented, false);
  assert.equal(result.events.find(entry => entry.label === 'click:microtask').trusted, null);
  assert.equal(result.events.find(entry => entry.label === 'hashchange:bubble').hash, '#finder');
  assert.equal(result.events.find(entry => entry.label === 'keyup:capture').target, 'finder');
  f.window.__rwnSkipLinkWitness.dispose();
  assert.equal(f.window.__rwnSkipLinkWitness, undefined);
  assert.equal(f.listeners.length, 0);
});

test('witness bounds events, rejects duplicate installation and cancels pending frames on disposal', () => {
  const f = browserFixture(); f.install();
  const witness = f.window.__rwnSkipLinkWitness;
  assert.throws(f.install, /already installed/);
  assert.equal(f.window.__rwnSkipLinkWitness, witness);
  for (let i = 0; i < 100; i++) f.fire('window', 'scroll', { target: f.window });
  assert.equal(witness.snapshot().events.length, 80);
  f.fire('document', 'click');
  assert.equal(f.pendingFrames.size, 0);
  witness.observeFrames(); witness.observeFrames();
  assert.equal(f.pendingFrames.size, 1);
  witness.dispose();
  const count = witness.snapshot().events.length;
  for (const microtask of f.microtasks) microtask();
  assert.equal(witness.snapshot().events.length, count);
  assert.equal(f.cancelled.length, 1);
  assert.equal(f.listeners.length, 0);
  assert.equal(f.pendingFrames.size, 0);
});

function runner(overrides = {}) {
  const calls = [], record = { label: 'Keyboard skip at 1180px' }, evidence = [];
  const options = { record, evidence,
    install: async () => { calls.push('install'); return { state: { y: 0 } }; },
    run: async record => { calls.push('run'); record.immediate = { y: 0, active: 'finder' }; },
    read: async () => { calls.push('read'); return { state: { y: 0 }, events: [], frames: [{ y: 0 }, { y: 0 }] }; },
    observeFrames: async () => { calls.push('frames'); },
    capture: async () => { calls.push('capture'); },
    dispose: async () => { calls.push('dispose'); },
    wait: async () => { calls.push('wait'); },
    ...overrides,
  };
  return { options, calls, record, evidence };
}

test('a passing original check adds evidence and cleans up without extra inputs, captures or settling', async () => {
  const f = runner(); await withSkipLinkEvidence(f.options);
  assert.deepEqual(f.calls, ['install', 'run', 'read', 'dispose']);
  assert.equal(f.evidence[0], f.record);
  assert.equal(f.record.failed, undefined);
});

test('an immediate failure remains the same failure even when later frames reach the destination', async () => {
  const original = new Error('Keyboard skip link did not arrive immediately');
  const f = runner({ run: async record => { record.immediate = { y: 299, active: 'finder' }; throw original; } });
  await assert.rejects(withSkipLinkEvidence(f.options), error => error === original);
  assert.equal(f.record.immediate.y, 299);
  assert.equal(f.record.failed, true);
  assert.equal(f.record.failureEvidence.snapshots.at(-1).state.y, 0);
  assert.equal(f.record.failureEvidence.screenshot, true);
  assert.equal(f.calls.filter(call => call === 'capture').length, 1);
  assert.equal(f.calls.filter(call => call === 'frames').length, 1);
  assert.equal(f.calls.filter(call => call === 'dispose').length, 1);
  assert.equal(f.calls.filter(call => call === 'wait').length, 0);
});

test('missing presented frames are bounded and never turn failure into success', async () => {
  const original = new Error('immediate failure');
  let time = 0;
  const f = runner({ run: async () => { throw original; },
    read: async () => ({ state: { y: 299 }, frames: [] }), now: () => time,
    failureDeadlineMs: 100, wait: async ms => { time += ms; },
  });
  await assert.rejects(withSkipLinkEvidence(f.options), error => error === original);
  assert.match(f.record.failureEvidence.error, /deadline exceeded/);
  assert.equal(time, 100);
  assert.equal(f.calls.at(-1), 'dispose');
});

test('hung diagnostics are bounded and their timeout cannot replace the original failure', async () => {
  const original = new Error('original immediate failure');
  const f = runner({ run: async () => { throw original; }, read: () => new Promise(() => {}), failureDeadlineMs: 20 });
  await assert.rejects(withSkipLinkEvidence(f.options), error => error === original);
  assert.match(f.record.failureEvidence.error, /deadline exceeded/);
  assert.equal(f.calls.at(-1), 'dispose');
});

test('capture and cleanup errors are recorded while the original assertion still rejects', async () => {
  const original = new Error('original assertion');
  const f = runner({ run: async () => { throw original; },
    capture: async () => { throw new Error('screenshot unavailable'); },
    dispose: async () => { throw new Error('cleanup unavailable'); },
  });
  await assert.rejects(withSkipLinkEvidence(f.options), error => error === original);
  assert.equal(f.record.failureEvidence.captureError, 'screenshot unavailable');
  assert.equal(f.record.failureEvidence.snapshots.length, 2);
  assert.equal(f.record.cleanupError, 'cleanup unavailable');
});

test('cleanup failure after a successful check is not silently accepted', async () => {
  const f = runner({ dispose: async () => { throw new Error('cleanup unavailable'); } });
  await assert.rejects(withSkipLinkEvidence(f.options), /cleanup unavailable/);
});

test('integration captures native geometry before Enter and checks arrival without waiting', async () => {
  const source = await readFile(new URL('../scripts/qa-page-interactions.mjs', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const readSkipWitness'), source.indexOf('\n    await loadHome();', source.indexOf('const readSkipWitness')));
  assert.match(block, /record\.prepared = await evaluate\(client, `scrollTo\([\s\S]*?focus\(\{preventScroll:true\}\); window\.__rwnSkipLinkWitness\.snapshot\(\)`\)/);
  const preparation = block.slice(block.indexOf('record.prepared ='), block.indexOf("type:'keyDown',key:'Enter'"));
  assert.equal((preparation.match(/await evaluate/g) || []).length, 1);
  assert.doesNotMatch(preparation, /await readSkipWitness|settle\(|arrive\(|wait\(|requestAnimationFrame/);
  assert.match(preparation, /record\.expected = skipLinkDestination\(record\.prepared\.state\)/);
  assert.match(block, /record\.immediate = skipImmediate;\s*assert\(hasImmediateSkipLinkArrival\(skipImmediate, record\.expected\), 'Keyboard skip link did not arrive immediately'/);
  assert.equal((block.match(/type:'keyDown',key:'Enter'/g) || []).length, 1);
  assert.equal((block.match(/type:'keyUp',key:'Enter'/g) || []).length, 1);
  const immediate = block.slice(block.indexOf("type:'keyDown',key:'Enter'"), block.indexOf('assert(hasImmediateSkipLinkArrival'));
  assert.doesNotMatch(immediate, /settle\(|arrive\(|wait\(|requestAnimationFrame/);
  assert.match(block, /page-interactions-skip-failure-\$\{width\}\.png/);
  assert.doesNotMatch(installSkipLinkWitness.toString(), /preventDefault\(|\.focus\(|scrollTo\(|scrollIntoView\(|dispatchEvent\(|classList\.(?:add|remove)/);
});


test('failed setup neither activates navigation nor removes an existing witness', async () => {
  const error = new Error('already installed');
  const f = runner({ install: async () => { throw error; } });
  await assert.rejects(withSkipLinkEvidence(f.options), actual => actual === error);
  assert.equal(f.record.setupFailed, true);
  assert.deepEqual(f.calls, []);
});
