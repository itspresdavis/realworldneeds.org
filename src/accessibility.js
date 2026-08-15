function announce(message) {
  const status = document.getElementById("accessibilityStatus");
  if (!status) return;
  status.textContent = "";
  requestAnimationFrame(() => { status.textContent = message; });
}

function installGlobalStatus() {
  if (document.getElementById("accessibilityStatus")) return;
  const status = document.createElement("p");
  status.id = "accessibilityStatus";
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  document.body.append(status);
}

function installSearchAccessibility() {
  const input = document.getElementById("resourceSearch");
  if (!input) return;
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("aria-keyshortcuts", "/ Escape");

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

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    input.select();
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
    link.textContent = "See matching services";
    link.setAttribute("aria-label", "Skip the map and see matching services");
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

export function installAccessibility() {
  installGlobalStatus();
  installSearchAccessibility();
  installResultLandmark();
  installAccessibleResourcePanel();
  installResultContext();
  document.documentElement.classList.add("rwn-accessibility");
}
