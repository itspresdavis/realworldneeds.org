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
  const state = { ...history.state, rwnDirectory: { ...value, path } };
  try { history.replaceState(state, ""); }
  catch { /* Restricted history must not prevent browsing or navigation. */ }
  return readDirectoryState(state, path);
};

export const restoreDirectoryView = (list, state, browseInput) => {
  window.scrollTo({ top: state.scroll, behavior: "instant" });
  const header = document.querySelector(".rwn-site-header");
  const edge = header?.getBoundingClientRect().bottom || 0;
  const visible = node => {
    const rect = node.getBoundingClientRect();
    return rect.height > 0 && rect.top >= edge + 6 && rect.bottom <= window.innerHeight - 6;
  };
  const links = [...list.querySelectorAll("h2 a,.directory-global-result")];
  let target = links.find(link => link.getAttribute("href") === state.focus && visible(link))
    || links.find(visible);
  if (!target && browseInput) {
    target = [browseInput, ...document.querySelectorAll("[data-directory-clear],.directory-global-empty button")].find(visible) || browseInput;
    if (!visible(target)) target.scrollIntoView({ block: "center", behavior: "instant" });
  }
  target ||= [...(header?.querySelectorAll("a, summary") || [])].find(node => node.getBoundingClientRect().height > 0);
  target?.focus({ preventScroll: true });
};
