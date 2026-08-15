const PROBE_URL = "/data/release.json";
const notice = document.getElementById("offlineDirectoryNotice");

if (notice) {
  let offline = false;
  let probeGeneration = 0;
  let catalogPromise;

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

      if (record.phone) {
        actions.append(actionLink(`Call ${record.phone}`, `tel:${record.phone.replace(/[^+\d]/g, "")}`, "is-call"));
      }
      if (record.kind === "direct" && Number.isFinite(record.lat) && Number.isFinite(record.lng)) {
        const maps = mapUrls(record);
        actions.append(actionLink("Apple Maps", maps.apple));
        actions.append(actionLink("Google Maps", maps.google));
      }
      actions.append(actionLink("View details", link.href, "is-details"));

      link.before(wrapper);
      wrapper.append(link, actions);
    }
    setOffline(offline);
  };

  const setOffline = (value) => {
    offline = Boolean(value);
    document.documentElement.classList.toggle("rwn-directory-offline", offline);
    notice.hidden = !offline;
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

  const probe = async () => {
    const generation = ++probeGeneration;
    try {
      const response = await fetch(PROBE_URL, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-RWN-Connectivity-Probe": "1" }
      });
      if (generation !== probeGeneration) return;
      setOffline(!response.ok);
    } catch {
      if (generation !== probeGeneration) return;
      setOffline(true);
    }
  };

  document.addEventListener("click", (event) => {
    if (!offline) return;
    const link = event.target.closest?.(".directory-global-result");
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

  window.addEventListener("online", probe);
  window.addEventListener("offline", () => setOffline(true));
  probe();
  enhanceSearchActions();
}
