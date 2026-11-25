import { createCatalogLoader } from "./catalog-request.js";

const PROBE_URL = "/data/release.json";
const notice = document.getElementById("offlineDirectoryNotice");

if (notice) {
  // A saved navigation is not proof that this directory endpoint is reachable.
  // The worker adds only this fixed marker to the response, never the cache.
  const cachedNavigation = document.querySelector('meta[name="rwn-offline-navigation"]');
  let navigationRecovery = Boolean(cachedNavigation);
  let offline = false, activePage = true;
  let networkOffline = false;
  let catalogCached = document.documentElement.dataset?.rwnCatalogCached === "true";
  let probeGeneration = 0;
  let pendingProbe;
  const catalog = createCatalogLoader("/data/search-index.json");
  let catalogUnavailable = false;
  const unavailableMessage = "Listing actions are unavailable. Reconnect and retry.";
  const explanation = notice.querySelector("p");
  const initialExplanation = explanation?.textContent;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "directory-search-tools__clear directory-connection-retry";
  retry.setAttribute("data-directory-reconnect", "");
  retry.setAttribute("aria-disabled", "false");
  retry.textContent = "Retry connection";
  const status = document.createElement("p");
  status.setAttribute("data-directory-connection-status", "");
  notice.append(retry, status);

  const checking = (value) => {
    // Native disabled can drop keyboard focus while the request is pending.
    retry.setAttribute("aria-disabled", String(value));
    retry.textContent = value ? "Checking connection…" : "Retry connection";
  };

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  const resultId = (link) => {
    try {
      return decodeURIComponent(new URL(link.href).pathname.match(/^\/service\/([^/]+)\/?$/)?.[1] || "");
    } catch {
      return "";
    }
  };

  const mapUrls = (record) => {
    const coordinate = `${record.lat},${record.lng}`;
    return {
      apple: `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(record.name)}`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`
    };
  };

  const actionLink = (label, href, className = "") => {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = href;
    if (className) link.className = className;
    return link;
  };

  // Only invalidate rows this fallback owns; the regular renderer manages its own.
  let enhancementGeneration = 0;
  const fallbackRows = new Map();
  const invalidateFallback = () => {
    enhancementGeneration += 1;
    if (fallbackRows.size) catalogUnavailable = true;
    for (const [link, { wrapper, extras }] of fallbackRows) {
      extras.forEach(node => node.remove());
      wrapper.replaceWith(link);
    }
    fallbackRows.clear();
    setOffline(networkOffline);
  };

  const enhanceSearchActions = async () => {
    if (!activePage) return;
    for (const [link, { wrapper }] of fallbackRows) {
      if (wrapper.isConnected === false) fallbackRows.delete(link);
    }
    const links = [...document.querySelectorAll(".directory-global-result")].filter((link) => !link.closest(".directory-global-result-wrap"));
    if (!links.length) return;
    const generation = enhancementGeneration;
    let payload;
    try {
      payload = await catalog();
      if (generation !== enhancementGeneration) return;
      catalogUnavailable = false;
    } catch {
      if (generation !== enhancementGeneration) return;
      catalogUnavailable = true;
      setText(status, unavailableMessage);
      setOffline(networkOffline);
      return;
    }
    const byId = new Map((payload.records || []).map((record) => [record.id, record]));

    for (const link of links) {
      if (link.isConnected === false || link.closest(".directory-global-result-wrap")) continue;
      const record = byId.get(resultId(link));
      if (!record) continue;
      const wrapper = document.createElement("article");
      wrapper.className = "directory-global-result-wrap";
      const actions = document.createElement("nav");
      actions.className = "directory-global-result-actions";
      actions.setAttribute("aria-label", `Quick actions for ${record.name}`);

      for (const { label, href } of record.phoneLinks || []) {
        actions.append(actionLink(`Call ${label}`, href, "is-call"));
      }
      if (Object.hasOwn(record, "serviceActions") || Object.hasOwn(record, "serviceAccess")) {
        for (const action of Array.isArray(record.serviceActions) ? record.serviceActions : []) {
          try {
            const url = new URL(action.href);
            if (!/^https:\/\//.test(action.href) || /[\s\u0000-\u001f]/.test(action.href) || url.username || url.password) continue;
            actions.append(actionLink(action.label, url.href, action.kind === "directions" ? "is-map" : "is-access"));
          } catch { /* Invalid actions must never revive generic map directions. */ }
        }
      } else if (record.locationPrecision !== "contact-only" && record.kind === "direct" && Number.isFinite(record.lat) && Number.isFinite(record.lng)) {
        const maps = mapUrls(record);
        actions.append(actionLink("Apple Maps", maps.apple));
        actions.append(actionLink("Google Maps", maps.google));
      }
      if (record.locationPrecision === "contact-only" && record.accessUrl?.startsWith("https://")) {
        actions.append(actionLink("Contact website", record.accessUrl, "is-contact"));
      }
      actions.append(actionLink("View details", link.href, "is-details"));

      link.before(wrapper);
      wrapper.append(link);
      const extras = [];
      fallbackRows.set(link, { wrapper, extras });
      if (record.phone && (record.phoneLinks?.length !== 1 || record.phoneLinks[0].label !== record.phone)) {
        const phone = document.createElement("small");
        phone.textContent = `Phone: ${record.phone}`;
        link.append(phone);
        extras.push(phone);
      }
      if (record.locationPrecision === "contact-only") {
        const scope = document.createElement("small");
        scope.textContent = ["Phone or online help; check coverage.", record.coverageNote, record.eligibility ? `Eligibility: ${record.eligibility}` : "", record.phoneAccess ? `Dialing scope: ${record.phoneAccess}` : "", record.accessUrl ? `Website (connection required): ${record.accessUrl}` : ""].filter(Boolean).join(" ");
        link.append(scope);
        extras.push(scope);
      }
      if (record.serviceAccessSummary) {
        const access = document.createElement("small");
        access.textContent = record.serviceAccessSummary;
        link.append(access);
        extras.push(access);
      }
      wrapper.append(actions);
    }
    setOffline(networkOffline);
  };

  const setOffline = (value) => {
    networkOffline = Boolean(value);
    offline = networkOffline || catalogCached || catalogUnavailable;
    document.documentElement.classList.toggle("rwn-directory-offline", offline);
    // Let someone using Retry keep their focus and read the recovery message.
    notice.hidden = !offline && !notice.contains(document.activeElement);
    if (explanation) {
      explanation.hidden = !offline;
      setText(explanation, catalogUnavailable ? unavailableMessage : catalogCached && !networkOffline
        ? "Saved directory copy. RWN is reachable, but current listing details could not be refreshed. Retry before traveling or relying on a listing."
        : initialExplanation);
    }
    notice.dataset.networkState = offline ? "offline" : "online";

    for (const link of document.querySelectorAll(".directory-global-result")) {
      const meta = link.querySelector("small");
      link.toggleAttribute("aria-describedby", offline);
      if (offline) link.setAttribute("aria-describedby", notice.id);
      if (!meta) continue;
      const base = (window.RWNLanguage?.originalText(meta) ?? meta.textContent).replace(/\s*·\s*reconnect for full details\s*$/i, "");
      const desired = offline ? `${base} · reconnect for full details` : base;
      setText(meta, desired);
    }

    for (const link of document.querySelectorAll(".directory-global-result-actions a")) {
      if (link.getAttribute("href")?.startsWith("tel:")) continue;
      link.hidden = offline;
    }

    const count = document.querySelector("[data-directory-count]");
    if (count) {
      const base = (window.RWNLanguage?.originalText(count) ?? count.textContent).replace(/\s*·\s*offline copy\s*$/i, "");
      const desired = offline && /matching listings/i.test(base) ? `${base} · offline copy` : base;
      setText(count, desired);
    }
  };

  const probe = (event) => {
    if (!activePage) return;
    if (pendingProbe) return pendingProbe.promise;
    const generation = ++probeGeneration;
    // The first online retry can race actual network recovery. A healthy probe
    // retries a still-cached catalog, but never restarts an already-fresh one.
    const recoverCatalog = offline;
    const controller = new AbortController();
    let timer;
    const request = {};
    const interrupted = new Promise((_, reject) => {
      request.cancel = () => { controller.abort(); reject(new Error("Connection check interrupted")); };
      timer = setTimeout(request.cancel, 8000);
    });
    pendingProbe = request;
    checking(true);
    setText(status, "Checking connection…");
    request.promise = Promise.race([
      fetch(navigationRecovery ? window.location.pathname : PROBE_URL, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-RWN-Connectivity-Probe": "1" },
        signal: controller.signal
      }).then(async (response) => {
        if (!response.ok) {
          await response.body?.cancel();
          return response;
        }
        // Keep the deadline through the complete body, not just HTTP headers.
        // A stalled or redirected response is not proof of restored service.
        const body = await response.text();
        if (response.redirected) throw new Error("Connection check redirected");
        if (navigationRecovery) {
          // This fetch is not a navigation and cannot use the worker's shell.
          if (!/<meta name="rwn-offline-assets" content="[a-f0-9]{12}"/.test(body)
            || !/<section\b[^>]*\bdata-directory-search(?:[\s=>])/.test(body)) throw new Error("Directory is unavailable");
        } else if (!/^[a-f0-9]{12}$/.test(JSON.parse(body)?.release)) {
          throw new Error("Release metadata is unavailable");
        }
        return response;
      }),
      interrupted
    ]).then(async (response) => {
      if (generation !== probeGeneration) return;
      setOffline(!response.ok);
      if (response.ok) { navigationRecovery = false; cachedNavigation?.remove(); }
      if (response.ok && recoverCatalog && (event?.type !== "online" || catalogCached || catalogUnavailable)) {
        window.dispatchEvent(new Event("rwn-connection-restored"));
        invalidateFallback();
        catalog.retry();
        await enhanceSearchActions();
        if (generation !== probeGeneration) return;
      }
      setText(status, response.ok
        ? catalogUnavailable ? unavailableMessage : catalogCached ? "RWN is reachable, but search is using a saved catalog. Retry to refresh listings before relying on them."
          : "Connection restored. Listing details and online links are available."
        : "Could not reach RWN. Check your connection and try again.");
    }).catch(() => {
      if (generation !== probeGeneration) return;
      setOffline(true);
      setText(status, "Could not reach RWN. Check your connection and try again.");
    }).finally(() => {
      clearTimeout(timer);
      if (pendingProbe !== request) return;
      pendingProbe = undefined;
      checking(false);
    });
    return request.promise;
  };

  window.addEventListener("rwn-catalog-status", event => {
    catalogCached = event.detail?.cached === true;
    setOffline(networkOffline);
    if (catalogCached) setText(status, "Search is using a saved catalog. Current listing details are unverified; retry to refresh.");
    else if (!networkOffline && !catalogUnavailable) setText(status, "The directory has refreshed. Listing details and online links are available.");
  });

  retry.addEventListener("click", probe);
  const hideRecoveredNotice = () => {
    if (!offline && !notice.contains(document.activeElement)) notice.hidden = true;
  };
  document.addEventListener("focusin", hideRecoveredNotice);
  notice.addEventListener("focusout", (event) => {
    if (!notice.contains(event.relatedTarget)) queueMicrotask(hideRecoveredNotice);
  });

  document.addEventListener("click", (event) => {
    if (!offline) return;
    const link = event.target.closest?.(".directory-global-result, .directory-global-result-actions .is-details");
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    notice.hidden = false;
    notice.focus({ preventScroll: true });
    notice.scrollIntoView({ block: "center", behavior: "auto" });
  }, true);

  const observer = new MutationObserver(() => {
    setOffline(networkOffline);
    enhanceSearchActions();
  });
  const results = document.querySelector(".directory-global-results");
  if (results) observer.observe(results, { childList: true, subtree: true });
  const savedList = document.querySelector("[data-saved-list]");
  if (savedList) observer.observe(savedList, { childList: true, subtree: true });

  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    invalidateFallback();
    catalog.reset();
    enhanceSearchActions();
  });
  window.addEventListener("online", probe);
  window.addEventListener("offline", () => {
    // A late success from the old connection must not override this event.
    probeGeneration += 1;
    pendingProbe?.cancel();
    pendingProbe = undefined;
    checking(false);
    setText(status, "Check your connection, then try again.");
    setOffline(true);
  });
  window.addEventListener("pagehide", () => {
    activePage = false;
    enhancementGeneration += 1;
    probeGeneration += 1;
    catalog.retry();
    pendingProbe?.cancel();
    pendingProbe = undefined;
    checking(false);
  });
  // Recheck a restored cached document; another tab must not clear its warning.
  window.addEventListener("pageshow", (event) => {
    activePage = true;
    if (event.persisted) {
      if (navigationRecovery) probe(event);
      enhanceSearchActions();
    }
  });
  // Own visibility immediately, including while an initially offline probe hangs.
  setOffline(navigationRecovery || !navigator.onLine);
  probe();
  enhanceSearchActions();
}
