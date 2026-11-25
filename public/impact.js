// Browser reads one same-origin public rollup. No access to the inventory ledger.
const KEYS = ["shoes", "clothing", "socks", "water", "food", "hygiene", "other"];
const MAX_BYTES = 8_192;
const COOLDOWN_MS = 15_000;
const whole = (value) => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (obj, expected) =>
  obj !== null && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).length === expected.length && expected.every((key) => Object.hasOwn(obj, key));

export function validImpact(value) {
  if (!exactKeys(value, ["schemaVersion", "status", "updatedAt", "currency", "estimatedValueCents", "totals"]) ||
    value.schemaVersion !== 1 || value.currency !== "USD") return false;
  if (value.status === "unpublished") {
    return value.updatedAt === null && value.estimatedValueCents === null && value.totals === null;
  }
  if (value.status !== "published" || typeof value.updatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.updatedAt)) return false;
  const date = new Date(value.updatedAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().replace(".000Z", "Z") !== value.updatedAt.replace(".000Z", "Z")) return false;
  return (value.estimatedValueCents === null || (whole(value.estimatedValueCents) && value.estimatedValueCents < 1e15)) &&
    exactKeys(value.totals, KEYS) && KEYS.every((key) => whole(value.totals[key]));
}

export async function loadImpact(request = fetch) {
  const response = await request("/impact-summary.json", {
    credentials: "omit",
    mode: "same-origin",
    redirect: "error",
    cache: "no-cache",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "") || !response.body ||
    Number(response.headers.get("content-length") || 0) > MAX_BYTES) {
    throw new Error("Impact summary unavailable");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, source = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Impact summary too large");
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(source);
  if (!validImpact(value)) throw new Error("Invalid impact summary");
  return value;
}

export function connectImpact(document, window) {
  const panel = document.querySelector("[data-impact]");
  if (!panel) return;
  const money = panel.querySelector("[data-impact-value]");
  const status = panel.querySelector("[data-impact-status]");
  const publishedAt = panel.querySelector("[data-impact-time]");
  const refreshButton = panel.querySelector("[data-impact-refresh]");
  const numberFormat = new Intl.NumberFormat("en-US");
  const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  let fetching = false, lastCheck = null, seen = false;
  const refresh = async (manual = false) => {
    const now = window.performance.now();
    if (fetching) return;
    if (lastCheck !== null && now - lastCheck < COOLDOWN_MS) {
      if (manual) status.textContent = "Just checked. Wait a moment before refreshing again.";
      return;
    }
    fetching = true;
    refreshButton.setAttribute("aria-disabled", "true");
    lastCheck = now;
    try {
      const value = await loadImpact();
      const published = value.status === "published";
      for (const key of KEYS) panel.querySelector(`[data-count="${key}"]`).textContent = published ? numberFormat.format(value.totals[key]) : "Not yet published";
      money.textContent = published && value.estimatedValueCents !== null ? moneyFormat.format(value.estimatedValueCents / 100) : "Not yet published";
      publishedAt.hidden = !published;
      if (published) {
        publishedAt.dateTime = value.updatedAt;
        publishedAt.textContent = "Last published: " + new Date(value.updatedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";
      } else {
        publishedAt.removeAttribute("datetime");
        publishedAt.textContent = "";
      }
      seen = published;
      const message = published ? "Showing the latest published distribution totals." : "Verified distribution totals haven’t been published yet.";
      if (status.textContent !== message) status.textContent = message;
    } catch {
      status.textContent = seen ? "Couldn’t refresh. Showing the last published totals loaded on this visit." : "Impact totals aren’t available right now. Please check back.";
    } finally {
      fetching = false;
      refreshButton.removeAttribute("aria-disabled");
    }
  };
  refreshButton.hidden = false;
  refreshButton.addEventListener("click", () => void refresh(true));
  void refresh();
}

if (typeof window !== "undefined") connectImpact(document, window);
