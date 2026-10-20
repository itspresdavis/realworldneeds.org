import { makeResource, renderTrussellSnapshot } from "../scripts/refresh-trussell-foodbanks.mjs";
import { makeNewYorkWicResource } from "../scripts/refresh-new-york-wic.mjs";
import { phoneLinks } from "../src/utils/phone.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { sourceClosureNotice, sourceClosureMarkup, availabilityInstructions } from "../src/utils/source-status.js";
import { trussellFoodbankMetadata, trussellFoodbankResources } from "../src/data/generated/trussell-foodbanks.js";
import { resources } from "../src/data/resources.js";

const read = (path) => readFile(path, "utf8");
const closed = trussellFoodbankResources.find((resource) => resource.collectionStatus === "Closed");
const flagged = resources.filter(sourceClosureNotice);

for (const status of ["Closed", "Temporarily closed"]) {
  test(`${status} is attributed to a dated source snapshot, never presented as current verification`, () => {
    const resource = { ...closed, collectionStatus: status, collectionStatusCheckedOn: "2026-08-07", lastChecked: "2099-01-01" };
    const notice = sourceClosureNotice(resource);
    assert.equal(notice.title, `Source reported: ${status}`);
    assert.match(notice.detail, /Trussell\. Snapshot checked 2026-08-07\./);
    assert.match(notice.detail, /Current availability is unverified/);
    assert.doesNotMatch(notice.detail, /2099/);
  });
}

test("closure is never inferred from opening-hours prose, unknown labels, or missing data", () => {
  for (const collectionStatus of [undefined, null, "", "Open", "Collection only", "Closed on Sundays", "Not closed", "Warehouse", "Delivery only"]) {
    assert.equal(sourceClosureNotice({ availabilityNote: "Temporarily closed. Closed on Sundays.", collectionStatus }), null);
    assert.equal(sourceClosureMarkup({ collectionStatus }), "");
  }
});

test("missing and invalid snapshot dates are honestly reported instead of falling back to review/build dates", () => {
  for (const collectionStatusCheckedOn of [undefined, "", "bad-date", "2026-02-30", "<script>"]) {
    const notice = sourceClosureNotice({ ...closed, collectionStatusCheckedOn });
    assert.match(notice.detail, /Snapshot date unavailable/);
    assert.doesNotMatch(notice.detail, /Snapshot checked/);
  }
});

test("generated records expose source labels without changing the underlying collection instructions or dates", () => {
  const counts = new Map();
  for (const resource of trussellFoodbankResources) {
    assert.ok(resource.availabilityNote.startsWith(`${resource.collectionStatus}. `));
    assert.equal(resource.collectionStatusCheckedOn, trussellFoodbankMetadata.checkedOn);
    counts.set(resource.collectionStatus, (counts.get(resource.collectionStatus) || 0) + 1);
  }
  assert.equal(flagged.length, 0, "withheld Trussell centre statuses are not in the public catalog");
  assert.equal((counts.get("Closed") || 0) + (counts.get("Temporarily closed") || 0), 49);
});

test("presentation removes only the exact closure prefix and preserves the original source note", () => {
  const original = closed.availabilityNote;
  assert.ok(original.startsWith("Closed. "));
  assert.equal(availabilityInstructions(closed), original.slice("Closed. ".length));
  assert.equal(closed.availabilityNote, original);
  const ordinary = { collectionStatus: "Collection only", availabilityNote: "Collection only. Call first." };
  assert.equal(availabilityInstructions(ordinary), ordinary.availabilityNote);
  assert.equal(availabilityInstructions({ ...closed, availabilityNote: "Closed on Sundays." }), "Closed on Sundays.");
});

test("status markup escapes source text and offers an internal alternatives link", () => {
  const html = sourceClosureMarkup({ ...closed, sourceName: '<img src=x onerror="alert(1)">' });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /href="\/directory\/help\/food"/);
  assert.match(html, /aria-label="Source-reported availability"/);
  assert.doesNotMatch(html, /hidden|<details/);
});

test("all affected service pages show their warning before Call or Directions", async () => {
  for (const resource of flagged) {
    const html = await read(`dist/service/${resource.id}/index.html`);
    const warning = html.indexOf('<aside class="source-status-notice"');
    const actions = html.indexOf('<nav class="service-next-steps"');
    assert.ok(warning > 0 && warning < actions, `${resource.id}: warning must precede actions`);
    assert.match(html, /Confirm availability before travel/);
    assert.doesNotMatch(html, /<strong>Confirm before you go\.<\/strong> (?:Temporarily closed|Closed)\./);
    assert.ok(html.slice(warning, actions).includes(`Snapshot checked ${resource.collectionStatusCheckedOn}`));
  }
  const normal = await read("dist/service/bowery-mission/index.html");
  assert.doesNotMatch(normal, /<aside class="source-status-notice"/);
});

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

test("every static directory card, including local pages, puts the warning outside details and before quick actions", async () => {
  const ids = new Set(flagged.map((resource) => resource.id));
  const seen = new Set();
  let localCards = 0;
  for (const path of await htmlFiles("dist/directory")) {
    const html = await read(path);
    for (const article of html.matchAll(/<article class="directory-record"[\s\S]*?<\/article>/g)) {
      const id = article[0].match(/href="\/service\/([^"]+)"/)?.[1];
      if (!ids.has(id)) continue;
      seen.add(id);
      const warning = article[0].indexOf('<aside class="source-status-notice"');
      const actions = article[0].indexOf('data-rwn-actions=');
      const details = article[0].indexOf('<details');
      assert.ok(warning > 0 && warning < actions, `${path}: ${id}`);
      assert.ok(details < 0 || warning < details, `${path}: warning cannot be collapsed`);
      if (path.includes("/local/")) localCards += 1;
    }
  }
  assert.equal(seen.size, 0);
  assert.equal(flagged.length, 0);
  assert.equal(localCards, 0);
});

test("search export contains matching status notices for all affected records and none for unflagged records", async () => {
  const index = JSON.parse(await read("dist/data/search-index.json"));
  assert.equal(index.schemaVersion, "1.5");
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  for (const record of index.records) {
    assert.deepEqual(record.sourceStatus || null, sourceClosureNotice(byId.get(record.id)));
  }
  assert.equal(index.records.filter((record) => record.sourceStatus).length, flagged.length);
});

function element(tag) {
  const result = { tag, children: [], attributes: {}, classes: new Set(), append(...items) { this.children.push(...items); }, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {} };
  result.classList = { add: (value) => result.classes.add(value) };
  return result;
}

for (const online of [true, false]) {
  test(`directory search renders a visible, text-safe warning before actions when ${online ? "online" : "offline"}`, async () => {
    const script = await read("public/directory-results.js");
    const context = vm.createContext({ document: { createElement: element }, navigator: { onLine: online } });
    vm.runInContext(`${script.replace("export const createResultRow", "const createResultRow")}\nglobalThis.render = createResultRow;`, context);
    const record = { ...closed, phoneLinks: phoneLinks(closed.phone), place: "Coventry, United Kingdom", categoryLabels: ["Food"], checked: closed.lastChecked, sourceStatus: sourceClosureNotice(closed) };
    const wrap = context.render(record, { id: "offline" });
    assert.equal(wrap.children[0].tag, "a");
    assert.equal(wrap.children[1].tag, "aside");
    assert.equal(wrap.children[2].tag, "nav");
    assert.equal(wrap.children[1].children[1].textContent, record.sourceStatus.detail);
    assert.ok(wrap.classes.has("has-source-status"));
    const safe = context.render({ ...record, sourceStatus: { title: "<img onerror=alert(1)>", detail: "<script>bad</script>" } }, { id: "offline" });
    assert.equal(safe.children[1].children[0].textContent, "<img onerror=alert(1)>");
    assert.equal(safe.children[1].children[0].innerHTML, undefined);
    const unflagged = context.render({ ...record, sourceStatus: undefined }, { id: "offline" });
    assert.equal(unflagged.children.length, 2);
  });
}

test("finder warnings stay outside collapsed panel details and before enhanced result actions", async () => {
  const app = await read("src/app.js");
  const panel = app.slice(app.indexOf("function renderResourcePanel()"), app.indexOf("function resourceCard("));
  assert.ok(panel.indexOf("${sourceClosureMarkup(resource)}") < panel.indexOf('<details class="panel-detail-disclosure"'));
  const card = app.slice(app.indexOf("function resourceCard("), app.indexOf("function renderResults("));
  assert.ok(card.indexOf("${sourceClosureMarkup(resource)}") > card.indexOf("</button>"));
  assert.ok(card.indexOf("${sourceClosureMarkup(resource)}") < card.indexOf("</article>"));
  const actions = await read("src/result-actions.js");
  assert.match(actions, /article\.append\(actions\)/);
});

test("affected records are not suggested as related alternatives and copied details retain the warning", async () => {
  await assert.rejects(access(`dist/service/${closed.id}/index.html`));
  assert.equal(flagged.length, 0);
  const html = await read("dist/service/whitechapel-mission/index.html");
  const related = html.match(/<section class="related-services"[\s\S]*?<\/section>/)?.[0] || "";
  assert.doesNotMatch(related, /\/service\/trussell-[0-9a-f-]{36}/i);
  const script = await read("public/service-actions.js");
  const start = script.indexOf("  const publicDetails = () => {");
  const end = script.indexOf("\n  const fallbackCopy", start);
  const notice = sourceClosureNotice(closed);
  const context = vm.createContext({
    title: closed.name, place: closed.city, officialSource: closed.sourceUrl,
    listingUrl: `https://www.realworldneeds.org/service/${closed.id}`,
    document: { querySelectorAll: () => [], querySelector: () => ({ querySelectorAll: () => [{ textContent: notice.title }, { textContent: notice.detail }] }) }
  });
  vm.runInContext(`${script.slice(start, end)}\nglobalThis.copy = publicDetails;`, context);
  const copied = context.copy();
  assert.ok(copied.includes(`${notice.title}\n${notice.detail}`));
  assert.ok(copied.indexOf(notice.detail) < copied.indexOf("RWN listing:"));
});

test("new Trussell imports generate the same explicit source-status fields without changing snapshot dates", () => {
  const record = { uuid: "00000000-0000-4000-8000-000000000001", title: "Fixture", town: "London", address01: "1 Fixture Street", postcode: "SW1A 1AA", geoLocation: '{"type":"Point","coordinates":[0,51]}', dcsStatusLabel: "Temporarily closed", referralType: "telephone" };
  const resource = makeResource(record, 1, "2026-09-10");
  const snapshot = { rawByUuid: new Map([[record.uuid, { record, page: 1 }]]), totalResults: 1, totalPages: 1 };
  const output = renderTrussellSnapshot(snapshot, [resource], {}, "2026-09-10");
  const generated = vm.createContext({});
  vm.runInContext(`${output.replaceAll("export const", "const")}\nglobalThis.records = trussellFoodbankResources;`, generated);
  assert.equal(generated.records[0].collectionStatus, "Temporarily closed");
  assert.equal(generated.records[0].collectionStatusCheckedOn, "2026-09-10");
  assert.equal(generated.records[0].lastChecked, "2026-09-10");
});

test("New York importer distinguishes verified publisher metadata from the fetch date", () => {
  const row = { site_number: "1", site_type: "Permanent", agency_name: "Fixture", city: "New York", street_address: "1 Fixture Street", location_1: { latitude: "40.7", longitude: "-73.9" } };
  const record = makeNewYorkWicResource(row, { checkedOn: "2026-10-12", sourceUpdatedAt: "2026-04-30" });
  assert.equal(record.sourceUpdatedAt, "2026-04-30");
  assert.equal(record.lastChecked, "2026-10-12");
  assert.throws(() => makeNewYorkWicResource(row, { checkedOn: "2026-10-12" }), /source update/);
});

test("aggregate refresh includes every separately supported snapshot importer", async () => {
  const { scripts } = JSON.parse(await read("package.json"));
  const individual = Object.keys(scripts).filter((key) => key.startsWith("refresh:data:"));
  assert.equal(individual.length, 3);
  assert.deepEqual(scripts["refresh:data"].split(" && "), individual.map((key) => `npm run ${key}`));
});

// The first build pass hashes every source file, before optional runtime transforms.
test("finder URLs change with generated snapshot content, including collection status", async () => {
  async function sourceFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) files.push(...await sourceFiles(path));
      else files.push(path);
    }
    return files.sort();
  }
  const files = ["index.html", ...await sourceFiles("src")];
  const actual = createHash("sha256"), changedSnapshot = createHash("sha256");
  for (const path of files) {
    const contents = await readFile(path);
    actual.update(path).update(contents);
    changedSnapshot.update(path).update(contents);
    if (path === "src/data/generated/trussell-foodbanks.js") changedSnapshot.update("\n// New source snapshot");
  }
  const expected = actual.digest("hex").slice(0, 12);
  const release = JSON.parse(await read("dist/data/release.json"));
  assert.equal(release.release, expected);
  assert.notEqual(changedSnapshot.digest("hex").slice(0, 12), expected);
  assert.ok((await read("dist/index.html")).includes(`/src/bootstrap.js?v=${expected}`));
  const resourcesSource = await read("dist/src/data/resources.js");
  assert.ok(resourcesSource.includes(`./generated/massachusetts-wic.js?v=${expected}`));
  assert.equal(resourcesSource.includes("trussell-foodbanks.js"), false);
  assert.ok((await read("dist/src/app.js")).includes(`./utils/source-status.js?v=${expected}`));
});
