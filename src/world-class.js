const MOBILE_BREAKPOINT = 760;

function announce(message) {
  const status = document.getElementById("worldClassStatus");
  if (!status) return;
  status.textContent = "";
  requestAnimationFrame(() => { status.textContent = message; });
}

function installGlobalStatus() {
  if (document.getElementById("worldClassStatus")) return;
  const status = document.createElement("p");
  status.id = "worldClassStatus";
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  document.body.append(status);
}

function installBrowseModeChoice() {
  const intro = document.querySelector(".finder-intro");
  const locationActions = document.querySelector(".location-actions");
  if (!intro || document.querySelector(".finder-route")) return;

  const route = document.createElement("nav");
  route.className = "finder-route";
  route.setAttribute("aria-label", "Choose how to find services");
  route.innerHTML = `
    <a class="finder-route__current" href="/directory">Browse the text directory</a>
    <a href="#help">See how to help</a>
  `;
  (locationActions || intro).insertAdjacentElement("afterend", route);
  const quickNeeds = document.querySelector(".quick-needs");
  if (quickNeeds) route.insertAdjacentElement("afterend", quickNeeds);
}

function installSearchKeyboardUX() {
  const input = document.getElementById("resourceSearch");
  if (!input) return;
  input.setAttribute("aria-keyshortcuts", "/ Escape");
  input.setAttribute("autocapitalize", "none");

  const helper = document.querySelector(".search-helper");
  if (helper) {
    helper.id ||= "resourceSearchHelp";
    const describedBy = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    describedBy.add(helper.id);
    input.setAttribute("aria-describedby", [...describedBy].join(" "));
  }

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !input.value) return;
    event.preventDefault();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    announce("Search cleared");
  });
}

function installResultLandmark() {
  const results = document.querySelector(".results-section");
  const grid = document.getElementById("resourceGrid");
  const quickNeeds = document.querySelector(".quick-needs");
  if (!results || !grid) return;

  results.id ||= "results";
  results.setAttribute("role", "region");
  results.setAttribute("aria-labelledby", "resultTitle");
  grid.setAttribute("tabindex", "-1");

  if (quickNeeds && !document.querySelector(".jump-results")) {
    const link = document.createElement("a");
    link.className = "jump-results";
    link.href = "#results";
    link.textContent = "Skip the map and view results";
    quickNeeds.insertAdjacentElement("afterend", link);
  }
}

function installAccessibleResourcePanel() {
  const panel = document.getElementById("resourcePanel");
  if (!panel) return;

  panel.removeAttribute("aria-live");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Selected service details");
  panel.setAttribute("tabindex", "-1");

  let lastTitle = "";
  const update = () => {
    const title = panel.querySelector("h2")?.textContent?.trim() || "";
    if (!title || title === lastTitle) return;
    lastTitle = title;
    panel.setAttribute("aria-label", `Service details: ${title}`);
    announce(`Showing details for ${title}`);
  };

  new MutationObserver(update).observe(panel, { childList: true, subtree: true });
  update();
}

function installDeepLinks() {
  const grid = document.getElementById("resourceGrid");
  if (!grid) return;

  const decorate = () => {
    for (const article of grid.querySelectorAll(".resource-card")) {
      if (article.querySelector(".resource-deep-link")) continue;
      const trigger = article.querySelector("[data-resource-id]");
      const id = trigger?.dataset.resourceId;
      if (!id) continue;
      const link = document.createElement("a");
      link.className = "resource-deep-link";
      link.href = `/service/${encodeURIComponent(id)}`;
      link.textContent = "Full details";
      link.setAttribute("aria-label", `Open permanent details page for ${trigger.querySelector("strong")?.textContent?.trim() || "this service"}`);
      article.append(link);
    }
  };

  new MutationObserver(decorate).observe(grid, { childList: true });
  decorate();
}

function installMobileTaskbar() {
  if (document.querySelector(".mobile-taskbar")) return;
  const nav = document.createElement("nav");
  nav.className = "mobile-taskbar";
  nav.setAttribute("aria-label", "Quick navigation");
  nav.innerHTML = `
    <a href="#finder"><span aria-hidden="true">⌕</span><b>Search</b></a>
    <a href="#results"><span aria-hidden="true">☷</span><b>Results</b></a>
    <a href="/directory"><span aria-hidden="true">≡</span><b>Directory</b></a>
  `;
  document.body.append(nav);

  const syncVisibility = () => {
    document.documentElement.classList.toggle("show-mobile-taskbar", window.innerWidth <= MOBILE_BREAKPOINT && window.scrollY > 180);
  };
  window.addEventListener("scroll", syncVisibility, { passive: true });
  window.addEventListener("resize", syncVisibility, { passive: true });
  syncVisibility();
}

function installResultContext() {
  const count = document.getElementById("resultCount");
  const searchStatus = document.getElementById("searchStatus");
  if (!count || !searchStatus) return;

  const update = () => {
    const text = searchStatus.textContent?.trim();
    if (!text) return;
    count.setAttribute("aria-label", text);
  };
  new MutationObserver(update).observe(searchStatus, { childList: true, characterData: true, subtree: true });
  update();
}

function installScrollFocus() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href="#results"]');
    if (!link) return;
    const results = document.getElementById("results");
    if (!results) return;
    window.setTimeout(() => document.getElementById("resultTitle")?.focus({ preventScroll: true }), 240);
  });
  const resultTitle = document.getElementById("resultTitle");
  resultTitle?.setAttribute("tabindex", "-1");
}

export function installWorldClassUX() {
  installGlobalStatus();
  installBrowseModeChoice();
  installSearchKeyboardUX();
  installResultLandmark();
  installAccessibleResourcePanel();
  installDeepLinks();
  installMobileTaskbar();
  installResultContext();
  installScrollFocus();
  document.documentElement.classList.add("rwn-world-class");
}
