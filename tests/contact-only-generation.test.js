import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { categories, resources } from "../src/data/resources.js";
import { groupLocalities } from "../scripts/locality-groups.mjs";

const execute = promisify(execFile);
// Synthetic single-site fixtures must not inherit another provider’s access routes.
const { serviceAccess: originalAccess, ...base } = resources.find(resource => resource.kind === "direct" && resource.country === "United States");
const mapped = [1, 2, 3].map(number => ({
  ...base, id: `fixture-mapped-${number}`, name: `Reviewed service ${number}`,
  city: "Boston", country: "United States", address: `${number} Main St, MA 02101`,
  lat: 42.36 + number / 100, lng: -71.05, category: "food", secondaryCategories: [],
  collectionStatus: undefined
}));
const contact = (id, fields) => ({
  ...base, id, name: `Reviewed ${id}`, city: undefined, kind: "locator",
  locationPrecision: "contact-only", lat: undefined, lng: undefined,
  address: "Massachusetts residents; contact the provider remotely.",
  coverageNote: "Available to residents of Massachusetts only.",
  eligibility: "Massachusetts residents who need food support.",
  accessType: "Contact the provider for help", category: "food", secondaryCategories: [],
  costModel: "free-navigation", costNote: "Free to use this referral service.",
  sourceUrl: "https://example.org/reviewed-source", sourceName: "Reviewed test provider",
  services: ["Food referrals"], summary: "Reviewed contact channel for food referrals.",
  phone: undefined, phoneAccess: undefined, hours: undefined,
  availabilityNote: "Confirm current eligibility with the provider.",
  coordinateNote: "A legacy coordinate note must not imply a destination.",
  collectionStatus: undefined, ...fields
});
const contacts = [
  contact("fixture-phone-only", { phone: "211", phoneAccess: "Dial 211 within Massachusetts only." }),
  contact("fixture-online-only", { kind: "network", city: "Boston", lat: null, lng: null, accessUrl: "https://example.org/apply?area=ma&service=food" }),
  contact("fixture-phone-and-online", { city: "Boston", phone: "+1 (617) 555-0123", phoneAccess: "United States callers; charges may apply.", accessUrl: "https://example.org/help", collectionStatus: "Temporarily closed", collectionStatusCheckedOn: "2026-10-10" })
];

test("contact channels never contribute city counts, even when a reviewed city is supplied", () => {
  const groups = groupLocalities([...mapped, ...contacts]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map(resource => resource.id), mapped.map(resource => resource.id));
  assert.equal(groupLocalities(contacts).length, 0);
});

test("full static pipeline preserves contact-only access without map, city or travel claims", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "rwn-contact-generation-"));
  const sourceCatalog = await readFile("src/data/resources.js", "utf8");
  try {
    // Keep synthetic records out of the reviewed catalog and the shared dist.
    await Promise.all(["src", "public", "scripts", "index.html", "package.json"].map(path => cp(path, join(directory, path), { recursive: true })));
    await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
    const fixtures = [...mapped, ...contacts];
    await writeFile(join(directory, "src/data/resources.js"), `export const categories = ${JSON.stringify(categories)};\nexport const resourceTypes = Object.keys(categories);\nexport const resources = ${JSON.stringify(fixtures)};\n`);
    await execute(process.execPath, ["scripts/validate-data.mjs"], { cwd: directory, timeout: 30_000 });
    const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
    for (const command of scripts.build.split(" && ")) {
      const [executable, ...args] = command.split(" ");
      assert.equal(executable, "node", "fixture build executes only the repository's Node build steps");
      await execute(process.execPath, args, { cwd: directory, timeout: 30_000 });
    }
    const read = path => readFile(join(directory, "dist", path), "utf8");
    const json = async path => JSON.parse(await read(path));
    const map = await json("data/map-index.json");
    assert.equal(map.resourceCount, mapped.length);
    assert.deepEqual(map.resources.map(resource => resource.id), mapped.map(resource => resource.id));
    const catalog = await json("data/resources.json");
    assert.equal(catalog.resourceCount, fixtures.length);
    assert.deepEqual(catalog.resources, JSON.parse(JSON.stringify(fixtures)));
    const index = await json("data/search-index.json");
    assert.equal(index.resourceCount, fixtures.length);
    assert.equal(index.scopes["/directory/united-states"].length, fixtures.length);
    assert.equal(index.scopes["/directory/help/food"].length, fixtures.length);
    const local = await json("data/resources/local-index.json");
    assert.equal(local.cities.length, 1);
    assert.equal(local.cities[0].count, mapped.length);
    assert.equal(index.scopes[local.cities[0].path].length, mapped.length);
    const localPage = await read(`${local.cities[0].path.slice(1)}/index.html`);
    const directoryPage = await read("directory/index.html");
    const csv = await read("directory.csv");
    assert.match(csv.split("\n")[0], /"Location precision","Coverage details","Phone dialing scope","Online access"$/);
    const sitemap = await read("sitemap.xml");
    for (const resource of contacts) {
      assert.ok(!localPage.includes(resource.id));
      const record = index.records.find(item => item.id === resource.id);
      assert.equal(record.locationPrecision, "contact-only");
      assert.equal(record.lat, null);
      assert.equal(record.lng, null);
      for (const field of ["coverageNote", "eligibility", "phoneAccess", "accessUrl"]) assert.equal(record[field], resource[field]);
      assert.match(record.locationNotice, /No walk-in location/);
      const csvRow = csv.split("\n").find(row => row.startsWith(`"${resource.id}",`));
      assert.ok(csvRow.includes('"","","Resource finder"') || csvRow.includes('"","","Service network"'));
      assert.ok(csvRow.includes(resource.coverageNote));
      assert.ok(csvRow.includes('"contact-only"'));
      assert.ok(sitemap.includes(`/service/${resource.id}`));
      const html = await read(`service/${resource.id}/index.html`);
      const main = html.match(/<main id="service"[\s\S]*?<\/main>/)?.[0];
      assert.ok(main);
      assert.match(main, /data-location-precision="contact-only"/);
      assert.ok(main.includes(resource.coverageNote));
      assert.ok(main.includes(resource.eligibility));
      assert.doesNotMatch(main, /maps\.apple|google\.com\/maps|\/#resource=|before (?:you )?(?:go|travel)|near Boston|legacy coordinate note/i);
      const related = main.match(/<section class="related-services"[\s\S]*?<\/section>/)?.[0];
      assert.match(related, /Related help in United States/);
      assert.doesNotMatch(related, /\bnear\b|\bkm\b|Directions|fixture-phone-and-online/);
      assert.ok(!related.includes(`href="/service/${resource.id}"`));
      if (resource.phone) assert.ok(main.includes(resource.phoneAccess));
      if (resource.accessUrl) assert.ok(main.includes(resource.accessUrl.replaceAll("&", "&amp;")));
      const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      const service = schema["@graph"].find(item => item["@type"] === "Service");
      assert.equal(service.areaServed, resource.coverageNote);
      assert.equal(service.availableChannel["@type"], "ServiceChannel");
      assert.equal(service.availableChannel.serviceUrl, resource.accessUrl);
      if (resource.phone) {
        assert.equal(service.availableChannel.servicePhone.telephone, resource.phone);
        assert.equal(service.availableChannel.servicePhone.description, resource.phoneAccess);
      }
      for (const field of ["address", "geo", "location", "hasMap"]) assert.equal(service[field], undefined);
      const article = directoryPage.match(new RegExp(`<article class="directory-record" id="${resource.id}"[\\s\\S]*?<\\/article>`))?.[0];
      assert.ok(article?.includes(resource.coverageNote));
      assert.ok(article.includes(resource.eligibility));
      assert.doesNotMatch(article, /maps\.apple|google\.com\/maps|\/#resource=|before (?:you )?(?:go|travel)/i);
    }
    for (const resource of mapped) {
      const record = index.records.find(item => item.id === resource.id);
      assert.equal(record.locationPrecision, undefined, "legacy index payload stays unchanged");
      assert.equal(record.coverageNote, undefined);
      const html = await read(`service/${resource.id}/index.html`);
      assert.ok(html.includes(`/#resource=${resource.id}`));
      assert.ok(html.includes("google.com/maps/dir/"));
      const related = html.match(/<section class="related-services"[\s\S]*?<\/section>/)?.[0];
      assert.match(related, /Phone or online help/);
      assert.ok(related.includes('href="/service/fixture-phone-only"'));
      assert.ok(related.includes('href="/service/fixture-online-only"'));
      assert.doesNotMatch(related, /fixture-phone-and-online|\bnear\b|\bkm\b|Directions/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(await readFile("src/data/resources.js", "utf8"), sourceCatalog);
});
