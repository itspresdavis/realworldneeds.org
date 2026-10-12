// Fresh loads and same-document navigation own their normal focus and state.
// A retained document alone can bring back an expanded native details menu.
const menu = document.querySelector(".rwn-page-menu");
window.addEventListener("pageshow", event => {
  if (!event.persisted || !menu?.open) return;
  const ownsFocus = menu.contains(document.activeElement);
  menu.removeAttribute("open");
  if (!ownsFocus) return;
  const target = [menu.querySelector("summary"), ...menu.closest("header").querySelectorAll("a")].find(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
      && getComputedStyle(node).visibility !== "hidden";
  });
  target?.focus({ preventScroll: true });
});
