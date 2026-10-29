// Optional presentation only: native anchors own history and scroll, and every
// section is visible before this module runs (or if any enhancement is absent).
const SECTION_IDS = ["finder", "results", "about", "standards"];
const EDITORIAL_ITEMS = ".about-rwn__heading h2, .source-band__heading h2, .mission-steps article, .principle-grid article";

export function installPageInteractions() {
  const page = document.documentElement;
  const header = document.querySelector(".site-header");
  if (!header || page.dataset.pageInteractions === "ready") return;
  page.dataset.pageInteractions = "ready";

  // One clearance, measured after layout. Zoom and wrapped header text can
  // change its height without a window resize.
  const measureHeader = () => {
    page.style.setProperty("--rwn-header-clearance", `${Math.ceil(header.getBoundingClientRect().height) + 12}px`);
  };
  measureHeader();
  if ("ResizeObserver" in window) new ResizeObserver(measureHeader).observe(header);
  else window.addEventListener("resize", measureHeader, { passive: true });

  // The old #top target was the sticky header, which remains at the viewport
  // top even when the document is far down the page. Anchor a real start point.
  if (header.id === "top") {
    const start = document.createElement("span");
    start.id = "top";
    start.className = "page-start";
    start.tabIndex = -1;
    // This empty scroll sentinel has no naming role; the visible brand follows it.
    header.removeAttribute("id");
    header.before(start);
  }
  for (const id of SECTION_IDS) {
    const section = document.getElementById(id);
    if (section && !section.hasAttribute("tabindex")) section.tabIndex = -1;
  }

  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let resetTravel;
  const clearTravel = () => {
    window.clearTimeout(resetTravel);
    page.classList.remove("rwn-anchor-travel");
  };
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[href]");
    const fragment = link?.getAttribute("href");
    if (!/^#(?:top|finder|results|about|standards)$/.test(fragment || "") || link.hasAttribute("download") || link.target) return;
    clearTravel();
    // The default anchor action handles the hash, focus and Back/Forward.
    // Apply smooth behavior only for this activation, never browser find,
    // restored positions, initial hashes, or the keyboard skip link.
    if (preference.matches || link.classList.contains("skip-link")) return;
    page.classList.add("rwn-anchor-travel");
    resetTravel = window.setTimeout(clearTravel, 0);
  });
  window.addEventListener("pagehide", clearTravel);

  const animations = new Set();
  let observer;
  const stopMotion = () => {
    clearTravel();
    observer?.disconnect();
    for (const animation of animations) animation.cancel();
    animations.clear();
  };
  preference.addEventListener?.("change", () => {
    if (!preference.matches) return;
    stopMotion();
    // Cancel an in-flight native anchor journey at the reader's current place.
    window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: "instant" });
  });
  window.addEventListener("pagehide", stopMotion);

  if (preference.matches || !("IntersectionObserver" in window)) return;
  const items = [...document.querySelectorAll(EDITORIAL_ITEMS)];
  // Do not animate content already in view, including restored page positions.
  const pending = new Set(items.filter((item) => item.getBoundingClientRect().top >= window.innerHeight));
  if (!pending.size) return;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const item = entry.target;
      if (!pending.has(item)) continue;
      observer.unobserve(item);
      pending.delete(item);
      // Hash/focus navigation and jumps past a section need no entrance effect.
      if (preference.matches || document.hidden || entry.boundingClientRect.top < 0 || item.closest(":target") || item.contains(document.activeElement) || typeof item.animate !== "function") continue;
      const animation = item.animate([
        { transform: "translateY(8px)" },
        { transform: "none" }
      ], { duration: 280, easing: "cubic-bezier(.2,.65,.3,1)" });
      animations.add(animation);
      const finished = () => animations.delete(animation);
      animation.addEventListener("finish", finished, { once: true });
      animation.addEventListener("cancel", finished, { once: true });
    }
    if (!pending.size) observer.disconnect();
  }, { threshold: 0, rootMargin: "0px 0px -24px 0px" });
  for (const item of pending) observer.observe(item);
}
