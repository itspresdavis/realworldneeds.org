// CI-only passive evidence. This never activates a link, scrolls, focuses,
// changes CSS, or decides whether a skip-navigation assertion passes.
export function installSkipLinkWitness() {
  const key = '__rwnSkipLinkWitness';
  if (window[key]) throw new Error('Skip-link witness is already installed');
  const events = [], frames = [], listeners = [];
  const installedAt = performance.now();
  let frameRequest = null, disposed = false, activated = false, framesRequested = false;
  const rect = element => {
    const box = element?.getBoundingClientRect();
    return box ? { top: box.top, bottom: box.bottom, height: box.height } : null;
  };
  const state = (geometry = true) => {
    const page = document.documentElement, finder = document.getElementById('finder');
    const header = document.querySelector('.site-header'), active = document.activeElement;
    const basic = {
      at: performance.now(), hash: location.hash, x: scrollX, y: scrollY,
      active: active?.id || '', activeClass: active?.className || '',
      travel: page.classList.contains('rwn-anchor-travel'),
    };
    if (!geometry) return basic;
    const finderBox = rect(finder);
    return {
      ...basic, header: rect(header), finder: finderBox,
      finderDocumentTop: finderBox ? finderBox.top + scrollY : null,
      clearance: getComputedStyle(page).scrollPaddingTop,
      behavior: getComputedStyle(page).scrollBehavior,
      finderMargin: finder ? getComputedStyle(finder).scrollMarginTop : null,
      enhancement: page.dataset.pageInteractions || null,
      readyState: document.readyState, visibility: document.visibilityState,
      width: innerWidth, height: innerHeight,
      clientHeight: page.clientHeight, scrollHeight: page.scrollHeight,
      restoration: history.scrollRestoration,
    };
  };
  const record = (label, event) => {
    if (disposed) return;
    events.push({ label, trusted: event?.isTrusted ?? null,
      defaultPrevented: event?.defaultPrevented ?? null,
      eventPhase: event?.eventPhase ?? null, eventTimeStamp: event?.timeStamp ?? null,
      key: event?.key ?? null, target: event?.target?.id || '',
      targetClass: event?.target?.className || '', ...state(false) });
    if (events.length > 80) events.shift();
  };
  const frame = at => {
    frameRequest = null;
    if (disposed) return;
    frames.push({ frameAt: at, ...state() });
    if (frames.length < 2) frameRequest = requestAnimationFrame(frame);
  };
  const listen = (target, type, capture = false) => {
    const handler = event => {
      record(`${type}:${capture ? 'capture' : 'bubble'}`, event);
      // This observes, rather than supplies, the native click/default action.
      // The microtask is labelled as such, not asserted to be post-default.
      if (type === 'click' && !capture && !activated && event.target.closest?.('.skip-link')) {
        activated = true;
        queueMicrotask(() => record('click:microtask'));
      }
    };
    const options = { capture, passive: true };
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  // Validate the required document state before installing any listeners.
  const initial = state();
  for (const type of ['keydown', 'keyup', 'click']) {
    listen(document, type, true);
    listen(document, type);
  }
  for (const type of ['hashchange', 'popstate', 'scroll', 'scrollend']) listen(window, type);
  window[key] = {
    snapshot: () => ({ installedAt, state: state(), events: [...events], frames: [...frames] }),
    // Request frame observations only after the immediate check has failed.
    // Input listeners do not force geometry reads or schedule rendering work.
    observeFrames() {
      if (disposed || framesRequested) return;
      framesRequested = true;
      frameRequest = requestAnimationFrame(frame);
    },
    dispose() {
      disposed = true;
      for (const remove of listeners) remove();
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      delete window[key];
    },
  };
  return { installedAt, state: initial, events: [], frames: [] };
}

const bounded = async (operation, deadline, now) => {
  const remaining = deadline - now();
  if (remaining <= 0) throw new Error('Skip-link diagnostic deadline exceeded');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Skip-link diagnostic deadline exceeded')), remaining);
      }),
    ]);
  } finally { clearTimeout(timer); }
};

// The original check owns all inputs and assertions. Later pixels/frames are
// failure evidence only: even an eventual successful arrival cannot pass it.
export async function withSkipLinkEvidence({
  record, evidence, install, run, read, capture, dispose, observeFrames,
  failureDeadlineMs = 1200, cleanupDeadlineMs = 500,
  now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  evidence.push(record);
  let originalError, installed = false;
  try {
    record.installed = await install();
    installed = true;
    await run(record);
    record.witness = await bounded(read, now() + cleanupDeadlineMs, now);
  } catch (error) {
    originalError = error;
    record.failed = true;
    record.error = error.message;
    if (!installed) { record.setupFailed = true; throw error; }
    const diagnostic = record.failureEvidence = { snapshots: [], deadlineMs: failureDeadlineMs };
    const deadline = now() + failureDeadlineMs;
    try {
      await bounded(observeFrames, deadline, now);
      diagnostic.snapshots.push(await bounded(read, deadline, now));
      diagnostic.captureStartedAt = now();
      try {
        await bounded(capture, deadline, now);
        diagnostic.screenshot = true;
      } catch (captureError) {
        diagnostic.captureError = captureError.message;
      }
      diagnostic.captureFinishedAt = now();
      let snapshot = await bounded(read, deadline, now);
      diagnostic.snapshots.push(snapshot);
      while (snapshot.frames.length < 2) {
        await bounded(() => wait(25), deadline, now);
        snapshot = await bounded(read, deadline, now);
        diagnostic.snapshots.push(snapshot);
      }
    } catch (diagnosticError) {
      diagnostic.error = diagnosticError.message;
    }
    throw error;
  } finally {
    try { if (installed) await bounded(dispose, now() + cleanupDeadlineMs, now); }
    catch (error) {
      record.cleanupError = error.message;
      if (!originalError) throw error;
    }
  }
}
