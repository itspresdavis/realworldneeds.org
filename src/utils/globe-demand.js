// A visible map or deliberate map interaction warrants the optional engine.
// Probe the real canvas first so unsupported devices keep their immediate text
// fallback. This reuses the same WebGL context that loadGlobeEngine will use.
export function startGlobeWhenNeeded(start, { document: doc = document, window: win = window } = {}) {
  const canvas = doc.getElementById('globeCanvas');
  const stage = canvas?.closest('.globe-stage');
  let context;
  try { context = canvas?.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch { /* startGlobe owns the useful unavailable-map presentation. */ }
  if (!context || !stage) return start();

  let started = false, stopped = false, observer = null, frame = null;
  const cleanup = () => {
    stopped = true;
    observer?.disconnect();
    if (frame !== null) win.cancelAnimationFrame(frame);
    stage.removeEventListener('pointerdown', begin);
    stage.removeEventListener('focusin', begin);
    win.removeEventListener('scroll', scheduleCheck);
    win.removeEventListener('resize', scheduleCheck);
    doc.removeEventListener('visibilitychange', check);
  };
  function begin() {
    if (started || stopped || doc.visibilityState === 'hidden') return;
    started = true;
    cleanup();
    return start();
  }
  function check() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    if (started || stopped || doc.visibilityState === 'hidden') return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, win.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0));
    // A sliver below the finder should not begin megabytes of map work. On a
    // short viewport, half the available height still expresses exploration.
    const visibleHeight = Math.min(rect.height / 4, win.innerHeight / 2);
    if (rect.width > 0 && rect.height > 0 && width >= rect.width / 4 && height >= visibleHeight) begin();
  }
  function scheduleCheck() {
    if (!started && !stopped && frame === null) frame = win.requestAnimationFrame(check);
  }

  doc.documentElement.dataset.globeStartup = 'deferred';
  stage.addEventListener('pointerdown', begin, { passive: true });
  stage.addEventListener('focusin', begin);
  win.addEventListener('scroll', scheduleCheck, { passive: true });
  win.addEventListener('resize', scheduleCheck, { passive: true });
  doc.addEventListener('visibilitychange', check);
  if (win.IntersectionObserver) {
    observer = new win.IntersectionObserver(check, { threshold: [0, .25, .5, 1] });
    observer.observe(canvas);
  }
  check();
  return cleanup;
}
