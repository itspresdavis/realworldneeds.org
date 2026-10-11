import { prepareResourceSearch } from "./search.js";

// Normalize in short idle slices, rather than making the first typed letter
// pay the whole catalog's setup cost. Typing prioritizes the remaining slices,
// still yielding between them. No requests or visitor data are stored.
export function warmSearchIndex(
  resources,
  schedule = (callback) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(callback, { timeout: 200 });
    else setTimeout(callback, 16);
  },
  now = () => performance.now(),
  prepare = prepareResourceSearch,
  scheduleActive = (callback) => setTimeout(callback, 0),
) {
  let offset = 0,
    generation = 0,
    active = false,
    resolve;
  const ready = new Promise((done) => {
    resolve = done;
  });
  const enqueue = () => {
    const ticket = ++generation;
    (active ? scheduleActive : schedule)(() => {
      // A queued idle callback becomes harmless when typing takes priority.
      if (ticket !== generation) return;
      const started = now();
      let count = 0;
      while (offset < resources.length && count < 24) {
        prepare(resources[offset++]);
        count += 1;
        if (now() - started >= 4) break;
      }
      if (offset < resources.length) enqueue();
      else resolve();
    });
  };
  if (resources.length) enqueue();
  else resolve();
  return {
    ready,
    get prepared() {
      return offset >= resources.length;
    },
    prioritize() {
      if (active || offset >= resources.length) return;
      active = true;
      enqueue();
    },
  };
}
