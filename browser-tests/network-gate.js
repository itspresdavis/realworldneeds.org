import { createServer } from "node:http";

// A temporary local candidate proxy makes outages apply to service workers too:
// Firefox's browser-context offline emulation can leave worker networking live.
export async function createNetworkGate(baseURL) {
  const upstream = new URL(baseURL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname)
    || upstream.username || upstream.password || upstream.protocol !== "http:") {
    throw Error("Offline QA requires an explicit local HTTP candidate server");
  }
  let offline = false;
  const active = new Set();
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture.invalid");
    if (request.method !== "GET" || /^\/(?:api(?:\/|$)|workspace(?:\/|$)|join(?:\/|$))/.test(path.pathname)) {
      response.writeHead(403); response.end("Public static QA only"); return;
    }
    if (offline) {
      response.writeHead(503, { "Cache-Control": "no-store", "Content-Type": "text/plain" });
      response.end("Controlled QA outage"); return;
    }
    // Only the configured candidate origin is reachable. An absolute incoming
    // request URL cannot turn this test helper into an arbitrary forward proxy.
    const target = new URL(upstream.origin);
    target.pathname = path.pathname; target.search = path.search;
    const controller = new AbortController(); active.add(controller);
    try {
      const result = await fetch(target, {
        redirect: "manual", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const headers = {};
      for (const [key, value] of result.headers) {
        if (!["content-length", "content-encoding", "transfer-encoding", "connection", "set-cookie"].includes(key)) headers[key] = value;
      }
      if (headers.location) {
        const destination = new URL(headers.location, target);
        if (destination.origin !== upstream.origin) throw Error("Candidate redirect left its origin");
        headers.location = destination.pathname + destination.search + destination.hash;
      }
      const bytes = Buffer.from(await result.arrayBuffer());
      response.writeHead(result.status, headers); response.end(bytes);
    } catch {
      if (!response.headersSent) response.writeHead(502, { "Cache-Control": "no-store" });
      response.end("Candidate unavailable");
    } finally { active.delete(controller); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: "http://127.0.0.1:" + server.address().port,
    setOffline(value) { offline = Boolean(value); },
    async close() {
      for (const controller of active) controller.abort();
      const closing = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closing;
    },
  };
}
