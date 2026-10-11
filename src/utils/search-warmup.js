import { prepareResourceSearch } from "./search.js";

// Normalize in short idle slices, rather than making the first typed letter
// pay the whole catalog's setup cost. No requests or visitor data are stored.
export function warmSearchIndex(
  resources,
  schedule = (callback) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(callback, { timeout: 200 });
    else setTimeout(callback, 16);
  },
  now = () => performance.now(),
  prepare = prepareResourceSearch,
) {
  return new Promise((resolve) => {
    let offset = 0;
    const step = () => {
      const started = now();
      let count = 0;
      while (offset < resources.length && count < 24) {
        prepare(resources[offset++]);
        count += 1;
        if (now() - started >= 4) break;
      }
      if (offset < resources.length) schedule(step);
      else resolve();
    };
    if (resources.length) schedule(step);
    else resolve();
  });
}
