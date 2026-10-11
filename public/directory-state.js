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
