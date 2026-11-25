import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { phoneLinks } from "../src/utils/phone.js";
import { validateResourceLocation } from "../src/utils/resource-location.js";
import { resources } from "../src/data/resources.js";
import { createContactFixtureApp, contactFixtureResources, contactFixtureLabel } from "../scripts/qa-contact-fixture-app.mjs";
import { assertContactRows, assertContactService, contactHomepageSnapshot, isContactHomepageReady, contactFailureSnapshot } from "../scripts/qa-contact-only.mjs";

const contacts = contactFixtureResources.filter(resource => resource.locationPrecision === "contact-only");
const digest = async path => {
  try { return createHash("sha256").update(await readFile(path)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

test("synthetic contact fixtures preserve domestic shortcodes and stay outside the actual catalog", () => {
  assert.equal(contactFixtureResources.length, 6);
  assert.equal(contacts.length, 3);
  for (const resource of contactFixtureResources) {
    assert.equal(validateResourceLocation(resource), null, resource.id);
    assert.match(resource.name, /^Synthetic QA /);
    assert.equal(new URL(resource.sourceUrl).hostname, "rwn-qa.example.invalid");
    assert.ok(!resources.some(actual => actual.id === resource.id));
  }
  assert.deepEqual(phoneLinks(contacts[0].phone), [{ label: "211", href: "tel:211" }]);
  assert.equal(contacts[1].phone, undefined);
  assert.ok(contacts[1].accessUrl.length > 240);
  assert.match(new URL(contacts[1].accessUrl).pathname, /^\/[a-z]{280,}$/);
  assert.equal(contacts[2].collectionStatus, "Temporarily closed");
});

test("homepage readiness uses rendered fixture identities after professional copy replacement", () => {
  const state = {
    presented: true, inputReady: true, banner: true, bannerText: contactFixtureLabel,
    rows: contactFixtureResources.map(resource => ({ id: resource.id, enhanced: true, href: `/service/${resource.id}`, text: resource.name, visible: true }))
  };
  assert.equal(isContactHomepageReady(state, contactFixtureResources), true);
  assert.doesNotMatch(contactHomepageSnapshot.toString(), /principleGrid|trustPrinciples/);
  for (const change of [
    { presented: false }, { inputReady: false }, { banner: false }, { bannerText: "Production directory" },
    { rows: state.rows.slice(1) }, { rows: state.rows.map(row => ({ ...row, visible: false })) },
    { rows: state.rows.map(row => ({ ...row, enhanced: false })) }, { rows: state.rows.map(row => ({ ...row, href: "/" })) },
    { rows: state.rows.map(row => ({ ...row, id: "actual-catalog-record" })) },
    { rows: state.rows.map(row => ({ ...row, text: "Uninitialized placeholder" })) }
  ]) assert.equal(isContactHomepageReady({ ...state, ...change }, contactFixtureResources), false);
});

test("homepage snapshot reads enhanced result links after transient buttons are replaced", () => {
  const box = () => ({ width: 250, height: 60 });
  const input = { disabled: false, getBoundingClientRect: box };
  const banner = { textContent: contactFixtureLabel, getBoundingClientRect: box };
  const rows = contactFixtureResources.map(resource => ({
    dataset: { resultResourceId: resource.id, resultEnhanced: "true" }, getBoundingClientRect: box,
    querySelector: selector => selector === ".result-row-link" ? {
      textContent: resource.name, getBoundingClientRect: box,
      getAttribute: name => name === "href" ? `/service/${resource.id}` : null
    } : null
  }));
  const document = {
    documentElement: { classList: { contains: value => ["rwn-professional", "rwn-result-actions"].includes(value) } },
    querySelector: selector => ({ "#resourceSearch": input, "[data-qa-fixture-banner]": banner }[selector]),
    querySelectorAll: selector => selector === "#resourceGrid .resource-card" ? rows : []
  };
  const snapshot = vm.runInNewContext(`(${contactHomepageSnapshot})()`, { document, getComputedStyle: () => ({ visibility: "visible", display: "block" }) });
  assert.equal(isContactHomepageReady(snapshot, contactFixtureResources), true);
  assert.equal(snapshot.rows.length, 6);
  assert.equal(snapshot.rows[0].href, "/service/qa-contact-phone");
});

test("fixture failure evidence includes bounded document context without capturing other origins", () => {
  const origin = "http://127.0.0.1:4175";
  const context = {
    location: { origin, href: `${origin}/service/qa-contact-phone` }, innerWidth: 390, innerHeight: 844,
    document: { title: "Synthetic QA", readyState: "complete", body: { innerText: "x".repeat(5000) },
      querySelector: () => ({ dataset: { serviceId: "qa-contact-phone" } }), querySelectorAll: () => [] }
  };
  const snapshot = vm.runInNewContext(`(${contactFailureSnapshot})(${JSON.stringify(origin)})`, context);
  assert.equal(snapshot.url, context.location.href);
  assert.equal(snapshot.title, "Synthetic QA");
  assert.equal(snapshot.readyState, "complete");
  assert.equal(snapshot.serviceId, "qa-contact-phone");
  assert.equal(snapshot.width, 390);
  assert.equal(snapshot.bodyText.length, 4000);
  const outside = vm.runInNewContext(`(${contactFailureSnapshot})('http://127.0.0.1:9999')`, context);
  assert.equal(outside.fixture, false);
  for (const field of ["url", "title", "serviceId", "bodyText", "searchRows", "savedRows"]) assert.equal(outside[field], null);
});

test("full isolated fixture build has complete homepage exports, local-only labels and a static loopback server", { timeout: 60_000 }, async () => {
  const tracked = ["src/data/resources.js", "src/data/live-sources.js", "dist/data/resources.json", "dist/data/map-index.json", "dist/data/search-index.json", "dist/index.html"];
  const before = await Promise.all(tracked.map(digest));
  // Force a symlinked temporary parent on Linux too, matching macOS /tmp.
  const tempParent = await mkdtemp(join(tmpdir(), "rwn-fixture-parent-"));
  const tempAlias = join(tempParent, "linked");
  await symlink(tempParent, tempAlias, "dir");
  const originalTmpdir = process.env.TMPDIR;
  let app;
  try {
    process.env.TMPDIR = tempAlias;
    app = await createContactFixtureApp();
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    if (!app) await rm(tempParent, { recursive: true, force: true });
  }
  try {
    assert.equal(app.directory, await realpath(app.directory), "fixture root must use canonical paths without weakening containment");
    assert.match(app.host, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(!app.directory.startsWith(process.cwd()));
    const fixtureModule = await import(pathToFileURL(join(app.directory, "src/data/resources.js")));
    assert.ok(fixtureModule.categories.food);
    assert.ok(fixtureModule.resourceTypes.includes("food"));
    assert.equal(fixtureModule.resources.length, 6);
    assert.equal(fixtureModule.trustPrinciples[0].text, contactFixtureLabel);
    const feeds = await import(pathToFileURL(join(app.directory, "src/data/live-sources.js")));
    assert.deepEqual(feeds.sourceRegistry, []);
    assert.deepEqual(await feeds.fetchNearbyUsdaSites(), []);
    assert.equal(await feeds.fetchUsdaActiveCount(), null);
    for (const path of ["/", "/directory", "/service/qa-contact-phone", "/service/qa-contact-web"]) {
      const response = await fetch(app.host + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("x-robots-tag"), /noindex/);
      assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
      const html = await response.text();
      assert.match(html, /<title>\[SYNTHETIC LOCAL QA\]/);
      assert.ok(html.includes(contactFixtureLabel));
      assert.match(html, /data-qa-fixture-banner/);
      assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
    }
    const data = await (await fetch(`${app.host}/data/resources.json`)).json();
    assert.deepEqual(data.resources, JSON.parse(JSON.stringify(contactFixtureResources)));
    const map = await (await fetch(`${app.host}/data/map-index.json`)).json();
    assert.deepEqual(map.resources.map(resource => resource.id), ["qa-physical-1", "qa-physical-2", "qa-physical-3"]);
    const index = await (await fetch(`${app.host}/data/search-index.json`)).json();
    assert.equal(index.records.length, 6);
    const css = await fetch(`${app.host}/legal.css`, { method: "HEAD" });
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /^text\/css/);
    assert.equal(await css.text(), "");
    assert.equal((await fetch(`${app.host}/api/fixture-check`)).status, 404);
    assert.equal((await fetch(`${app.host}/`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${app.host}/%2e%2e%2fpackage.json`)).status, 400);
    assert.equal((await fetch(`${app.host}/%00`)).status, 400);
    await symlink(join(app.directory, "package.json"), join(app.dist, "outside-dist.json"));
    assert.equal((await fetch(`${app.host}/outside-dist.json`)).status, 400);
    assert.equal((await fetch(`${app.host}/package.json`)).status, 404);
  } finally { await app.cleanup(); await rm(tempParent, { recursive: true, force: true }); }
  await app.cleanup();
  await assert.rejects(stat(app.directory), { code: "ENOENT" });
  assert.deepEqual(await Promise.all(tracked.map(digest)), before, "fixture generation must not modify the source catalog or shared production dist");
});

const serviceState = resource => ({
  id: resource.id, title: resource.name, banner: true, overflow: 0, next: true, source: resource.sourceUrl,
  rows: [["Coverage", resource.address], ["Coverage details", resource.coverageNote], ["Eligibility", resource.eligibility], ["Access", resource.accessType], ...(resource.phone ? [["Phone", resource.phone], ["Phone dialing scope", resource.phoneAccess]] : [])].map(([label, value]) => ({ label, value, visible: true, fontSize: 16 })),
  calls: phoneLinks(resource.phone).map(phone => phone.href),
  actions: [{ href: resource.sourceUrl }, ...phoneLinks(resource.phone), ...(resource.accessUrl ? [{ href: resource.accessUrl }] : [])].map(action => ({ ...action, visible: true, height: 48 })),
  geoLinks: [], text: "Phone or online help. No walk-in location is listed.",
  warning: `Source reported: ${resource.collectionStatus}. Snapshot checked ${resource.collectionStatusCheckedOn}. Current availability is unverified.`, warningVisible: true, warningBeforeActions: true
});

test("rendered service assertions reject hidden facts, invented geography and changed shortcodes", () => {
  for (const resource of contacts) assertContactService(serviceState(resource), resource);
  const resource = contacts[0];
  const baseline = serviceState(resource);
  for (const change of [
    { rows: baseline.rows.map(row => ({ ...row, visible: false })) },
    { rows: baseline.rows.map(row => ({ ...row, fontSize: 12 })) },
    { geoLinks: ["/#resource=qa-contact-phone"] },
    { text: "No walk-in location is listed. 0.1 km away" },
    { text: "No walk-in location is listed. Confirm before you go." },
    { calls: ["tel:+1211"] }, { overflow: 20 }, { actions: [{ href: resource.sourceUrl, visible: true, height: 20 }] }
  ]) assert.throws(() => assertContactService({ ...baseline, ...change }, resource));
  assert.throws(() => assertContactService({ ...serviceState(contacts[2]), warningBeforeActions: false }, contacts[2]));
});

const rowState = offline => ({
  offline, overflow: 0,
  rows: contacts.map(resource => ({
    id: resource.id, visible: true, clipped: false, text: `Phone or online help ${resource.name}`,
    facts: [resource.coverageNote, resource.eligibility, resource.phoneAccess, resource.accessUrl].filter(Boolean).map(text => ({ text, visible: true, fontSize: 13 })),
    actions: [
      ...phoneLinks(resource.phone).map(phone => ({ ...phone, text: `Call ${phone.label}`, visible: true, height: 44 })),
      ...(resource.accessUrl ? [{ href: resource.accessUrl, text: "Contact website", visible: !offline, height: 44 }] : []),
      { href: `/service/${resource.id}`, text: "View details", visible: !offline, height: 44 }
    ],
    warning: `${resource.collectionStatus} ${resource.collectionStatusCheckedOn}`, warningVisible: true
  }))
});

test("rendered result assertions keep the full URL readable during probe failure and recovery", () => {
  assertContactRows(rowState(false), contacts);
  assertContactRows(rowState(true), contacts, true);
  assertContactRows(rowState(false), contacts);
  const lostUrl = rowState(true);
  lostUrl.rows[1].facts = lostUrl.rows[1].facts.filter(fact => fact.text !== contacts[1].accessUrl);
  assert.throws(() => assertContactRows(lostUrl, contacts, true), /URL lost/);
  const falseOnline = rowState(true);
  falseOnline.rows[1].actions[0].visible = true;
  assert.throws(() => assertContactRows(falseOnline, contacts, true), /incorrectly available/);
  const clipped = rowState(false);
  clipped.rows[1].clipped = true;
  assert.throws(() => assertContactRows(clipped, contacts), /clipped/);
});

test("existing CI browser harness invokes isolated fixture QA and uses its screenshot hook", async () => {
  const harness = await readFile("scripts/browser-service-qa.mjs", "utf8");
  assert.match(harness, /import \{ verifyContactOnly \} from "\.\/qa-contact-only\.mjs"/);
  assert.match(harness, /await verifyContactOnly\(\{ client, navigate, evaluate, capture, qaDir: QA_DIR \}\)/);
  const fixtureStart = harness.indexOf("await verifyContactOnly(");
  assert.ok(fixtureStart > harness.indexOf('await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")])'));
  assert.ok(fixtureStart < harness.indexOf("const serviceUrl ="), "fixture checks fail early, and existing checks exercise restored browser state afterward");
  const helper = await readFile("scripts/qa-contact-fixture-app.mjs", "utf8");
  assert.doesNotMatch(helper, /from ["'][^"']*(?:api|server)\//);
  const qa = await readFile("scripts/qa-contact-only.mjs", "utf8");
  assert.doesNotMatch(qa, /spawn\(|remote-debugging|findChrome/);
  assert.match(qa, /await app\.cleanup\(\)/);
});
