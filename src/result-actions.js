import { resources } from "./data/resources.js";

const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function cleanPhone(value) {
  return String(value || "").replace(/[^+\d]/g, "");
}

function directionsUrl(resource) {
  const coordinate = `${resource.lat},${resource.lng}`;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`;
}

function createAction(label, href, ariaLabel, { primary = false } = {}) {
  const anchor = document.createElement("a");
  anchor.className = `result-direct-action${primary ? " is-primary" : ""}`;
  anchor.href = href;
  anchor.textContent = label;
  anchor.setAttribute("aria-label", ariaLabel);
  if (!href.startsWith("tel:")) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  return anchor;
}

function enhanceCard(article) {
  if (article.querySelector(".result-direct-actions")) return;
  const trigger = article.querySelector("[data-resource-id]");
  const resource = resourceById.get(trigger?.dataset.resourceId);
  if (!resource) return;

  const actions = document.createElement("nav");
  actions.className = "result-direct-actions";
  actions.setAttribute("aria-label", `Quick actions for ${resource.name}`);

  if (resource.phone) {
    const phone = cleanPhone(resource.phone);
    if (phone) actions.append(createAction("Call", `tel:${phone}`, `Call ${resource.name}`, { primary: true }));
  }

  if (resource.kind === "direct" && Number.isFinite(resource.lat) && Number.isFinite(resource.lng)) {
    actions.append(createAction("Directions", directionsUrl(resource), `Get directions to ${resource.name}`));
  }

  const providerUrl = resource.providerUrl || resource.sourceUrl;
  if (providerUrl) {
    actions.append(createAction(
      resource.kind === "direct" ? "Provider site" : "Find local help",
      providerUrl,
      resource.kind === "direct" ? `Visit ${resource.name} website` : `Open the official resource finder for ${resource.name}`
    ));
  }

  if (actions.childElementCount) article.append(actions);
}

function enhanceResults(grid) {
  grid.querySelectorAll(".resource-card").forEach(enhanceCard);
}

export function installResultActions() {
  const grid = document.getElementById("resourceGrid");
  if (!grid || grid.dataset.directActionsInstalled === "true") return;
  grid.dataset.directActionsInstalled = "true";
  enhanceResults(grid);

  const observer = new MutationObserver(() => enhanceResults(grid));
  observer.observe(grid, { childList: true });

  grid.addEventListener("click", (event) => {
    const action = event.target.closest(".result-direct-action");
    if (!action || window.innerWidth > 900) return;
    const row = action.closest(".resource-card");
    if (!row) return;
    row.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  });

  document.documentElement.classList.add("rwn-result-actions");
}
