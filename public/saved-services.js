import { createCatalogLoader } from "./catalog-request.js";
import { SAVED_RESOURCES_KEY, readSavedResources, setResourceSaved, clearSavedResources } from "../src/utils/privacy.js";

import { createResultRow } from "./directory-results.js";

export function initSavedServices() {
  const connectivityNotice = document.getElementById("offlineDirectoryNotice");
  const release = new URL(import.meta.url).searchParams.get("v") || "";
  const loadCatalog = createCatalogLoader(`/data/search-index.json${release ? `?v=${encodeURIComponent(release)}` : ""}`);
  const panel = document.querySelector("[data-saved-services]");
  if (!panel) return;
  const directoryTitle = window.RWNLanguage?.originalTitle?.() ?? document.title;
  const navigation = [...(document.querySelectorAll?.(".rwn-site-header nav a, .rwn-site-footer nav a") || [])]
    .map(link => ({ link, current: link.getAttribute("aria-current") }));
  const heading = panel.querySelector("h2");
  const summary = panel.querySelector("[data-saved-summary]");
  const empty = panel.querySelector("[data-saved-empty]");
  const status = panel.querySelector("[data-saved-status]");
  const list = panel.querySelector("[data-saved-list]");
  const retry = panel.querySelector("[data-saved-retry]");
  const clear = panel.querySelector("[data-saved-clear]");
  const confirmation = panel.querySelector("[data-saved-confirmation]");
  const more = panel.querySelector("[data-saved-more]");
  let generation = 0, activePage = true;
  let entries = [];
  let shown = 0;
  let renderedEntries = "", renderedOnline;
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
    if (!activePage || !active()) return;
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
    retry.hidden = focused !== retry;
    retry.setAttribute("aria-disabled", "true");
    if (empty) empty.hidden = true;
    let ids;
    try { ids = readSavedResources(); } catch {
      list.replaceChildren();
      more.hidden = true;
      clear.hidden = true;
      summary.textContent = "Saved services are unavailable in this browser. Check your browser’s storage settings.";
      retry.hidden = false;
      retry.setAttribute("aria-disabled", "false");
      cancelClear();
      restoreFocus();
      return;
    }
    clear.hidden = ids.size === 0;
    if (!ids.size) {
      retry.hidden = true;
      list.replaceChildren();
      more.hidden = true;
      summary.textContent = "No saved services yet. Open a listing and choose Save to keep it here.";
      if (empty) empty.hidden = false;
      cancelClear();
      restoreFocus();
      return;
    }
    // A background refresh must not move an existing pointer/focus target.
    if (!shown || list.children.length !== shown) summary.textContent = "Loading your saved services…";
    try {
      const payload = await loadCatalog();
      if (current !== generation || !active()) return;
      retry.hidden = true;
      const byId = new Map(payload.records.map((record) => [record.id, record]));
      // Never remove saved IDs merely because a catalog request or release changed.
      const nextEntries = [...ids].map((id) => ({ id, record: byId.get(id) }));
      const signature = JSON.stringify(nextEntries);
      const unchanged = shown > 0 && list.children.length === shown
        && signature === renderedEntries && renderedOnline === navigator.onLine;
      entries = nextEntries;
      const unavailable = entries.filter((entry) => !entry.record).length;
      summary.textContent = `${ids.size} saved ${ids.size === 1 ? "listing" : "listings"}${unavailable ? ` · ${unavailable} no longer in the directory` : ""}. Confirm current details before you go.`;
      // Compare all record content, not only IDs: changed contacts, availability
      // and withdrawn records must refresh. Offline-created rows also own a
      // different click guard, so a navigator connection change must rebuild.
      if (!unchanged) {
        list.replaceChildren();
        shown = 0;
        do { renderMore(); } while (shown < Math.min(previousShown, entries.length));
        renderedEntries = signature;
        renderedOnline = navigator.onLine;
      }
      restoreFocus();
    } catch {
      if (current !== generation || !active()) return;
      list.replaceChildren();
      more.hidden = true;
      summary.textContent = "Your saved list is still on this device, but listing details could not load. Reconnect and try again.";
      retry.hidden = false;
      retry.setAttribute("aria-disabled", "false");
      restoreFocus();
    }
  };

  more.addEventListener("click", () => renderMore()?.querySelector("a, button")?.focus());
  retry.addEventListener("click", () => { if (retry.getAttribute("aria-disabled") !== "true") render(); });
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
    const title = visible ? "Saved services | Real World Needs" : directoryTitle;
    if (window.RWNLanguage?.setTitle) window.RWNLanguage.setTitle(title);
    else document.title = title;
    for (const { link, current } of navigation) {
      const value = visible ? (link.getAttribute("href") === "/directory#saved" ? "page" : null) : current;
      if (value) link.setAttribute("aria-current", value);
      else link.removeAttribute("aria-current");
    }
    const shell = panel.closest(".directory-shell");
    const wasSaved = shell?.classList.contains("has-saved-view");
    shell?.classList.toggle("has-saved-view", visible);
    generation += 1;
    if (!visible || focus) cancelClear();
    if (visible) {
      render();
      // Focus-owned navigation must not inherit the page’s smooth-scroll animation.
      if (focus) { heading.focus({ preventScroll: true }); panel.scrollIntoView({ block: "start", behavior: "instant" }); }
    } else if (focus) {
      // History restoration owns the return target after the saved panel hides.
      if ((wasSaved || history.state?.rwnDirectory) && !window.dispatchEvent(new CustomEvent("rwn-directory-restore", {
        cancelable: true, detail: wasSaved && location.hash === "#directory-results" ? "browse" : "history"
      }))) return;
      const target = document.getElementById(location.hash.slice(1)) || document.querySelector("[data-directory-query]");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  };
  window.addEventListener("hashchange", () => syncView(true));
  // A controller may change while this document is leaving. Cancel its work
  // before it loses fetch access; a cached return starts from current state.
  window.addEventListener("pagehide", () => {
    activePage = false;
    generation += 1;
    loadCatalog.retry();
  });
  window.addEventListener("pageshow", () => { activePage = true; syncView(); });
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_RESOURCES_KEY || event.key === null) render();
  });
  const reconnect = () => { loadCatalog.retry(); render(); };
  for (const type of ["online", "offline", "rwn-connection-restored"]) window.addEventListener(type, reconnect);
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    loadCatalog.reset();
    // WebKit may revoke fetch access before pagehide during navigation.
    // A live page refreshes on its next frame; a departing page does not.
    window.requestAnimationFrame(() => { if (activePage) render(); });
  });
  syncView(active());
}
