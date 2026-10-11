// Run before the editable markup is parsed. Keep only transient interaction
// flags; search words remain in the input and the current history entry.
(() => {
  const types = ["input", "change", "compositionstart", "compositionend"];
  const capture = event => {
    const control = event.target;
    if (!control.matches?.("[data-directory-query],[data-directory-country]")) return;
    const root = control.closest("[data-directory-search]");
    if (!root) return;
    const state = root.rwnDirectoryStartup ||= {};
    state.edited = true;
    if (event.type === "compositionstart") state.composing = true;
    if (event.type === "compositionend") state.composing = false;
  };
  for (const type of types) document.addEventListener(type, capture, true);
  document.addEventListener("rwn-directory-ready", () => {
    for (const type of types) document.removeEventListener(type, capture, true);
  }, { once: true });
})();
