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
  scheduleActive = null,
) {
  let offset = 0,
    generation = 0,
    active = false,
    channel = null,
    resolve;
  // Posted tasks yield to browser input/rendering without the nested-timer
  // clamp. Create the channel only when someone types, and close it at finish.
  const enqueueActive = scheduleActive || ((callback) => {
    if (typeof MessageChannel !== "function") return setTimeout(callback, 0);
    channel ||= new MessageChannel();
    channel.port1.onmessage = callback;
    channel.port2.postMessage(null);
  });
  const finish = () => {
    channel?.port1.close();
    channel?.port2.close();
    channel = null;
    resolve();
  };
  const ready = new Promise((done) => {
    resolve = done;
  });
  const enqueue = () => {
    const ticket = ++generation;
    (active ? enqueueActive : schedule)(() => {
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
      else finish();
    });
  };
  if (resources.length) enqueue();
  else finish();
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
