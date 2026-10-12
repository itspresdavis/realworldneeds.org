const PROBE_URL = "/data/release.json";
const notice = document.getElementById("offlineDirectoryNotice");

if (notice) {
  let offline = false;
  let probeGeneration = 0;
  let pendingProbe;
  let catalogPromise;
  const explanation = notice.querySelector("p");
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

  const catalog = () => {
    catalogPromise ||= fetch("/data/search-index.json", { credentials: "same-origin", cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Search index unavailable (${response.status})`);
        return response.json();
      });
    return catalogPromise;
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

  const enhanceSearchActions = async () => {
    const links = [...document.querySelectorAll(".directory-global-result")].filter((link) => !link.closest(".directory-global-result-wrap"));
    if (!links.length) return;
    let payload;
    try {
      payload = await catalog();
    } catch {
      return;
    }
    const byId = new Map((payload.records || []).map((record) => [record.id, record]));

    for (const link of links) {
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
      if (record.locationPrecision !== "contact-only" && record.kind === "direct" && Number.isFinite(record.lat) && Number.isFinite(record.lng)) {
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
      if (record.phone && (record.phoneLinks?.length !== 1 || record.phoneLinks[0].label !== record.phone)) {
        const phone = document.createElement("small");
        phone.textContent = `Phone: ${record.phone}`;
        link.append(phone);
      }
      if (record.locationPrecision === "contact-only") {
        const scope = document.createElement("small");
        scope.textContent = ["Phone or online help; check coverage.", record.coverageNote, record.eligibility ? `Eligibility: ${record.eligibility}` : "", record.phoneAccess ? `Dialing scope: ${record.phoneAccess}` : "", record.accessUrl ? `Website (connection required): ${record.accessUrl}` : ""].filter(Boolean).join(" ");
        link.append(scope);
      }
      wrapper.append(actions);
    }
    setOffline(offline);
  };

  const setOffline = (value) => {
    offline = Boolean(value);
    document.documentElement.classList.toggle("rwn-directory-offline", offline);
    // Let someone using Retry keep their focus and read the recovery message.
    notice.hidden = !offline && !notice.contains(document.activeElement);
    if (explanation) explanation.hidden = !offline;
    notice.dataset.networkState = offline ? "offline" : "online";

    for (const link of document.querySelectorAll(".directory-global-result")) {
      const meta = link.querySelector("small");
      link.toggleAttribute("aria-describedby", offline);
      if (offline) link.setAttribute("aria-describedby", notice.id);
      if (!meta) continue;
      const base = meta.textContent.replace(/\s*·\s*reconnect for full details\s*$/i, "");
      const desired = offline ? `${base} · reconnect for full details` : base;
      setText(meta, desired);
    }

    for (const link of document.querySelectorAll(".directory-global-result-actions a")) {
      if (link.getAttribute("href")?.startsWith("tel:")) continue;
      link.hidden = offline;
    }

    const count = document.querySelector("[data-directory-count]");
    if (count) {
      const base = count.textContent.replace(/\s*·\s*offline copy\s*$/i, "");
      const desired = offline && /matching listings/i.test(base) ? `${base} · offline copy` : base;
      setText(count, desired);
    }
  };

  const probe = () => {
    if (pendingProbe) return pendingProbe.promise;
    const generation = ++probeGeneration;
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
      fetch(PROBE_URL, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-RWN-Connectivity-Probe": "1" },
        signal: controller.signal
      }),
      interrupted
    ]).then((response) => {
      if (generation !== probeGeneration) return;
      setOffline(!response.ok);
      setText(status, response.ok ? "Connection restored. Listing details and online links are available." : "Could not reach RWN. Check your connection and try again.");
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
    setOffline(offline);
    enhanceSearchActions();
  });
  const results = document.querySelector(".directory-global-results");
  if (results) observer.observe(results, { childList: true, subtree: true });
  const savedList = document.querySelector("[data-saved-list]");
  if (savedList) observer.observe(savedList, { childList: true, subtree: true });

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
  // Own visibility immediately, including while an initially offline probe hangs.
  setOffline(!navigator.onLine);
  probe();
  enhanceSearchActions();
}
