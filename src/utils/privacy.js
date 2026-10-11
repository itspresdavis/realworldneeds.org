export const SAVED_RESOURCES_KEY = "rwn-saved-resources";

function resourceHash(url) {
  const value = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(value).get("resource");
}

export function resourceIdFromUrl(value) {
  const url = new URL(value);
  return resourceHash(url) || url.searchParams.get("resource");
}

export function privateResourceUrl(value, resourceId) {
  const url = new URL(value);
  url.searchParams.delete("resource");
  url.hash = new URLSearchParams({ resource: resourceId }).toString();
  return url;
}

export function clearResourceFromUrl(value) {
  const url = new URL(value);
  url.searchParams.delete("resource");
  if (resourceHash(url)) url.hash = "";
  return url;
}

// Read-only until an explicit Save, Remove, or Clear action. Keep the original
// array-of-IDs format so saved listings survive upgrades without migration.
export function readSavedResources(storage = window.localStorage) {
  const value = storage.getItem(SAVED_RESOURCES_KEY);
  let parsed;
  try { parsed = JSON.parse(value || "[]"); } catch { return new Set(); }
  return new Set(Array.isArray(parsed)
    ? parsed.filter((id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/.test(id))
    : []);
}

export function setResourceSaved(id, saved, storage = window.localStorage) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(id)) throw new Error("Invalid service identifier");
  const ids = readSavedResources(storage);
  if (saved) ids.add(id);
  else ids.delete(id);
  if (ids.size) storage.setItem(SAVED_RESOURCES_KEY, JSON.stringify([...ids]));
  else storage.removeItem(SAVED_RESOURCES_KEY);
  return ids;
}

export function clearSavedResources(storage = window.localStorage) {
  storage.removeItem(SAVED_RESOURCES_KEY);
}
