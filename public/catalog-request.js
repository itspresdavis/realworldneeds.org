// Exact compatibility gate: 2.0 requires service-specific actions and removes
// generic coordinates from those records. Older catalogs cannot supply safe routes.
export const SEARCH_CATALOG_SCHEMA = "2.0";

// Bound the entire request, including JSON parsing. Abort alone is insufficient:
// a worker or stalled body can ignore it, so callers also race a rejection.
export function createCatalogLoader(url, requireScopes = false) {
  let request, cancel;
  let fresh = false, cached = false;
  const reportCacheStatus = value => {
    cached = value;
    if (typeof document === "undefined") return;
    // Multiple directory/Saved consumers must all refresh before the page can
    // claim its displayed catalog is current. The set retains only stale loader identities.
    const key = Symbol.for("rwn.catalog-cache-status");
    const statuses = window[key] ||= new Set();
    statuses[cached ? "add" : "delete"](load);
    const stale = Boolean(statuses.size);
    document.documentElement.dataset.rwnCatalogCached = String(stale);
    window.dispatchEvent(new CustomEvent("rwn-catalog-status", { detail: { cached: stale } }));
  };
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
        if (payload?.schemaVersion !== SEARCH_CATALOG_SCHEMA || !Array.isArray(payload.records) || requireScopes && !payload.scopes) throw new Error("Invalid directory");
        if (request === pending && !controller.signal.aborted) reportCacheStatus(response.headers?.get("X-RWN-Catalog-Cache") === "stale");
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
    if (!cancel) {
      // A recovered connection must revalidate a previously returned offline
      // copy; settled fresh data can still be reused without a new request.
      if (cached) request = undefined;
      return;
    }
    cancel();
    cancel = request = undefined;
  };
  load.reset = () => { load.retry(); request = undefined; fresh = true; };
  return load;
}
