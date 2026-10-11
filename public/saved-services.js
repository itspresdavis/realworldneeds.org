import { SAVED_RESOURCES_KEY, readSavedResources, setResourceSaved, clearSavedResources } from "../src/utils/privacy.js";

import { createResultRow } from "./directory-results.js";

export function initSavedServices() {
  const connectivityNotice = document.getElementById("offlineDirectoryNotice");
  const release = new URL(import.meta.url).searchParams.get("v") || "";
  let catalogPromise;
  let freshCatalog = false;
  const loadCatalog = () => {
    if (catalogPromise) return catalogPromise;
    const request = fetch(`/data/search-index.json${!freshCatalog && release ? `?v=${encodeURIComponent(release)}` : ""}`, {
      credentials: "same-origin", cache: freshCatalog ? "reload" : "force-cache"
    }).then((response) => {
      if (!response.ok) throw new Error("Directory unavailable");
      return response.json();
    }).then((payload) => {
      if (!Array.isArray(payload.records)) throw new Error("Invalid directory");
      return payload;
    }).catch((error) => { if (catalogPromise === request) catalogPromise = undefined; throw error; });
    return catalogPromise = request;
  };
  const panel = document.querySelector("[data-saved-services]");
  if (!panel) return;
  const heading = panel.querySelector("h2");
  const summary = panel.querySelector("[data-saved-summary]");
  const status = panel.querySelector("[data-saved-status]");
  const list = panel.querySelector("[data-saved-list]");
  const retry = panel.querySelector("[data-saved-retry]");
  const clear = panel.querySelector("[data-saved-clear]");
  const confirmation = panel.querySelector("[data-saved-confirmation]");
  const more = panel.querySelector("[data-saved-more]");
  let generation = 0;
  let entries = [];
  let shown = 0;
  const active = () => location.hash === "#saved";
  const announceFailure = () => { status.textContent = "Your saved list could not be changed. Check this browser’s storage settings and try again."; };
  const cancelClear = (focus = false) => {
    confirmation.hidden = true;
    clear.setAttribute("aria-expanded", "false");
    if (focus) clear.focus();
  };

  const renderMore = () => {
    const first = shown;
    for (const { id, record } of entries.slice(shown, shown + 60)) {
      const row = record ? createResultRow(record, connectivityNotice) : document.createElement("div");
      row.classList.add("saved-service-row");
      row.dataset.savedId = id;
      if (!record) {
        const text = document.createElement("p");
        text.textContent = "This saved listing is no longer in the current directory.";
        row.append(text);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.dataset.savedRemove = id;
      remove.setAttribute("aria-label", record ? `Remove ${record.name} from saved services` : "Remove unavailable listing from saved services");
      remove.addEventListener("click", async () => {
        try {
          setResourceSaved(id, false);
          status.textContent = "Listing removed from your saved services.";
          await render();
        } catch { announceFailure(); }
      });
      row.append(remove);
      list.append(row);
    }
    shown = Math.min(entries.length, shown + 60);
    more.hidden = shown >= entries.length;
    more.textContent = `Show ${Math.min(60, entries.length - shown)} more saved services`;
    return list.children[first];
  };

  const render = async () => {
    const current = ++generation;
    if (!active()) return;
    const focused = document.activeElement;
    const focusedRow = focused?.closest?.("[data-saved-id]");
    const focusedIndex = focusedRow ? [...list.children].indexOf(focusedRow) : -1;
    const controlIndex = focusedRow ? [...focusedRow.querySelectorAll("a, button")].indexOf(focused) : -1;
    const previousShown = Math.max(60, shown);
    const restoreFocus = () => {
      if (!active() || (document.activeElement !== focused && ((focused !== retry && focused?.isConnected && focused.getClientRects().length > 0) || document.activeElement !== document.body))) return;
      if (focusedRow) {
        const rows = [...list.children];
        const row = rows.find((candidate) => candidate.dataset.savedId === focusedRow.dataset.savedId);
        const next = rows[Math.min(focusedIndex, rows.length - 1)];
        const target = row?.querySelectorAll("a, button")[controlIndex] || next?.querySelector("[data-saved-remove]") || heading;
        target.focus();
      } else if (focused === retry) (retry.hidden ? heading : retry).focus();
      else if ((focused === clear && clear.hidden) || (focused === more && more.hidden)) heading.focus();
      else if (confirmation.contains(focused) && confirmation.hidden) heading.focus();
    };
    retry.hidden = true;
    let ids;
    try { ids = readSavedResources(); } catch {
      list.replaceChildren();
      more.hidden = true;
      clear.hidden = true;
      summary.textContent = "Saved services are unavailable in this browser. Check your browser’s storage settings.";
      retry.hidden = false;
      cancelClear();
      restoreFocus();
      return;
    }
    clear.hidden = ids.size === 0;
    if (!ids.size) {
      list.replaceChildren();
      more.hidden = true;
      summary.textContent = "No saved services yet. Open a listing and choose Save to keep it here.";
      cancelClear();
      restoreFocus();
      return;
    }
    summary.textContent = "Loading your saved services…";
    try {
      const payload = await loadCatalog();
      if (current !== generation || !active()) return;
      const byId = new Map(payload.records.map((record) => [record.id, record]));
      // Never remove saved IDs merely because a catalog request or release changed.
      entries = [...ids].map((id) => ({ id, record: byId.get(id) }));
      const unavailable = entries.filter((entry) => !entry.record).length;
      summary.textContent = `${ids.size} saved ${ids.size === 1 ? "listing" : "listings"}${unavailable ? ` · ${unavailable} no longer in the directory` : ""}. Confirm current details before you go.`;
      list.replaceChildren();
      shown = 0;
      do { renderMore(); } while (shown < Math.min(previousShown, entries.length));
      restoreFocus();
    } catch {
      if (current !== generation || !active()) return;
      list.replaceChildren();
      more.hidden = true;
      summary.textContent = "Your saved list is still on this device, but listing details could not load. Reconnect and try again.";
      retry.hidden = false;
      restoreFocus();
    }
  };

  more.addEventListener("click", () => renderMore()?.querySelector("a, button")?.focus());
  retry.addEventListener("click", () => render());
  clear.addEventListener("click", () => {
    confirmation.hidden = false;
    clear.setAttribute("aria-expanded", "true");
    panel.querySelector("[data-saved-cancel]").focus();
  });
  panel.querySelector("[data-saved-cancel]").addEventListener("click", () => cancelClear(true));
  confirmation.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); cancelClear(true); }
  });
  panel.querySelector("[data-saved-confirm]").addEventListener("click", async () => {
    try {
      clearSavedResources();
      status.textContent = "All saved services removed from this browser.";
      await render();
      if (active()) heading.focus();
    } catch { cancelClear(true); announceFailure(); }
  });
  const syncView = (focus = false) => {
    if (focus) document.querySelector(".rwn-page-menu")?.removeAttribute("open");
    const visible = active();
    panel.closest(".directory-shell")?.classList.toggle("has-saved-view", visible);
    generation += 1;
    if (!visible || focus) cancelClear();
    if (visible) {
      render();
      if (focus) { heading.focus({ preventScroll: true }); panel.scrollIntoView({ block: "start", behavior: "auto" }); }
    } else if (focus) {
      // History restoration owns the return target after the saved panel hides.
      if (history.state?.rwnDirectory) {
        window.dispatchEvent(new Event("rwn-directory-restore"));
        return;
      }
      const target = document.getElementById(location.hash.slice(1)) || document.querySelector("[data-directory-query]");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  };
  window.addEventListener("hashchange", () => syncView(true));
  window.addEventListener("pageshow", () => syncView());
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_RESOURCES_KEY || event.key === null) render();
  });
  window.addEventListener("online", () => render());
  window.addEventListener("offline", () => render());
  navigator.serviceWorker?.addEventListener("controllerchange", () => { catalogPromise = undefined; freshCatalog = true; render(); });
  syncView(active());
}
