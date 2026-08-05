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
