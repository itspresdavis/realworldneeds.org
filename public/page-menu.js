const menu = document.querySelector(".rwn-page-menu");
const compact = window.matchMedia("(max-width: 68rem)");
const isMenuControl = node => menu?.contains(node) && node.closest("summary, a[href]")
  && !node.closest("dialog, [role=dialog], input, select, textarea, [contenteditable]");
const repairFocus = () => {
  if (!menu.contains(document.activeElement) && document.activeElement !== document.body) return;
  const target = [menu.querySelector("summary"), ...menu.closest("header").querySelectorAll("a")].find(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
      && getComputedStyle(node).visibility !== "hidden";
  });
  target?.focus({ preventScroll: true });
};
// Native details owns expanded semantics. Preserve deliberately moved focus.
const closeMenu = (repairClosed = false) => {
  if (!menu || (!menu.open && !repairClosed)) return;
  const ownsFocus = menu.contains(document.activeElement);
  menu.removeAttribute("open");
  if (ownsFocus) repairFocus();
};
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !menu?.open || !isMenuControl(event.target)) return;
  event.preventDefault();
  closeMenu();
});
document.addEventListener("click", event => {
  if (!menu?.open) return;
  if (!menu.contains(event.target)) closeMenu();
  else if (event.target.closest?.("a[href]")) menu.removeAttribute("open");
});
// Responsive hiding can clear native focus before or after the resize event.
menu?.addEventListener("focusout", event => {
  if (!event.relatedTarget && isMenuControl(event.target) && !compact.matches
    && document.hasFocus() && document.activeElement === document.body && getComputedStyle(menu).display === "none") repairFocus();
});
window.addEventListener("resize", () => {
  if (!compact.matches) closeMenu(true);
}, { passive: true });
// Fresh loads and same-document navigation retain their existing state owners.
window.addEventListener("pageshow", event => {
  if (event.persisted) closeMenu();
});
