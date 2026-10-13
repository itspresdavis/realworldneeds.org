import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContactFixtureApp } from './qa-contact-fixture-app.mjs';
import { directoryStartupClickPoint, directoryStartupClickWasDelivered } from './qa-directory-startup.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message, value) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(value)}`); };

// Real controlled-worker navigations against an isolated synthetic HTTP server.
// Faults are server responses, never replaced fetch functions or UI state.
export async function verifyNavigationRecovery({ client, navigate, evaluate, capture, qaDir }) {
  const control = { mode: 'healthy', paths: ['/directory', '/directory/help/food', '/directory/united-states'], requests: [] };
  const app = await createContactFixtureApp({ navigationControl: control });
  const cases = [];
  const poll = async (expression, condition, description) => {
    let state;
    for (let attempt = 0; attempt < 180; attempt++) {
      state = await evaluate(client, expression);
      if (condition(state)) return state;
      await sleep(100);
    }
    throw new Error(`${description}: ${JSON.stringify(state)}`);
  };
  const stateExpression = `(() => {
    const notice = document.getElementById('offlineDirectoryNotice');
    const retry = notice?.querySelector('[data-directory-reconnect]');
    return { href: location.href, controlled: Boolean(navigator.serviceWorker.controller), online: navigator.onLine,
      marker: Boolean(document.querySelector('meta[name="rwn-offline-navigation"]')), warning: Boolean(notice && !notice.hidden),
      state: notice?.dataset.networkState, checking: retry?.getAttribute('aria-disabled') === 'true',
      notice: notice?.textContent, results: document.querySelectorAll('.directory-global-result').length,
      query: document.querySelector('[data-directory-query]')?.value,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
  })()`;
  try {
    await navigate(client, `${app.host}/directory`);
    const primed = await evaluate(client, `(async () => {
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation fixture worker readiness deadline')), 9000))]);
      for (let n = 0; n < 100 && !navigator.serviceWorker.controller; n++) await new Promise(r => setTimeout(r, 50));
      await fetch('/data/search-index.json');
      return Boolean(navigator.serviceWorker.controller);
    })()`);
    check(primed, 'Synthetic directory is not controlled');
    await navigate(client, `${app.host}/directory/help/food`);
    await poll(`caches.match('/directory/help/food').then(Boolean)`, Boolean, 'Exact directory page did not warm');
    const missingBefore = await evaluate(client, `caches.match('/directory/united-states').then(Boolean)`);
    check(!missingBefore, 'Root-fallback case must start without an exact page');

    for (const [mode, path, copy] of [['503', '/directory/help/food', 'exact'], ['504', '/directory/united-states', 'root'], ['hung-headers', '/directory/help/food', 'exact'], ['hung-body', '/directory/united-states', 'root']]) {
      control.mode = mode;
      const firstRequest = control.requests.length;
      const started = Date.now();
      await navigate(client, app.host + path, 100);
      const recovered = await poll(stateExpression, state => state.marker && state.warning && state.state === 'offline', 'Failed navigation did not recover with an immediate honest warning');
      const elapsedMs = Date.now() - started;
      check(recovered.controlled && recovered.online && elapsedMs < 12_000, 'Recovery requires an active worker while browser remains online and is bounded', { recovered, elapsedMs });
      await evaluate(client, `(() => {
        const input = document.querySelector('[data-directory-query]');
        input.value = 'Synthetic'; input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const searching = await poll(stateExpression, state => state.results > 0, 'Cached directory search did not return local synthetic results');
      check(searching.warning && searching.overflow <= 8 && /Reconnect before traveling or relying on a listing/i.test(searching.notice), 'Cached directory lost warning or overflow protection', searching);
      const cache = await evaluate(client, `(async () => {
        const copy = await caches.match(${JSON.stringify(copy === 'exact' ? path : '/directory')});
        return { marker: (await copy.text()).includes('rwn-offline-navigation'), catalog: Boolean(await caches.match('/data/search-index.json')) };
      })()`);
      check(!cache.marker && cache.catalog, 'Offline marker persisted or catalog was lost', cache);
      await capture(client, `directory-navigation-${mode}.png`);
      await poll(stateExpression, state => !state.checking, 'Initial bounded retry did not settle');
      const faultRequests = control.requests.slice(firstRequest);
      check(faultRequests.some(r => r.navigation && r.mode === mode) && faultRequests.some(r => r.probe && r.mode === mode), 'Fixture did not exercise both the real navigation and uncached route probe', faultRequests);
      if (mode.startsWith('hung')) {
        for (let n = 0; n < 20 && !faultRequests.every(r => r.closed); n++) await sleep(50);
        check(faultRequests.every(r => r.closed), 'Deadline did not close hung HTTP connections', faultRequests);
      }
      control.mode = 'healthy';
      const retryPoint = await evaluate(client, `(${directoryStartupClickPoint})('[data-directory-reconnect]')`);
      for (const type of ['mousePressed', 'mouseReleased']) await client.call('Input.dispatchMouseEvent', { type, ...retryPoint, button: 'left', clickCount: 1 });
      const click = await evaluate(client, `(() => { const proof = globalThis.__rwnDirectoryClickQA; proof.stop(); return { events: proof.events, frames: proof.frames }; })()`);
      check(directoryStartupClickWasDelivered(click), 'Retry did not receive the intended native click', click);
      const online = await poll(stateExpression, state => state.state === 'online' && !state.marker && !state.checking, 'Native Retry did not recover the directory endpoint');
      check(online.query === 'Synthetic' && online.results > 0, 'Reconnection lost the current search', online);
      cases.push({ mode, path, copy, elapsedMs, recovered, searching, online, click, requests: faultRequests });
    }

    // These are genuine endpoint decisions, not transient failures. The active
    // worker must return them and remove the former exact cached page.
    for (const mode of ['404', '410']) {
      control.mode = 'healthy';
      await navigate(client, `${app.host}/directory/help/food`);
      await poll(`caches.match('/directory/help/food').then(Boolean)`, Boolean, 'Withdrawal fixture did not rewarm');
      control.mode = mode;
      await navigate(client, `${app.host}/directory/help/food`);
      const withdrawn = await evaluate(client, `({ body: document.body.textContent, marker: Boolean(document.querySelector('meta[name="rwn-offline-navigation"]')), controlled: Boolean(navigator.serviceWorker.controller) })`);
      check(withdrawn.controlled && withdrawn.body.includes(`Synthetic navigation ${mode}`) && !withdrawn.marker, 'Withdrawal was replaced by a cached directory', withdrawn);
      await poll(`caches.match('/directory/help/food').then(Boolean)`, saved => !saved, 'Withdrawn exact directory remained cached');
      cases.push({ mode, withdrawn });
    }
    // Service pages remain network-only even with a warm root directory.
    control.paths.push('/service/qa-contact-web'); control.mode = '410';
    await navigate(client, `${app.host}/service/qa-contact-web`);
    const service = await evaluate(client, `({ body: document.body.textContent, marker: Boolean(document.querySelector('meta[name="rwn-offline-navigation"]')) })`);
    check(service.body.includes('Synthetic navigation 410') && !service.marker, 'Withdrawn service was replaced with the directory', service);
    cases.push({ serviceWithdrawal: service });
    // No compatible copy is also an honest result, not a fabricated success.
    await evaluate(client, `(async () => {
      for (const name of await caches.keys()) if (name.startsWith('rwn-offline-') && name !== 'rwn-offline-runtime-v1') {
        const cache = await caches.open(name); await cache.delete('/directory');
      }
    })()`);
    control.mode = '503';
    await navigate(client, `${app.host}/directory/help/food`);
    const empty = await evaluate(client, `({ body: document.body.textContent, marker: Boolean(document.querySelector('meta[name="rwn-offline-navigation"]')) })`);
    check(empty.body.includes('Synthetic navigation 503') && !empty.marker, 'No-cache transient response was misrepresented', empty);
    cases.push({ noCopy: empty });
    await writeFile(join(qaDir, 'directory-navigation-recovery.json'), JSON.stringify({ synthetic: true, cases }, null, 2));
    console.log('RWN navigation recovery passed: active-worker 503/504 and header/body deadlines recover compatible exact/root pages with honest warnings, local search and native Retry; 404/410 and withheld service decisions remain intact.');
  } catch (error) {
    const current = await evaluate(client, stateExpression).catch(() => null);
    await capture(client, 'directory-navigation-failure.png').catch(() => {});
    await writeFile(join(qaDir, 'directory-navigation-recovery-failure.json'), JSON.stringify({ synthetic: true, error: error.message, mode: control.mode, current, cases, requests: control.requests }, null, 2));
    throw error;
  } finally {
    control.mode = 'healthy';
    await navigate(client, 'about:blank', 0).catch(() => {});
    await app.cleanup();
  }
}
