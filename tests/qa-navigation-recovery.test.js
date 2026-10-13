import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNavigationRecoveryTransport } from '../scripts/qa-navigation-recovery.mjs';

const fixture = () => ({ host: 'http://127.0.0.1:4000', path: '/directory/help/food', mode: '503',
  navigationResponses: [{ url: 'http://127.0.0.1:4000/directory/help/food', status: 200, fromServiceWorker: true }],
  faultRequests: [
    { path: '/directory/help/food', mode: '503', probe: false, fetchMode: 'cors', method: 'GET', hasQuery: false },
    { path: '/directory/help/food', mode: '503', probe: true, fetchMode: 'cors', method: 'GET', hasQuery: false }
  ] });

test('navigation transport proof uses the controlled Document, not an outgoing HTTP fetch-mode inference', () => {
  assert.doesNotThrow(() => assertNavigationRecoveryTransport(fixture()));
});
for (const [label, change] of [
  ['missing document', f => { f.navigationResponses = []; }],
  ['bypassed worker', f => { f.navigationResponses[0].fromServiceWorker = false; }],
  ['server error document', f => { f.navigationResponses[0].status = 503; }],
  ['different document route', f => { f.navigationResponses[0].url += '/other'; }],
  ['missing navigation request', f => { f.faultRequests.shift(); }],
  ['missing independent probe', f => { f.faultRequests.pop(); }],
  ['healthy navigation instead of intended fault', f => { f.faultRequests[0].mode = 'healthy'; }],
  ['wrong fault', f => { f.faultRequests[1].mode = '504'; }],
  ['probe on another route', f => { f.faultRequests[1].path = '/data/release.json'; }],
  ['non-GET probe', f => { f.faultRequests[1].method = 'HEAD'; }],
  ['query-bearing probe', f => { f.faultRequests[1].hasQuery = true; }]
]) test(`navigation transport proof rejects ${label}`, () => {
  const value = fixture(); change(value);
  assert.throws(() => assertNavigationRecoveryTransport(value), /active-worker document/);
});
