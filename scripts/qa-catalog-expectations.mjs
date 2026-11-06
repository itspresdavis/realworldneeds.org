import { resources } from "../src/data/resources.js";
import { resourceSearchScore } from "../src/utils/search.js";

// Expected counts come from the reviewed input catalog, never from the UI being
// tested. A source withdrawal must not leave a stale country-scope denominator.
export function directoryWicFixture(shown, category = "Food", catalog = resources) {
  const scoped = catalog.filter(record => record.country === "United States");
  const matches = scoped.filter(record => (category === "All help"
    || [record.category, ...(record.secondaryCategories || [])].includes("food"))
    && resourceSearchScore(record, "WIC") >= 0);
  const rows = Math.min(shown, matches.length);
  const format = value => value.toLocaleString("en-US");
  return {
    query: "WIC", country: "United States", category, rows,
    count: matches.length ? `${format(matches.length)} matching ${matches.length === 1 ? "listing" : "listings"}` : "No matching listings",
    summary: `${format(rows)} of ${format(matches.length)} matches · ${format(scoped.length)} listings`
  };
}

// This deliberately uses the raw country/city/category facts rather than the
// shared locality builder or a generated scope/UI result as its own oracle.
export function newYorkCatalogFixtures(catalog = resources) {
  const city = catalog.filter(record => record.country === "United States" && record.city === "New York");
  const ids = records => records.map(record => record.id).sort();
  return {
    city: ids(city),
    referral: ids(city.filter(record => [record.category, ...(record.secondaryCategories || [])].includes("referral"))),
    wic: ids(city.filter(record => record.id.startsWith("ny-wic-")))
  };
}
