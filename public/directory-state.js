// Keep the visitor's place in this history entry, never in a URL or web storage.
export const readDirectoryState = (state, path) => {
  const value = state?.rwnDirectory;
  if (!value || value.path !== path) return null;
  const text = (key) => typeof value[key] === "string" ? value[key].slice(0, 1024) : "";
  return { query: text("query"), category: text("category"), country: text("country"),
    shown: Number.isInteger(value.shown) ? Math.max(60, Math.min(value.shown, 6000)) : 60,
    scroll: Number.isFinite(value.scroll) ? Math.max(0, value.scroll) : 0,
    focus: /^\/service\/[^/?#]+$/.test(text("focus")) ? text("focus") : "" };
};

export const writeDirectoryState = (history, path, value) => {
  try { history.replaceState({ ...history.state, rwnDirectory: { ...value, path } }, ""); }
  catch { /* Restricted history must not prevent browsing or navigation. */ }
};

export const restoreDirectoryView = (list, state) => {
  window.scrollTo({ top: state.scroll, behavior: "instant" });
  const header = document.querySelector(".legal-header");
  const edge = header?.getBoundingClientRect().bottom || 0;
  const visible = node => {
    const rect = node.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > edge && rect.top < window.innerHeight;
  };
  const links = [...list.querySelectorAll("a")];
  const target = links.find(link => link.getAttribute("href") === state.focus && visible(link))
    || links.find(visible)
    || [...(header?.querySelectorAll("a, summary") || [])].find(node => node.getBoundingClientRect().height > 0);
  target?.focus({ preventScroll: true });
};
