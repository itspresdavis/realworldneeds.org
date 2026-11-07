import { serviceActions, serviceAccessSummary, validateServiceAccess } from "../src/utils/service-access.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { resourceDescription } from "../scripts/resource-description.mjs";
import { categories, resources } from "../src/data/resources.js";
import { platformStatus } from "../src/data/platform.js";
import { freeAccessLabel, freeAccessModels } from "../src/data/free-access.js";
import { formatResourcePlace } from "../src/utils/geo.js";
import { phoneLinks, phoneMarkup } from "../src/utils/phone.js";
import { isContactOnly, hasMapCoordinates, contactOnlyNotice } from "../src/utils/resource-location.js";
import { sourceClosureNotice, sourceClosureMarkup, availabilityInstructions } from "../src/utils/source-status.js";
import { summarizeCoverage } from '../scripts/coverage-report.mjs';

const flagged = resources.filter(sourceClosureNotice);
const closed = flagged[0];
const decode = (value) => value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const metadata = (html, attribute, name) => {
  const tags = [...html.matchAll(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"[^>]*>`, "g"))];
  assert.equal(tags.length, 1, `exactly one ${name} tag`);
  return decode(tags[0][1]);
};
const graph = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];

for (const status of ["Closed", "Temporarily closed"]) {
  test(`${status} descriptions lead with the full dated source warning without an access promise`, () => {
    const fixture = Object.freeze({ ...closed, collectionStatus: status, collectionStatusCheckedOn: "2026-08-07", lastChecked: "2099-01-01" });
    const before = JSON.stringify(fixture);
    const notice = sourceClosureNotice(fixture);
    const description = resourceDescription(fixture, "Visitors can access a free parcel now.");
    assert.equal(description, `${notice.title}. ${notice.detail} Listing: ${fixture.name}.`);
    assert.match(description, /^Source reported: /);
    assert.match(description, /Snapshot checked 2026-08-07\. Current availability is unverified\./);
    assert.match(description, /Contact the provider before travel\./);
    assert.doesNotMatch(description, /2099|Visitors can access|food-bank voucher can access/);
    assert.equal(JSON.stringify(fixture), before);
  });
}

test("ordinary, unknown and hours-only statuses preserve caller descriptions exactly", () => {
  const fallback = 'Original description with "quotes", & an unchanged date.';
  for (const collectionStatus of [undefined, null, "", "Open", "Collection only", "Closed on Sundays", "Not closed", "Warehouse", "Delivery only"]) {
    const fixture = { ...closed, collectionStatus, summary: fallback, availabilityNote: "Temporarily closed. Closed on Sundays.", hours: "Closed Monday" };
    assert.equal(resourceDescription(fixture), fallback);
    assert.equal(resourceDescription(fixture, `${fallback} Cost and source date.`), `${fallback} Cost and source date.`);
  }
});

test("missing or invalid closure snapshot dates never borrow the review or build date", () => {
  for (const collectionStatusCheckedOn of [undefined, "", "bad-date", "2026-02-30", "<script>"]) {
    const description = resourceDescription({ ...closed, collectionStatusCheckedOn, lastChecked: "2099-01-01" });
    assert.match(description, /Snapshot date unavailable\. Current availability is unverified\./);
    assert.doesNotMatch(description, /Snapshot checked|2099|<script>/);
  }
});

test("contact-only warnings keep contact-route guidance rather than travel advice", () => {
  const fixture = { ...closed, locationPrecision: "contact-only" };
  const description = resourceDescription(fixture);
  const notice = sourceClosureNotice(fixture);
  assert.ok(description.startsWith(`${notice.title}. ${notice.detail}`));
  assert.match(description, /Check current contact routes with the provider\./);
  assert.doesNotMatch(description, /before travel/);
});

async function renderService(fixture, platform = platformStatus) {
  const source = await readFile("scripts/build.mjs", "utf8");
  // Exercise the production template without running its filesystem build.
  const start = source.indexOf("// A page of");
  const end = source.indexOf("const three = createThreeAssets(");
  assert.ok(start >= 0 && end > start, "template extraction must stop before build execution");
  const templates = source.slice(start, end);
  return vm.runInNewContext(`${templates}\nresourcePage(fixture)`, {
    platformStatus: platform,
    fixture, resources: [fixture], categories, sourceRegistry: [], serviceActions, serviceAccessSummary, validateServiceAccess,
    freeAccessLabel, freeAccessModels, formatResourcePlace, phoneLinks, phoneMarkup,
    isContactOnly, hasMapCoordinates, contactOnlyNotice,
    sourceClosureNotice, sourceClosureMarkup, availabilityInstructions, resourceDescription, summarizeCoverage
  });
}

test("the actual service template escapes source/name text in metadata and JSON-LD", async () => {
  const fixture = { ...closed, name: 'Example "centre" & </script><script>alert(1)</script>', sourceName: 'Publisher "quoted" & <unsafe>' };
  const html = await renderService(fixture);
  const expected = resourceDescription(fixture);
  assert.equal(metadata(html, "name", "description"), expected);
  assert.equal(metadata(html, "property", "og:description"), expected);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|<unsafe>/);
  assert.match(html, /\\u003c/);
  for (const type of ["WebPage", "Service"]) {
    const node = graph(html).find((entry) => entry["@type"] === type);
    assert.equal(node.description, expected);
    assert.equal(Object.hasOwn(node, "availability"), false);
    assert.equal(Object.hasOwn(node, "status"), false);
  }
});

test("listing correction links stay closed by default and prefill only public identity when approved", async () => {
  assert.equal(platformStatus.publicCorrectionLinksEnabled, false);
  const fixture = { ...closed, id: "example-service" };
  const disabled = await renderService(fixture);
  assert.doesNotMatch(disabled, /href="\/corrections\?/);
  const enabled = await renderService(fixture, { ...platformStatus, publicCorrectionLinksEnabled: true });
  const links = [...enabled.matchAll(/href="(\/corrections\?[^"]*)"/g)];
  assert.equal(links.length, 1);
  const url = new URL(links[0][1], "https://www.realworldneeds.org");
  assert.deepEqual([...url.searchParams], [["resourceId", fixture.id]]);
});

test("every source-flagged final page carries the full warning in search, share and schema descriptions", async () => {
  assert.ok(flagged.some((resource) => resource.collectionStatus === "Closed"));
  assert.ok(flagged.some((resource) => resource.collectionStatus === "Temporarily closed"));
  for (const resource of flagged) {
    const html = await readFile(`dist/service/${resource.id}/index.html`, "utf8");
    const expected = resourceDescription(resource);
    const notice = sourceClosureNotice(resource);
    for (const [attribute, name] of [["name", "description"], ["property", "og:description"], ["name", "twitter:description"]]) {
      const description = metadata(html, attribute, name);
      assert.equal(description, expected, `${resource.id}: ${name}`);
      assert.ok(description.startsWith(`${notice.title}. ${notice.detail}`), resource.id);
      assert.ok(!description.includes(resource.summary), `${resource.id}: do not repeat the unqualified access promise`);
    }
    for (const type of ["WebPage", "Service"]) {
      const node = graph(html).find((entry) => entry["@type"] === type);
      assert.equal(node.description, expected, `${resource.id}: ${type}`);
      assert.equal(Object.hasOwn(node, "availability"), false);
      assert.equal(Object.hasOwn(node, "status"), false);
    }
    assert.ok(decode(html).includes(notice.title), `${resource.id}: existing visible notice`);
    assert.ok(decode(html).includes(notice.detail), `${resource.id}: existing visible qualification`);
  }
});

test("every unaffected final page retains its existing search, share and schema descriptions", async () => {
  for (const resource of resources.filter((entry) => !sourceClosureNotice(entry))) {
    const html = await readFile(`dist/service/${resource.id}/index.html`, "utf8");
    const originalMeta = `${resource.summary} ${freeAccessLabel(resource)}. Source checked ${resource.lastChecked}.`;
    for (const [attribute, name] of [["name", "description"], ["property", "og:description"], ["name", "twitter:description"]]) {
      assert.equal(metadata(html, attribute, name), originalMeta, `${resource.id}: ${name}`);
    }
    for (const type of ["WebPage", "Service"]) {
      assert.equal(graph(html).find((entry) => entry["@type"] === type).description, resource.summary, `${resource.id}: ${type}`);
    }
  }
});
