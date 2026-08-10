const PROBE_URL = "/data/release.json";
const notice = document.getElementById("offlineDirectoryNotice");

if (notice) {
  let offline = false;
  let probeGeneration = 0;

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
      meta.textContent = offline ? `${base} · reconnect for full details` : base;
    }

    const count = document.querySelector("[data-directory-count]");
    if (count) {
      const base = count.textContent.replace(/\s*·\s*offline copy\s*$/i, "");
      if (offline && /matching listings/i.test(base)) count.textContent = `${base} · offline copy`;
      else if (!offline) count.textContent = base;
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

  const observer = new MutationObserver(() => setOffline(offline));
  const results = document.querySelector(".directory-global-results");
  if (results) observer.observe(results, { childList: true, subtree: true });

  window.addEventListener("online", probe);
  window.addEventListener("offline", () => setOffline(true));
  probe();
}
