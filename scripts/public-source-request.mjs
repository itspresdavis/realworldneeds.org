import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';

export class SourceRequestBlocked extends Error {
  constructor(reason) { super(reason); this.name = 'SourceRequestBlocked'; this.reason = reason; }
}
const blocked = reason => { throw new SourceRequestBlocked(reason); };

export function isPublicSourceAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
      || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 && [0, 2].includes(c) || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113);
  }
  if (family !== 6 || address.includes('%')) return false;
  // Use a conservative global-unicast allow range. All mapped, NAT64,
  // loopback, unspecified, local, link-local and multicast addresses fail.
  const expanded = address.toLowerCase().split('::');
  if (expanded.length > 2 || address.includes('.')) return false;
  const left = expanded[0] ? expanded[0].split(':') : [];
  const right = expanded[1] ? expanded[1].split(':') : [];
  const parts = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(value => Number.parseInt(value, 16));
  const [a, b] = parts;
  if (a < 0x2000 || a > 0x3fff) return false;
  if (a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) return false;
  if (a === 0x2002 || a === 0x3fff && b < 0x1000) return false;
  return true;
}

export function validPublicSourceUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    return value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password
      && !url.port && host.includes('.') && !host.endsWith('.') && !isIP(host)
      && !host.startsWith('[') && !/(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host);
  } catch { return false; }
}

export function requiresProxy({ env = process.env, readPolicy = () => readFileSync('/etc/codex/network-policy.json', 'utf8') } = {}) {
  if (['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some(key => env[key])) return true;
  try {
    const policy = JSON.parse(readPolicy());
    // If a managed proxy is declared, never silently open a direct socket.
    return Boolean(policy.proxy || policy.proxy_url || policy.proxyUrl || policy.http_proxy || policy.https_proxy
      || policy.http_network_policy?.mode && policy.http_network_policy.mode !== 'unrestricted');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    // A malformed/unreadable managed policy is not authorization for direct I/O.
    return true;
  }
}

// A per-request resolver can be cancelled at the shared deadline. It avoids
// leaving an unbounded OS getaddrinfo lookup alive after the sample times out.
export async function resolveSourceAddresses(hostname, { signal, resolver = new Resolver({ timeout: 3000, tries: 1 }) } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  const cancel = () => resolver.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const answers = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const addresses = answers.flatMap((answer, index) => answer.status === 'fulfilled' ? answer.value.map(address => ({ address, family: index === 0 ? 4 : 6 })) : []);
    if (!addresses.length) throw new Error('Source DNS resolution unavailable');
    return addresses;
  } finally { signal?.removeEventListener('abort', cancel); }
}

function abortable(promise, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const sameAddress = (left, right) => {
  const a = left?.replace(/^::ffff:/i, ''), b = right?.replace(/^::ffff:/i, '');
  if (isIP(a) === 6 && isIP(b) === 6) return new URL(`https://[${a}]`).hostname === new URL(`https://[${b}]`).hostname;
  return a === b;
};

// Status-only transport: response bodies are destroyed on receipt, including
// HEAD responses and servers that ignore Range. No cookies or auth are sent.
export function pinnedHttpsStatus(url, { method, addresses, signal, requestImpl = httpsRequest } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    const finishError = error => { request?.destroy(); reject(error); };
    request = requestImpl(url, {
      method, agent: false, signal, maxHeaderSize: 16_384,
      headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
      lookup: (hostname, options, callback) => {
        if (hostname !== url.hostname) return callback(new SourceRequestBlocked('unexpected-lookup-host'));
        const candidates = options?.family ? addresses.filter(item => item.family === options.family) : addresses;
        if (!candidates.length) return callback(new SourceRequestBlocked('unavailable-address-family'));
        if (options?.all) callback(null, candidates.map(item => ({ ...item })));
        else callback(null, candidates[0].address, candidates[0].family);
      },
    }, response => {
      const headers = new Headers();
      if (typeof response.headers.location === 'string') headers.set('location', response.headers.location);
      const result = { status: response.statusCode, headers };
      response.destroy();
      request.destroy();
      resolve(result);
    });
    request.on('error', reject);
    request.on('socket', socket => {
      const check = () => {
        if (!addresses.some(item => sameAddress(socket.remoteAddress, item.address))) finishError(new SourceRequestBlocked('unexpected-connected-address'));
      };
      if (socket.connecting) socket.once('connect', check); else check();
    });
    request.end();
  });
}

export function createPublicSourceRequester({ lookup = resolveSourceAddresses, transport = pinnedHttpsStatus, proxyRequired = requiresProxy } = {}) {
  return async function requestPublicSource(value, { method = 'HEAD', signal } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    if (!validPublicSourceUrl(value)) blocked('unsafe-source-url');
    if (!['HEAD', 'GET'].includes(method)) blocked('unsupported-method');
    if (proxyRequired()) blocked('proxy-pinning-unavailable');
    const url = new URL(value);
    const addresses = await abortable(Promise.resolve().then(() => lookup(url.hostname, { all: true, verbatim: true, signal })), signal);
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 32) blocked('invalid-dns-answer');
    if (addresses.some(item => !item || ![4, 6].includes(item.family) || isIP(item.address) !== item.family || !isPublicSourceAddress(item.address))) blocked('nonpublic-dns-answer');
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const pinned = [...new Map(addresses.map(item => [`${item.family}:${item.address}`, { address: item.address, family: item.family }])).values()];
    return abortable(transport(url, { method, addresses: pinned, signal }), signal);
  };
}
export const publicSourceRequest = createPublicSourceRequester();
