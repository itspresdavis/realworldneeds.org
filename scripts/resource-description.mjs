import { sourceClosureNotice } from "../src/utils/source-status.js";

// A source-reported closure is a dated snapshot, not current verification.
// Reuse the visible warning and avoid pairing it with an access promise from
// the ordinary summary. Unflagged descriptions remain exactly as supplied.
export function resourceDescription(resource, fallback = resource.summary) {
  const notice = sourceClosureNotice(resource);
  return notice
    ? `${notice.title}. ${notice.detail} Listing: ${resource.name}.`
    : fallback;
}
