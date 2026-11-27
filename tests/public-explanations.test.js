import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// Run after the normal build: public copy and delivered HTML must agree.
for (const folder of ["public", "dist"]) {
  const read = (name) =>
    fs.readFileSync(path.join(folder, name + ".html"), "utf8");
  const plain = (html) =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:#39|apos);/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  const section = (html, id) =>
    plain(
      html.match(new RegExp(`<(?:section|details)[^>]* id="${id}"[^>]*>[\\s\\S]*?</(?:section|details)>`))?.[0] ||
        "",
    );
  const accessibility = read("accessibility"),
    privacy = read("privacy"),
    transparency = read("our-story"),
    editorial = read("editorial-policy");

  test(`${folder}: accessibility hero scopes location-free browsing to the reviewed catalog`, () => {
    const hero = plain(
      accessibility.match(/<p class="legal-hero__lede">[\s\S]*?<\/p>/)?.[0] ||
        "",
    );
    assert.match(hero, /reviewed (?:directory|catalog)/i);
    assert.doesNotMatch(hero, /every listing/i);
  });
  test(`${folder}: text-directory alternative distinguishes optional live USDA results`, () => {
    const note = plain(
      accessibility.match(/<div class="policy-note">[\s\S]*?<\/div>/)?.[0] ||
        "",
    );
    assert.match(note, /reviewed (?:catalog|directory)/i);
    assert.match(note, /USDA/);
    assert.match(note, /not included in (?:the )?static directory/i);
  });
  test(`${folder}: accessibility test description matches available Chromium emulation evidence`, () => {
    const copy = section(accessibility, "testing");
    assert.match(copy, /Chromium mobile emulation/i);
    assert.doesNotMatch(copy, /iPhone touch gestures/i);
  });
  test(`${folder}: transparency accessibility summary scopes every-listing claim`, () => {
    const copy = section(transparency, "privacy");
    assert.match(copy, /every reviewed (?:catalog )?listing/i);
    assert.match(copy, /live USDA.*(?:finder|location search)/i);
    assert.doesNotMatch(copy, /includes every listing without/i);
  });
  test(`${folder}: download explanation explicitly identifies reviewed snapshot and live exclusions`, () => {
    const copy = section(transparency, "data");
    assert.match(copy, /reviewed (?:catalog|directory)/i);
    assert.match(copy, /live USDA.*not included/i);
  });
  test(`${folder}: privacy identifier summary distinguishes finder fragments and service-page paths`, () => {
    const copy = section(privacy, "not-collected");
    assert.match(copy, /Finder links for reviewed catalog listings.*#/i);
    assert.match(copy, /browsers do not send.*page request/i);
    assert.match(
      copy,
      /Opening a service-page link sends.*public path.*hosting provider/i,
    );
    assert.match(copy, /service (?:detail )?page.*\/service\//i);
  });
  test(`${folder}: privacy storage explanation uses the same two sharing routes`, () => {
    const copy = section(privacy, "storage");
    assert.match(copy, /Finder links for reviewed catalog listings.*#/i);
    assert.match(copy, /browsers do not send.*page request/i);
    assert.match(
      copy,
      /Opening a service-page link sends.*public path.*hosting provider/i,
    );
    assert.match(copy, /service (?:detail )?page.*\/service\//i);
    assert.match(copy, /live USDA results.*Google Maps link/i);
    assert.match(copy, /Older finder links.*resource.*after the page loads/i);
    assert.doesNotMatch(copy, /Shared service links use the part/i);
  });
  test(`${folder}: privacy retention acknowledges local page-history restoration`, () => {
    const copy = section(privacy, "retention");
    assert.match(copy, /search.*filter.*browser.*(?:page|session) history/i);
    assert.match(copy, /Back and Forward/i);
    assert.doesNotMatch(
      copy,
      /Search words and filters: are not intentionally retained/i,
    );
  });
  test(`${folder}: editorial explanation distinguishes dated source closure from current availability`, () => {
    const copy = section(editorial, "inclusion");
    assert.match(copy, /dated.*Closed.*Temporarily closed/i);
    assert.match(copy, /remain visible.*(?:warning|source name)/i);
    assert.match(copy, /current availability is unverified/i);
  });
}
