import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resources } from "../src/data/resources.js";
import { phoneLinks } from "../src/utils/phone.js";
import { hasMapCoordinates } from "../src/utils/resource-location.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";
import { reviewedProviderUrl, serviceContactMarkup } from "../scripts/service-contact.mjs";

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
const base = { id: "synthetic-contact", kind: "direct", sourceUrl: "https://source.example/", phone: "+1 (202) 555-0123", lat: 40, lng: -73, accessType: "Appointment" };

test("multi-service contact panels offer a local choice before route-specific travel actions", () => {
  const item = resources.find(resource => resource.id === "bowery-mission");
  const html = serviceContactMarkup(item);
  assert.match(html, /href="#before-you-go-title"/);
  assert.match(html, /Choose service access/);
  assert.match(html, /Call organization/);
  assert.doesNotMatch(html, /google\.com\/maps|maps\.apple\.com|Directions to|Shelter intake details/);
  assert.match(html, /href="\/#resource=bowery-mission"/);
});

test("supplemental provider URLs must be reviewed HTTPS, safe, and distinct from existing routes", () => {
  for (const providerUrl of [null, "", "/relative", "javascript:alert(1)", "http://example.org", "https://", "https://user:password@example.org", "https://example.org/\npath", "https://source.example", "https://access.example/"]) {
    assert.equal(reviewedProviderUrl({ ...base, providerUrl, accessUrl: "https://access.example/" }), null, String(providerUrl));
  }
  const providerUrl = 'https://provider.example/contact?one=1&two="help"';
  assert.equal(reviewedProviderUrl({ ...base, providerUrl }), providerUrl);
  assert.ok(serviceContactMarkup({ ...base, providerUrl }).includes(`href="${escape(providerUrl)}"`));
});

test("contact-only actions retain scope and channels without maps or travel advice", () => {
  for (const phone of [null, "211", "Call the provider"]) {
    const item = { ...base, kind: "locator", locationPrecision: "contact-only", phone, accessUrl: "https://access.example/", providerUrl: "https://access.example/", phoneAccess: "Domestic calls only", coverageNote: "Check coverage with this provider" };
    const html = serviceContactMarkup(item);
    assert.match(html, /Get help online/);
    assert.doesNotMatch(html, /is-provider|service-location-actions|maps\/|\/#resource=|travel|before you go|Open resource finder/);
    assert.match(html, /check coverage and eligibility/);
    if (phone) assert.ok(html.includes(item.phoneAccess));
    assert.equal((html.match(/href="tel:/g) || []).length, phoneLinks(phone).length);
  }
});

test("finder wording follows reviewed access type rather than a broad locator classification", () => {
  for (const accessType of ["Online partner locator", "Free anonymous online search", "Member-country directory"]) {
    assert.match(serviceContactMarkup({ ...base, kind: "locator", accessType }), /<strong>Open resource finder<\/strong>/);
  }
  for (const accessType of ["Online country guidance", "Phone advice line", "Online application", "Phone, text, and online"]) {
    const html = serviceContactMarkup({ ...base, kind: "locator", accessType });
    assert.doesNotMatch(html, /Open resource finder/);
    assert.match(html, /<strong>Official source<\/strong>/);
  }
});

test("every generated service keeps source and phone semantics while exposing reviewed provider routes", async () => {
  let providerCount = 0;
  for (const resource of resources) {
    const page = await readFile(`dist/service/${resource.id}/index.html`, "utf8");
    const panel = page.match(/<nav class="service-next-steps"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(panel, resource.id);
    assert.match(panel, /aria-labelledby="service-contact-heading"/);
    assert.match(panel, /<h2 id="service-contact-heading">/);
    assert.ok(panel.includes(`class="is-primary" href="${escape(resource.sourceUrl)}"`), resource.id);
    const providerUrl = reviewedProviderUrl(resource);
    assert.equal(panel.includes('class="is-provider"'), Boolean(providerUrl), resource.id);
    if (providerUrl) {
      providerCount++;
      assert.ok(panel.includes(`href="${escape(providerUrl)}"`), resource.id);
      assert.ok(panel.indexOf('class="is-provider"') < panel.indexOf('class="service-location-actions"'), resource.id);
    }
    assert.deepEqual([...panel.matchAll(/href="(tel:[^"]+)"/g)].map(match => match[1]), phoneLinks(resource.phone).map(link => link.href), resource.id);
    const destinations = [...panel.matchAll(/class="is-map is-directions" href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&')).searchParams.get('destination'));
    const expected = resource.serviceAccess
      ? resource.serviceAccess.filter(route => route.mode === 'walk-in' && route.directions !== false || route.mode === 'intake' && route.directions === true).map(route => route.address)
      : resource.kind === 'direct' && hasMapCoordinates(resource) ? [`${resource.lat},${resource.lng}`] : [];
    assert.deepEqual(destinations, resource.serviceAccess ? [] : expected, `${resource.id}: explicit service travel follows its restrictions`);
    const pageDestinations = [...page.matchAll(/href="(https:\/\/www\.google\.com\/maps\/dir\/[^\"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&')).searchParams.get('destination'));
    assert.deepEqual([...new Set(pageDestinations)].sort(), [...new Set(expected)].sort(), `${resource.id}: every page direction uses a verified service address or legacy coordinates`);
    if (resource.serviceAccess) {
      assert.match(panel, /href="#before-you-go-title"/);
      assert.ok(page.indexOf(panel) < page.indexOf('data-service-before-you-go'), `${resource.id}: contact and service choice are available first`);
      assert.match(page, /id="before-you-go-title" tabindex="-1"/);
    }
    assert.equal(panel.includes('/#resource='), hasMapCoordinates(resource), resource.id);
    if (sourceClosureNotice(resource)) assert.ok(page.indexOf('class="source-status-notice"') < page.indexOf(panel), resource.id);
  }
  assert.ok(providerCount > 0, "catalog includes reviewed supplemental provider routes");
});
