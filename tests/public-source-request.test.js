import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPublicSourceRequester, pinnedHttpsStatus, isPublicSourceAddress, validPublicSourceUrl, requiresProxy, resolveSourceAddresses, SourceRequestBlocked } from '../scripts/public-source-request.mjs';
import { sampleSourceLinks } from '../scripts/catalog-health.mjs';

const publicAnswer = [{ address: '93.184.216.34', family: 4 }];
const noProxy = () => false;

test('IP policy rejects private, loopback, link-local, mapped, multicast and reserved destinations', () => {
  for (const address of ['0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.254', '127.0.0.1', '169.254.169.254', '172.31.255.255', '192.168.1.1', '192.0.0.8', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2001::1', '2001:db8::1', '2002:7f00:1::', '3fff::1', 'not-an-ip']) assert.equal(isPublicSourceAddress(address), false, address);
  for (const address of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(isPublicSourceAddress(address), true, address);
});

test('source URL policy requires uncredentialed HTTPS on its default port', () => {
  for (const url of ['https://user:secret@example.org/', 'https://example.org:8443/', 'http://example.org/', 'https://127.1/', 'https://2130706433/', 'https://[2606:4700::1111]/', 'https://example.org./', 'https://metadata.internal/', 'https://foo.localhost/', 'https://example.org/\nheader']) assert.equal(validPublicSourceUrl(url), false, url);
  assert.equal(validPublicSourceUrl('https://example.org:443/help?type=meal'), true);
});

test('mixed or private DNS answers block before any request, not merely the first answer', async () => {
  let requests = 0;
  for (const addresses of [[{ address: '127.0.0.1', family: 4 }], [...publicAnswer, { address: '10.0.0.1', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }], [], [{ address: '8.8.8.8', family: 6 }]]) {
    const request = createPublicSourceRequester({ proxyRequired: noProxy, lookup: async () => addresses, transport: async () => { requests++; } });
    await assert.rejects(request('https://example.org/help'), SourceRequestBlocked);
  }
  assert.equal(requests, 0);
});

test('a validated answer set is pinned into transport; subsequent DNS changes cannot select a private address', async () => {
  let lookups = 0;
  const request = createPublicSourceRequester({ proxyRequired: noProxy, lookup: async () => { lookups++; return lookups === 1 ? publicAnswer : [{ address: '127.0.0.1', family: 4 }]; }, transport: async (url, options) => {
    assert.equal(url.hostname, 'example.org');
    assert.deepEqual(options.addresses, publicAnswer);
    return { status: 200, headers: new Headers() };
  } });
  assert.equal((await request('https://example.org/help')).status, 200);
  assert.equal(lookups, 1);
});

test('redirect destinations receive new DNS validation and a private redirect never receives a request', async () => {
  const requested = [];
  const request = createPublicSourceRequester({ proxyRequired: noProxy, lookup: async host => host === 'example.org' ? publicAnswer : [{ address: '169.254.169.254', family: 4 }], transport: async url => {
    requested.push(url.hostname); return { status: 302, headers: new Headers({ location: 'https://rebound.example.org/metadata' }) };
  } });
  const result = await sampleSourceLinks([{ sourceUrl: 'https://example.org/help' }], { fetchImpl: request });
  assert.deepEqual(requested, ['example.org']);
  assert.equal(result.results[0].outcome, 'blocked');
  assert.equal(result.results[0].reason, 'nonpublic-dns-answer');
});

test('proxy configuration fails closed without direct DNS/network attempts or bypassing NO_PROXY', async () => {
  assert.equal(requiresProxy({ env: { HTTPS_PROXY: 'http://managed-proxy.invalid', NO_PROXY: '*' }, readPolicy: () => '{}' }), true);
  assert.equal(requiresProxy({ env: {}, readPolicy: () => '{"proxy":"http://managed-proxy.invalid"}' }), true);
  assert.equal(requiresProxy({ env: {}, readPolicy: () => '{broken' }), true);
  assert.equal(requiresProxy({ env: {}, readPolicy: () => '{"http_network_policy":{"mode":"restricted"}}' }), true);
  assert.equal(requiresProxy({ env: {}, readPolicy: () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } }), false);
  let operations = 0;
  const request = createPublicSourceRequester({ proxyRequired: () => true, lookup: async () => { operations++; }, transport: async () => { operations++; } });
  const result = await sampleSourceLinks([{ sourceUrl: 'https://example.org/help' }], { fetchImpl: request });
  assert.equal(result.results[0].reason, 'proxy-pinning-unavailable');
  assert.equal(result.results[0].outcome, 'blocked');
  assert.equal(operations, 0);
});

test('one deadline bounds stalled DNS and prevents a late resolution from issuing a request', async () => {
  let resolveDns, requests = 0;
  const controller = new AbortController();
  const request = createPublicSourceRequester({ proxyRequired: noProxy, lookup: () => new Promise(resolve => { resolveDns = resolve; }), transport: async () => { requests++; } });
  const pending = request('https://example.org/help', { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new DOMException('Deadline', 'TimeoutError'));
  await assert.rejects(pending, { name: 'TimeoutError' });
  resolveDns(publicAnswer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
});

function fakeHttps(remoteAddress, capture) {
  return (url, options, callback) => {
    capture.url = url; capture.options = options;
    const request = new EventEmitter();
    request.destroy = () => { capture.requestDestroyed = true; };
    request.end = () => queueMicrotask(() => {
      const socket = new EventEmitter(); socket.connecting = true; socket.remoteAddress = remoteAddress;
      request.emit('socket', socket); socket.emit('connect');
      if (!capture.requestDestroyed) callback({ statusCode: 200, headers: { location: 'https://example.org/next' }, destroy: () => { capture.responseDestroyed = true; } });
    });
    return request;
  };
}

test('actual HTTPS transport pins lookup, checks connected address, keeps TLS validation and discards all bodies', async () => {
  const capture = {};
  const result = await pinnedHttpsStatus(new URL('https://example.org/help'), { method: 'GET', addresses: publicAnswer, requestImpl: fakeHttps('93.184.216.34', capture) });
  assert.equal(result.status, 200);
  assert.equal(capture.options.agent, false);
  assert.equal(capture.options.maxHeaderSize, 16_384);
  assert.notEqual(capture.options.rejectUnauthorized, false);
  assert.deepEqual(capture.options.headers, { Range: 'bytes=0-0' });
  assert.equal(capture.requestDestroyed, true);
  assert.equal(capture.responseDestroyed, true);
  await new Promise((resolve, reject) => capture.options.lookup('example.org', { all: true }, (error, answers) => { if (error) reject(error); else { assert.deepEqual(answers, publicAnswer); resolve(); } }));
  await new Promise(resolve => capture.options.lookup('different.example.org', {}, error => { assert.equal(error.reason, 'unexpected-lookup-host'); resolve(); }));
  const mismatch = {};
  await assert.rejects(pinnedHttpsStatus(new URL('https://example.org/help'), { method: 'HEAD', addresses: publicAnswer, requestImpl: fakeHttps('127.0.0.1', mismatch) }), { reason: 'unexpected-connected-address' });
  assert.equal(mismatch.requestDestroyed, true);
  assert.equal(mismatch.responseDestroyed, undefined);
});

test('a source sample uses one total deadline through HEAD fallback and every redirect', async () => {
  const signals = [];
  let call = 0;
  await sampleSourceLinks([{ sourceUrl: 'https://example.org/help' }], { fetchImpl: async (url, options) => {
    signals.push(options.signal); call++;
    return call === 1 ? { status: 405 } : call === 2 ? { status: 302, headers: new Headers({ location: 'https://example.org/final' }) } : { status: 200 };
  } });
  assert.equal(signals.length, 3);
  assert.equal(new Set(signals).size, 1);
});


test('the default resolver cancels both address-family queries at the deadline', async () => {
  const controller = new AbortController();
  const rejectors = [];
  let cancelled = 0;
  const resolver = { resolve4: () => new Promise((resolve, reject) => rejectors.push(reject)), resolve6: () => new Promise((resolve, reject) => rejectors.push(reject)), cancel: () => { cancelled++; rejectors.forEach(reject => reject(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }))); } };
  const pending = resolveSourceAddresses('example.org', { signal: controller.signal, resolver });
  controller.abort(new DOMException('Deadline', 'TimeoutError'));
  await assert.rejects(pending, { name: 'TimeoutError' });
  assert.equal(cancelled, 1);
  assert.equal(rejectors.length, 2);
});
