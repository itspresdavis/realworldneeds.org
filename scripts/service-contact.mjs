import { isContactOnly, hasMapCoordinates, contactOnlyNotice } from "../src/utils/resource-location.js";
import { phoneLinks } from "../src/utils/phone.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// Provider links are supplemental snapshot evidence, never inferred from a name
// or source domain. Keep the exact reviewed URL after validating its scheme.
export function reviewedProviderUrl(resource) {
  const value = resource.providerUrl;
  if (typeof value !== "string" || !value.startsWith("https://") || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const existing = [resource.sourceUrl, resource.accessUrl].filter(Boolean);
    if (existing.some(link => new URL(link).href === url.href)) return null;
    return value;
  } catch {
    return null;
  }
}

export function serviceContactMarkup(resource) {
  const phones = phoneLinks(resource.phone);
  const contactOnly = isContactOnly(resource);
  const directLocation = resource.kind === "direct" && hasMapCoordinates(resource);
  const finder = resource.kind === "locator";
  const network = resource.kind === "network";
  const hasFinder = finder && /\b(locator|finder|search|directory)\b/i.test(resource.accessType || "");
  const warning = sourceClosureNotice(resource);
  const providerUrl = reviewedProviderUrl(resource);
  const heading = warning ? (contactOnly ? "Confirm current availability" : "Confirm availability before travel")
    : contactOnly ? "Contact this service"
    : hasFinder ? "Find help through this provider"
    : network ? "Explore the service network" : "Contact the provider";
  const context = contactOnly
    ? `<p class="service-next-steps__context">${escapeHtml(contactOnlyNotice(resource))}</p>${resource.phone ? `<p class="service-next-steps__context">Phone dialing scope: ${escapeHtml(resource.phoneAccess)}</p>` : ""}`
    : finder || network
      ? `<p class="service-next-steps__context">This is a ${finder ? "help finder or referral service" : "service network"}, not a walk-in location.</p>` : "";
  const phoneContext = resource.phone && (phones.length !== 1 || phones[0].label !== resource.phone)
    ? `<p class="service-next-steps__context" data-phone-context>Phone: ${escapeHtml(resource.phone)}</p>` : "";
  const links = phones.map(({ label, href }) => `<a class="is-call" href="${href}"><strong>Call</strong><span>${escapeHtml(label)}</span></a>`);
  if (contactOnly && resource.accessUrl) {
    links.push(`<a class="is-online" href="${escapeHtml(resource.accessUrl)}" rel="noopener noreferrer"><strong>Get help online</strong><span>Use the reviewed access link</span></a>`);
  }
  if (providerUrl) {
    links.push(`<a class="is-provider" href="${escapeHtml(providerUrl)}" rel="noopener noreferrer"><strong>Provider website</strong><span>Check access with the provider</span></a>`);
  }
  links.push(`<a class="is-primary" href="${escapeHtml(resource.sourceUrl)}" rel="noopener noreferrer"><strong>${hasFinder && !contactOnly ? "Open resource finder" : "Official source"}</strong><span>${hasFinder && !contactOnly ? "Official source · Check local options" : "Verify current details"}</span></a>`);
  const locations = [];
  if (directLocation) {
    const coordinate = `${resource.lat},${resource.lng}`;
    locations.push(`<a class="is-map is-directions" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(coordinate)}" rel="noopener noreferrer">Directions<span class="service-contact-link-note">Google Maps</span></a>`);
  }
  if (hasMapCoordinates(resource)) locations.push(`<a href="/#resource=${encodeURIComponent(resource.id)}">Interactive map<span class="service-contact-link-note">View on RWN</span></a>`);
  const priority = phones.length ? "phone" : contactOnly && resource.accessUrl ? "online" : providerUrl ? "provider" : "source";
  return `<nav class="service-next-steps" aria-labelledby="service-contact-heading" data-contact-priority="${priority}"><div class="service-contact-intro"><span>Your next step</span><h2 id="service-contact-heading">${heading}</h2>${context}${phoneContext}</div><div class="service-contact-actions"><div class="service-contact-buttons">${links.join("")}</div>${locations.length ? `<div class="service-location-actions">${locations.join("")}</div>` : ""}</div></nav>`;
}
