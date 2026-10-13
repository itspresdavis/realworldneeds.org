// Bound the entire request, including JSON parsing. Abort alone is insufficient:
// a worker or stalled body can ignore it, so callers also race a rejection.
export function createCatalogLoader(url, requireScopes = false) {
  let request, cancel;
  let fresh = false;
  const load = () => {
    if (request) return request;
    const controller = new AbortController();
    let timer, interrupt;
    const interrupted = new Promise((_, reject) => {
      interrupt = () => {
        controller.abort();
        reject(new Error("Directory request interrupted"));
      };
      timer = setTimeout(interrupt, 8000);
    });
    cancel = interrupt;
    const pending = Promise.race([
      (async () => {
        const response = await fetch(fresh ? "/data/search-index.json" : url, {
          credentials: "same-origin", cache: fresh ? "reload" : "force-cache", signal: controller.signal
        });
        if (!response.ok) throw new Error("Directory unavailable");
        const payload = await response.json();
        if (!Array.isArray(payload?.records) || requireScopes && !payload.scopes) throw new Error("Invalid directory");
        return payload;
      })(),
      interrupted
    ]).catch(error => {
      if (request === pending) request = undefined;
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      if (cancel === interrupt) cancel = undefined;
    });
    return request = pending;
  };
  // Network transitions replace only unfinished work, preserving a usable
  // versioned offline catalog. A release replacement also discards cached data.
  load.retry = () => {
    if (!cancel) return;
    cancel();
    cancel = request = undefined;
  };
  load.reset = () => { load.retry(); request = undefined; fresh = true; };
  return load;
}
