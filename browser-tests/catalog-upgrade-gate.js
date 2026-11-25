import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// A bounded real-catalog fixture from the 574447c public 1.6 snapshot. Its
// missing service routes and organization coordinates are the unsafe legacy
// contract under test, not facts to publish into the current catalog.
export const legacyCatalog = {
  schemaVersion: '1.6', scopes: { '/directory': [0] }, records: [{
    id: 'bowery-mission', name: 'The Bowery Mission', place: 'New York, United States',
    country: 'United States', category: 'food', categories: ['food', 'shelter', 'hygiene', 'clothing', 'health'],
    categoryLabels: ['Food', 'Shelter', 'Hygiene', 'Clothing', 'Health'], kind: 'direct',
    phone: '(212) 226-6214', phoneLinks: [{ label: '(212) 226-6214', href: 'tel:2122266214' }],
    lat: 40.7219, lng: -73.9932, checked: '2026-08-04',
    search: '227 bowery new york ny 10002\nthe mission united states north america immediate meals food showers hygiene clothing medical health care and a separate overnight shelter intake in lower manhattan daily free mobile walk services direct\n\nshower\nny',
  }],
};

// Real service-worker/cache mechanics reproduce the old contract boundary:
// network-first JSON, query-insensitive cache key, and a stale response header.
// This small authored worker is not a full historical production worker.
const worker = `const CACHE='rwn-legacy-catalog-fixture';
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache=await caches.open(CACHE);
  await cache.put('/data/search-index.json', await fetch('/qa/legacy-index.json'));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if(new URL(event.request.url).pathname!=='/data/search-index.json'){
    // The historical worker responds to navigations. Explicit pass-through is
    // also required for Firefox to retain control of the new document.
    if(event.request.mode==='navigate')event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try { const response=await fetch('/data/search-index.json',{cache:'reload'});
      if(response.ok){await cache.put('/data/search-index.json',response.clone());return response;}
    } catch {}
    const saved=await cache.match('/data/search-index.json');
    if(!saved)return new Response('No cached catalog',{status:503});
    const fallback=new Response(saved.body,{status:saved.status,headers:saved.headers});
    fallback.headers.set('X-RWN-Catalog-Cache','stale');return fallback;
  })());
});`;

// Optional legacyBuild is used only for an additional local reproduction with
// complete historical assets. Portable CI tests use the authored worker above.
export async function createCatalogUpgradeGate(baseURL, { legacyBuild } = {}) {
  const upstream = new URL(baseURL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)
    || upstream.protocol !== 'http:' || upstream.username || upstream.password) throw Error('A local candidate server is required');
  const renderer = await readFile(new URL('./fixtures/legacy-directory-results.js', import.meta.url));
  const legacyRoot = legacyBuild && resolve(legacyBuild);
  let candidate = !legacyRoot, catalogAvailable = true, catalogPayload, workerRevision = 0;
  const active = new Set(), requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    if (requests.length < 300) requests.push(url.pathname + url.search);
    const send = (status, type, body) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' }); response.end(body);
    };
    if (request.method !== 'GET' || /^\/(?:api(?:\/|$)|workspace(?:\/|$)|join(?:\/|$))/.test(url.pathname)) return send(403, 'text/plain', 'Public static QA only');
    if (url.pathname === '/qa/bootstrap') return send(200, 'text/html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Catalog compatibility fixture</title></head><body></body></html>');
    if (url.pathname === '/qa/legacy-index.json') return send(200, 'application/json', JSON.stringify(legacyCatalog));
    if (url.pathname === '/qa/legacy-renderer.js') return send(200, 'text/javascript', renderer);
    if (url.pathname === '/data/search-index.json' && !catalogAvailable) return send(503, 'text/plain', 'Controlled catalog outage');
    if (url.pathname === '/data/search-index.json' && catalogPayload) return send(200, 'application/json', JSON.stringify(catalogPayload));
    if (url.pathname === '/sw.js' && !legacyRoot) return send(200, 'text/javascript', worker + '\n// fixture revision ' + workerRevision);
    if (legacyRoot && (!candidate || url.pathname === '/sw.js')) {
      const path = resolve(legacyRoot, '.' + url.pathname);
      if (!path.startsWith(legacyRoot + sep)) return send(404, 'text/plain', 'Not found');
      for (const name of [path, path + '.html', resolve(path, 'index.html')]) {
        try {
          const bytes = await readFile(name);
          const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
          return send(200, type, bytes);
        } catch { /* Try the next bounded static path. */ }
      }
      return send(404, 'text/plain', 'Legacy fixture asset unavailable');
    }
    const target = new URL(upstream.origin); target.pathname = url.pathname; target.search = url.search;
    const controller = new AbortController(); active.add(controller);
    try {
      const result = await fetch(target, { redirect: 'manual', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const headers = {};
      for (const [key, value] of result.headers) if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie'].includes(key)) headers[key] = value;
      if (headers.location) {
        const destination = new URL(headers.location, target);
        if (destination.origin !== upstream.origin) throw Error('Redirect left candidate origin');
        headers.location = destination.pathname + destination.search + destination.hash;
      }
      response.writeHead(result.status, headers); response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!response.headersSent) response.writeHead(502); response.end('Candidate unavailable');
    } finally { active.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: 'http://127.0.0.1:' + server.address().port, requests,
    useCandidate() { candidate = true; },
    setCatalogAvailable(value) { catalogAvailable = Boolean(value); },
    setCatalogPayload(value) { catalogPayload = value; },
    replaceWorker() { workerRevision += 1; },
    async close() {
      for (const controller of active) controller.abort();
      const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed;
    },
  };
}
