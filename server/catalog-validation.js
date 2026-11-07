import { isContactOnly, validateResourceLocation } from "../src/utils/resource-location.js";
const editable = new Set([
  "name",
  "summary",
  "address",
  "hours",
  "phone",
  "eligibility",
  "sourceName",
  "sourceUrl",
  "lastChecked",
  "lat",
  "lng",
]);
export function validateEdit(body) {
  if (
    !body ||
    typeof body.id !== "string" ||
    body.id.length > 160 ||
    typeof body.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(body.updatedAt))
  )
    return "The record revision is missing. Reopen the listing.";
  if (
    typeof body.reason !== "string" ||
    body.reason.trim().length < 10 ||
    body.reason.length > 1000
  )
    return "Explain this change in 10 to 1,000 characters.";
  if (
    typeof body.published !== "boolean" ||
    !body.changes ||
    Array.isArray(body.changes) ||
    typeof body.changes !== "object"
  )
    return "Invalid record changes.";
  for (const [key, value] of Object.entries(body.changes)) {
    if (!editable.has(key)) return `The ${key} field cannot be changed here.`;
    if (key === "lat" || key === "lng") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > (key === "lat" ? 90 : 180)
      )
        return "Coordinates are outside their valid range.";
    } else if (
      typeof value !== "string" ||
      value.length > (key === "summary" || key === "eligibility" ? 2000 : 1000)
    )
      return "A text field is too long or invalid.";
    if (
      ["name", "summary", "address", "sourceName"].includes(key) &&
      !value.trim()
    )
      return `${key} is required.`;
    if (key === "sourceUrl") {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password)
          return "The source must be a public HTTPS URL.";
      } catch {
        return "The source URL is invalid.";
      }
    }
    if (key === "lastChecked") {
      const date = new Date(`${value}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value ||
        value > new Date().toISOString().slice(0, 10)
      )
        return "Use a valid review date that is not in the future.";
    }
  }
  return null;
}

// Coordinates for a contact-only route cannot be introduced by the editor.
export function validateLocationEdit(current, changes) {
  return (isContactOnly(current) || current?.locationPrecision === "address") ? validateResourceLocation({ ...current, ...changes }) : null;
}
