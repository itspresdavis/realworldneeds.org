import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resources } from "../src/data/resources.js";
import { resourceSearchScore as score, resourceSearchText } from "../src/utils/search.js";

const fixture = (extra = {}) => ({ name: "Community support", city: "London", country: "United Kingdom", category: "food", address: "1 Main Street", ...extra });
const indexed = (r) => ({ name: r.name, place: `${r.city}, ${r.country}`, country: r.country, kind: r.kind, category: r.category, categories: [r.category, ...(r.secondaryCategories || [])], search: resourceSearchText(r) });
const both = [r => r, indexed];
const ranked = (records, query) => records.map(r => [r.id, score(r, query), r.name]).filter(([, n]) => n >= 0).sort((a, b) => b[1] - a[1] || a[2].localeCompare(b[2])).map(([id, n]) => [id, n]);

test("completed specific needs cannot silently broaden into their whole health or hygiene category", () => {
  const health = fixture({ category: "health", services: ["General medical advice"] });
  const hygiene = fixture({ category: "hygiene", services: ["Toiletries distribution"] });
  const water = fixture({ category: "water", summary: "Healthy tap water", costNote: "Free healthy tap water" });
  for (const convert of both) {
    for (const query of ["dental", "dentist", "mental", "mental health"])
      assert.equal(score(convert(health), query), -1, query);
    for (const query of ["shower", "showers", "ducha", "douches", "laundry", "lavanderia"])
      assert.equal(score(convert(hygiene), query), -1, query);
    for (const query of ["health", "dental London", "mental health London", "salud London", "santé London"])
      assert.equal(score(convert(water), query), -1, query);
    assert.ok(score(convert(health), "health") >= 0);
    assert.ok(score(convert(hygiene), "hygiene") >= 0);
    assert.ok(score(convert(water), "heal") >= 0, "ordinary partial words retain prefix lookup");
  }
});

test("specific synonyms remain bidirectional and accent insensitive without implying other services", () => {
  for (const terms of [["dental", "dentist", "dentists", "dentistry"], ["shower", "showers", "ducha", "duchas", "douche", "douches"], ["laundry", "lavandería"]]) {
    for (const term of terms) for (const convert of both) {
      const r = convert(fixture({ services: [`Free ${term} support`] }));
      for (const query of terms) assert.ok(score(r, query) >= 0, `${term}: ${query}`);
      assert.equal(score(r, terms[0] === "dental" ? "showers" : "dental"), -1);
    }
  }
  for (const convert of both) {
    assert.ok(score(convert(fixture({ services: ["Mental health support"] })), "mental health") >= 0);
    assert.equal(score(convert(fixture({ summary: "Mentally stimulating activities" })), "mental"), -1);
  }
});

test("explicit summary or service evidence outranks incidental organization and street words", () => {
  for (const [term, service] of [["dental", "Dentist appointments"], ["mental", "Mental health support"], ["showers", "Hot showers"], ["laundry", "Free laundry"]]) {
    const direct = fixture({ name: "Z Community support", summary: service });
    const incidental = fixture({ name: `A ${term} Foundation`, address: `1 ${term} Road`, category: ["dental", "mental"].includes(term) ? "health" : "hygiene" });
    for (const convert of both) {
      assert.ok(score(convert(incidental), `${term} Road`) >= 0, "literal address remains searchable");
      assert.ok(score(convert(incidental), `A ${term} Foundation`) >= 0, "literal name remains searchable");
      assert.ok(score(convert(direct), `${term} London`) > score(convert(incidental), `${term} London`), term);
    }
  }
});

test("negative-context mentions are not promoted as positive service evidence", () => {
  for (const [term, text] of [["showers", "No showers available"], ["dental", "Does not provide dental care"]]) {
    for (const convert of both) {
      const positive = convert(fixture({ summary: `Free ${term}` }));
      const negative = convert(fixture({ summary: text }));
      assert.ok(score(positive, term) > score(negative, term), term);
    }
  }
});

test("ordinary prefixes, broad translated categories, and literal words keep their meaning", () => {
  for (const convert of both) {
    const r = convert(fixture({ services: ["Dental care, mental health support, showers and laundry"] }));
    for (const query of ["dent", "ment", "show", "laund", "hea"]) assert.ok(score(r, query) >= 0, query);
    for (const query of ["health", "healthcare", "salud", "santé", "saúde", "medical"])
      assert.ok(score(convert(fixture({ category: "health" })), query) >= 0, query);
    for (const query of ["hygiene", "hygene", "banho", "toiletries"])
      assert.ok(score(convert(fixture({ category: "hygiene" })), query) >= 0, query);
    assert.ok(score(convert(fixture({ name: "Healthy Living Centre" })), "Healthy Living") >= 0);
    assert.ok(score(convert(fixture({ address: "1 Old Laundry Road" })), "Old Laundry Road") >= 0);
    assert.equal(score(r, "dental 東京"), -1, "an unsupported script must not be discarded");
    assert.ok(score(convert(fixture({ summary: "No-cost showers" })), "showers") > score(convert(fixture({ sourceName: "Showers Foundation" })), "showers"));
  }
});

test("published specific-need regressions retain only evidenced matches on both surfaces", () => {
  const byId = new Map(resources.map(r => [r.id, r]));
  for (const convert of both) {
    for (const query of ["health London", "dental London", "mental health London"])
      assert.equal(score(convert(byId.get("london-drinking-fountains")), query), -1, query);
    for (const query of ["showers London", "laundry London"])
      assert.equal(score(convert(byId.get("felix-project-multibank")), query), -1, query);
    assert.ok(score(convert(byId.get("capuchin-day-centre")), "dental Dublin") >= 0);
    assert.ok(score(convert(byId.get("capuchin-day-centre")), "dentist Dublin") >= 0);
    assert.ok(score(convert(byId.get("passage-resource-centre")), "showers London") >= 0);
    assert.ok(score(convert(byId.get("whitechapel-mission")), "showers London") >= 0);
    assert.ok(score(convert(byId.get("passage-resource-centre")), "laundry London") >= 0);
    assert.ok(score(convert(byId.get("soliguide-france")), "showers") >= 0, "locator descriptions stay discoverable");
  }
  const showerIds = ranked(resources, "showers London").map(([id]) => id).sort();
  assert.deepEqual(showerIds, ["passage-resource-centre", "whitechapel-mission"]);
  assert.deepEqual(ranked(resources, "laundry London").map(([id]) => id), ["passage-resource-centre"]);
});

test("built directory, finder, and legacy compact indexes preserve exact specific matching", async () => {
  const index = JSON.parse(await readFile("dist/data/search-index.json", "utf8"));
  for (const query of ["dental", "dentist", "mental", "mental health", "showers", "duchas", "laundry", "lavandería", "health", "hygiene", "health London", "dental London", "dental Dublin", "dentists Dublin", "showers London", "laundry London"])
    assert.deepEqual(ranked(index.records, query), ranked(resources, query), query);
  for (const r of [fixture({ category: "health" }), fixture({ category: "hygiene" })]) {
    const legacy = { ...indexed(r), search: resourceSearchText(r).split("\n").slice(0, 3).join("\n") };
    for (const query of ["dental", "mental", "showers", "laundry"]) assert.equal(score(legacy, query), -1, query);
  }
  const r = fixture({ services: ["Dental appointments and showers"] });
  const legacy = { ...indexed(r), search: resourceSearchText(r).split("\n").slice(0, 3).join("\n") };
  for (const query of ["dentist", "shower", "duchas"]) assert.ok(score(legacy, query) >= 0, query);
});
