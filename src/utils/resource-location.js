// Contact channels are coverage information, never synthetic map locations.
// Keep this module catalog-free so validators and every public surface agree.
export const contactOnlyLabel = "Phone or online help";

export function isContactOnly(resource) {
  return resource?.locationPrecision === "contact-only";
}

export function hasMapCoordinates(resource) {
  return Boolean(resource && !isContactOnly(resource) && resource.locationPrecision !== 'address'
    && Number.isFinite(resource.lat) && Math.abs(resource.lat) <= 90
    && Number.isFinite(resource.lng) && Math.abs(resource.lng) <= 180);
}

export function contactOnlyNotice(resource) {
  return isContactOnly(resource)
    ? "Phone or online help. No walk-in location is listed; check coverage and eligibility before contacting the provider."
    : "";
}

export function validateResourceLocation(resource) {
  if (!resource || typeof resource !== "object") return "A resource is required.";
  if (resource.locationPrecision && !["exact", "address", "coverage", "contact-only"].includes(resource.locationPrecision))
    return "Unknown location precision.";
  if (resource.locationPrecision === 'address') {
    if (resource.kind !== 'direct' || resource.lat != null || resource.lng != null) return 'Address-only physical sites must be direct services without coordinates.';
    for (const field of ['city', 'country', 'address']) if (typeof resource[field] !== 'string' || !resource[field].trim() || /[\u0000-\u001f\u007f]/.test(resource[field])) return 'Address-only sites need a reviewed city, country and complete operating address.';
    if (resource.address.length < 8 || !resource.address.includes(',') || /^https?:|\bP\.?\s*O\.?\s*Box\b/i.test(resource.address)) return 'Address-only sites need a complete operating address, not a mailing destination.';
    if (!Array.isArray(resource.serviceAccess) || !resource.serviceAccess.some(route => ['walk-in', 'intake'].includes(route?.mode) && route.address === resource.address)) return 'Address-only sites need an explicit source-backed physical service route for their operating address.';
    return null;
  }
  if (!isContactOnly(resource)) {
    if (!hasMapCoordinates(resource)) return "Coordinates must be finite numbers within their valid range.";
    if (!String(resource.city || "").trim()) return "A mapped listing requires a city or coverage place.";
    if (resource.kind === "direct" && resource.locationPrecision && resource.locationPrecision !== "exact")
      return "Direct sites must have exact location semantics.";
    return null;
  }
  if (!["locator", "network"].includes(resource.kind)) return "Contact-only listings must be resource finders or networks.";
  if (resource.lat != null || resource.lng != null) return "Contact-only listings must not contain map coordinates.";
  for (const field of ["country", "address", "coverageNote", "eligibility"]) {
    if (typeof resource[field] !== "string" || !resource[field].trim())
      return `Contact-only listings require reviewed ${field}.`;
  }
  for (const field of ["phone", "accessUrl"]) {
    if (resource[field] != null && (typeof resource[field] !== "string" || (resource[field] !== "" && !resource[field].trim())))
      return `Contact-only ${field} must be nonblank text or an empty optional field.`;
  }
  const hasPhone = Boolean(resource.phone?.trim());
  const hasAccessUrl = Boolean(resource.accessUrl?.trim());
  if (!hasPhone && !hasAccessUrl) return "Contact-only listings require a phone number or access URL.";
  if (hasPhone && (typeof resource.phoneAccess !== "string" || !resource.phoneAccess.trim()))
    return "Contact-only phone numbers require reviewed dialing scope.";
  if (hasAccessUrl) {
    try {
      const url = new URL(resource.accessUrl);
      if (url.protocol !== "https:" || url.username || url.password || resource.accessUrl !== resource.accessUrl.trim() || !resource.accessUrl.startsWith("https://")) throw new Error();
    } catch { return "The contact access URL must be a public HTTPS URL."; }
  }
  return null;
}
