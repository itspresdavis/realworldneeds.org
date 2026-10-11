// The normal directory does not load or read saved services until requested.
let pending;
let attempt = 0;
const loadSaved = () => {
  if (location.hash !== "#saved" || pending) return;
  const release = new URL(import.meta.url).searchParams.get("v") || "";
  pending = import(`./saved-services.js?v=${encodeURIComponent(release)}&attempt=${attempt++}`)
    .then(({ initSavedServices }) => initSavedServices())
    .catch(() => {
      pending = undefined;
      const summary = document.querySelector("[data-saved-summary]");
      if (summary) summary.textContent = "Saved services could not open. Reconnect and try again. Your saved list has not changed.";
      const retry = document.querySelector("[data-saved-retry]");
      if (retry) { retry.hidden = false; retry.onclick = loadSaved; }
    });
};
window.addEventListener("hashchange", loadSaved);
loadSaved();
