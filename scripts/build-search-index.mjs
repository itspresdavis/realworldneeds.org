import { mkdir, writeFile } from "node:fs/promises";
import { categories, resources } from "../src/data/resources.js";
import { formatResourcePlace } from "../src/utils/geo.js";

const normalize = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9+]+/g, " ")
  .trim();

const allTypes = (resource) => [resource.category, ...(resource.secondaryCategories || [])];

const records = resources.map((resource) => {
  const types = allTypes(resource);
  const labels = types.map((type) => categories[type]?.label || type);
  const place = formatResourcePlace(resource);
  const search = normalize([
    resource.name,
    resource.city,
    resource.country,
    resource.region,
    resource.address,
    resource.sourceName,
    resource.summary,
    ...(resource.services || []),
    ...types,
    ...labels
  ].join(" "));

  return {
    id: resource.id,
    name: resource.name,
    place,
    country: resource.country,
    category: resource.category,
    categories: types,
    categoryLabels: labels,
    kind: resource.kind,
    checked: resource.lastChecked,
    search
  };
});

await mkdir("dist/data", { recursive: true });
await writeFile("dist/data/search-index.json", `${JSON.stringify({
  schemaVersion: "1.0",
  resourceCount: records.length,
  privacy: "Static search index. Search terms remain in the visitor's browser and are not included in requests.",
  records
})}\n`);
