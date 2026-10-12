// A source snapshot is evidence of what was reported then, not live availability.
const CLOSURE_LABELS = new Set(["Closed", "Temporarily closed"]);

export function sourceClosureNotice(resource) {
  if (!CLOSURE_LABELS.has(resource.collectionStatus)) return null;
  const checked = resource.collectionStatusCheckedOn;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(checked || "")
    && Number.isFinite(Date.parse(`${checked}T00:00:00Z`))
    && new Date(`${checked}T00:00:00Z`).toISOString().slice(0, 10) === checked
    ? `Snapshot checked ${checked}.` : "Snapshot date unavailable.";
  return {
    title: `Source reported: ${resource.collectionStatus}`,
    detail: `${resource.sourceName || "Original source"}. ${date} Current availability is unverified. ${resource.locationPrecision === "contact-only" ? "Check current contact routes with the provider." : "Contact the provider before travel."}`
  };
}

// Keep the original catalog note intact; avoid repeating an undated closure as current advice.
export function availabilityInstructions(resource) {
  const note = String(resource.availabilityNote || "");
  const prefix = `${resource.collectionStatus}. `;
  return sourceClosureNotice(resource) && note.startsWith(prefix) ? note.slice(prefix.length) : note;
}

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function sourceClosureMarkup(resource) {
  const notice = sourceClosureNotice(resource);
  if (!notice) return "";
  const alternatives = resource.category === "food"
    ? '<a href="/directory/help/food">Browse other food listings</a>'
    : '<a href="/directory">Browse other listings</a>';
  return `<aside class="source-status-notice" aria-label="Source-reported availability"><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.detail)}</p>${alternatives}</aside>`;
}
