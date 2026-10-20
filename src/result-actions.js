import { isContactOnly, hasMapCoordinates } from "./utils/resource-location.js";
import { resources } from "./data/resources.js";
import { phoneLinks } from "./utils/phone.js";

const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

function directionsUrl(resource) {
  const coordinate = `${resource.lat},${resource.lng}`;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`;
}

function createAction(label, href, ariaLabel, { primary = false, newTab = false } = {}) {
  const anchor = document.createElement("a");
  anchor.className = `result-direct-action${primary ? " is-primary" : ""}`;
  anchor.href = href;
  anchor.textContent = label;
  anchor.setAttribute("aria-label", ariaLabel);
  if (newTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  return anchor;
}

function replaceResultTrigger(trigger, resource) {
  const link = document.createElement("a");
  link.className = `${trigger.className || ""} result-row-link`.trim();
  link.href = `/service/${encodeURIComponent(resource.id)}`;
  link.innerHTML = trigger.innerHTML;
  // Let the visible name, location, help types and review text name the link.
  trigger.replaceWith(link);
  return link;
}

function enhanceCard(article) {
  if (article.dataset.resultEnhanced === "true") return;
  const trigger = article.querySelector("[data-resource-id]");
  const resource = resourceById.get(trigger?.dataset.resourceId);
  if (!resource) return;

  article.dataset.resultEnhanced = "true";
  article.dataset.resultResourceId = resource.id;
  replaceResultTrigger(trigger, resource);

  const actions = document.createElement("nav");
  actions.className = "result-direct-actions";
  actions.setAttribute("aria-label", `Actions for ${resource.name}`);

  if (resource.kind === "direct" || isContactOnly(resource)) {
    const phones = phoneLinks(resource.phone);
    for (const { label, href } of phones) {
      const visible = phones.length > 1 ? `Call ${label}` : "Call";
      actions.append(createAction(visible, href, `${visible} ${resource.name} at ${label}`, { primary: true }));
    }
    if (resource.kind === "direct" && hasMapCoordinates(resource)) {
      actions.append(createAction("Directions", directionsUrl(resource), `Directions to ${resource.name}`, { newTab: true }));
    }
    if (isContactOnly(resource) && resource.accessUrl) {
      actions.append(createAction("Contact website", resource.accessUrl, `Contact website for ${resource.name}`, { newTab: true }));
    }
    if (!actions.childElementCount) {
      const providerUrl = resource.providerUrl || resource.sourceUrl;
      if (providerUrl) actions.append(createAction("Provider website", providerUrl, `Provider website for ${resource.name}`, { newTab: true }));
    }
  } else {
    const providerUrl = resource.providerUrl || resource.sourceUrl;
    if (providerUrl) {
      actions.append(createAction("Official finder", providerUrl, `Official finder for ${resource.name}`, { primary: true, newTab: true }));
    }
  }

  if (isContactOnly(resource) && resource.phoneAccess) {
    const scope = document.createElement("small");
    scope.textContent = `Dialing scope: ${resource.phoneAccess}`;
    article.append(scope);
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

  document.documentElement.classList.add("rwn-result-actions");
}
