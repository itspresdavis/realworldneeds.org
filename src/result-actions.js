import { isContactOnly, hasMapCoordinates } from "./utils/resource-location.js";
import { beforeYouGoFacts, serviceActions } from "./utils/service-access.js";
import { getLocale, t } from "./utils/localization.js";
import { resources } from "./data/resources.js";
import { phoneLinks } from "./utils/phone.js";

const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

function directionsUrl(resource) {
  return serviceActions(resource, { mapProvider: /iPad|iPhone|iPod/.test(navigator.userAgent) ? "apple" : "google" })[0]?.href || "";
}

function createAction(label, href, ariaLabel, { primary = false, newTab = false } = {}) {
  const anchor = document.createElement("a");
  anchor.className = `result-direct-action${primary ? " is-primary" : ""}`;
  anchor.href = href;
  anchor.textContent = label;
  anchor.setAttribute("aria-label", ariaLabel.toLowerCase().includes(label.toLowerCase()) ? ariaLabel : `${label}: ${ariaLabel}`);
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

  const locale = getLocale();
  const accessFacts = beforeYouGoFacts(resource, { locale });
  if (accessFacts.length) {
    const details = document.createElement("div");
    details.className = "result-access-facts";
    details.setAttribute("aria-label", t("beforeYouGo", {}, locale));
    for (const route of accessFacts) {
      const fact = document.createElement("p");
      const label = document.createElement("strong");
      label.textContent = `${route.label}: `;
      fact.append(label, document.createTextNode([route.instructions, ...route.facts.filter(item => item.key !== "hours" || resource.serviceAccess.some(item => item.id === route.routeId && (item.schedule || item.hours))).map(item => `${item.label}: ${item.value}`)].join(" ")));
      details.append(fact);
    }
    article.append(details);
  }

  const actions = document.createElement("nav");
  actions.className = "result-direct-actions";
  actions.setAttribute("aria-label", `Actions for ${resource.name}`);

  if (resource.kind === "direct" || isContactOnly(resource)) {
    const phones = phoneLinks(resource.phone);
    for (const { label, href } of phones) {
      actions.append(createAction(phones.length > 1 ? `Call ${label}` : "Call", href, `Call ${resource.name} at ${label}`, { primary: true }));
    }
    for (const action of serviceActions(resource, { mapProvider: /iPad|iPhone|iPod/.test(navigator.userAgent) ? "apple" : "google", locale })) {
      actions.append(createAction(action.label, action.href, `${action.label} for ${resource.name}`, { newTab: action.href.startsWith("https://") }));
    }
    if (isContactOnly(resource) && resource.accessUrl) {
      actions.append(createAction("Contact website", resource.accessUrl, `Open the contact website for ${resource.name}`, { newTab: true }));
    }
    if (!actions.childElementCount) {
      const providerUrl = resource.providerUrl || resource.sourceUrl;
      if (providerUrl) actions.append(createAction("Provider website", providerUrl, `Visit ${resource.name} website`, { newTab: true }));
    }
  } else {
    const providerUrl = resource.providerUrl || resource.sourceUrl;
    if (providerUrl) {
      actions.append(createAction("Official finder", providerUrl, `Open the official resource finder for ${resource.name}`, { primary: true, newTab: true }));
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
