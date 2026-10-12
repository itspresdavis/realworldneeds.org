const menu = document.querySelector(".rwn-page-menu");
// Native details owns expanded semantics; repair focus only if closing hides it.
const closeMenu = (repairClosed = false) => {
  if (!menu || (!menu.open && !repairClosed)) return;
  const ownsFocus = menu.contains(document.activeElement);
  menu.removeAttribute("open");
  if (!ownsFocus) return;
  const target = [menu.querySelector("summary"), ...menu.closest("header").querySelectorAll("a")].find(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
      && getComputedStyle(node).visibility !== "hidden";
  });
  target?.focus({ preventScroll: true });
};
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !menu?.open
    || !menu.contains(event.target) || event.target.closest("dialog, [role=dialog], input, select, textarea, [contenteditable]")
    || !event.target.closest("summary, a[href]")) return;
  event.preventDefault();
  closeMenu();
});
document.addEventListener("click", event => {
  if (menu?.open && !menu.contains(event.target)) closeMenu();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeMenu(true);
}, { passive: true });
// Fresh loads and same-document navigation retain their existing state owners.
window.addEventListener("pageshow", event => {
  if (event.persisted) closeMenu();
});
