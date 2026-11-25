import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseSuggestionArea, matchDirectorySuggestions } from "../public/directory-suggestions.js";
import { normalizeRememberedTopics } from "../src/utils/privacy.js";

const record = (id, overrides = {}) => ({
  id, name: id, kind: "direct", country: "United States", place: "Taunton, United States",
  categories: ["food"], search: "1 taunton green taunton ma 02780\nfood 02781",
  ...overrides,
});
const rows = [
  record("taunton-food"),
  record("taunton-food-and-water", { categories: ["food", "water", "water"] }),
  record("taunton-uk", { country: "United Kingdom", place: "Taunton, United Kingdom" }),
  record("office-not-service-area", { kind: "locator" }),
  record("contact-only", { locationPrecision: "contact-only" }),
  record("reported-closure", { sourceStatus: { title: "Source reported: Closed" } }),
  record("referral", { kind: "locator", country: "Global", place: "Global", categories: ["food", "referral"] }),
  record("opaque-id/extra", { categories: ["food", "water"] }),
];

test("location accepts only coarse city/country or a five-digit U.S. ZIP", () => {
  assert.deepEqual(parseSuggestionArea("02780"), { zip: "02780" });
  assert.deepEqual(parseSuggestionArea("  Taunton, United States "), { city: "taunton", country: "united states" });
  assert.deepEqual(parseSuggestionArea("São Paulo"), { city: "são paulo", country: undefined });
  assert.deepEqual(parseSuggestionArea(""), {});
  assert.equal(parseSuggestionArea("12 Main St"), null);
  assert.equal(parseSuggestionArea("a@b.example"), null);
  assert.equal(parseSuggestionArea("02780-0345"), null);
  assert.equal(parseSuggestionArea("Taunton,"), null);
});

test("exact local category matches rank without inferring proximity, coverage or eligibility", () => {
  const matching = (area) => matchDirectorySuggestions(rows, ["food", "water"], parseSuggestionArea(area))
    .map(({ record, reasons }) => [record.id, reasons]);
  assert.deepEqual(matching("Taunton, United States"), [
    ["taunton-food-and-water", ["Food", "Water"]], ["taunton-food", ["Food"]],
  ]);
  assert.deepEqual(matching("02780"), matching("Taunton, United States"));
  assert.deepEqual(matching("02781"), []);
  assert.deepEqual(matching("Taun"), []);
  assert.ok(matching("Taunton").some(([id]) => id === "taunton-uk"));
});

test("no location offers only matching global finders or networks", () => {
  assert.deepEqual(matchDirectorySuggestions(rows, ["food"]).map(({ record }) => record.id), ["referral"]);
  assert.deepEqual(matchDirectorySuggestions(rows, ["constructor", "toString", "unknown"]), []);
  assert.deepEqual(matchDirectorySuggestions(rows, ["water"]), []);
});

test("remembered choices are stripped to the explicit broad-topic allowlist", () => {
  assert.deepEqual(normalizeRememberedTopics(["health", "shelter", "02780", "food", "food", "referral", "clothing"]), ["food", "clothing"]);
  assert.deepEqual(normalizeRememberedTopics({ topics: ["food"], city: "Taunton" }), []);
});

test("built directory alone has the progressive form and a hashed module that makes no form submission", async () => {
  const directory = await readFile("dist/directory/index.html", "utf8");
  const scoped = await readFile("dist/directory/united-states/index.html", "utf8");
  assert.match(directory, /data-directory-suggestions hidden/);
  assert.ok(directory.indexOf("data-directory-query") < directory.indexOf("data-directory-suggestions"), "primary search stays first");
  assert.doesNotMatch(directory, /<details[^>]*data-directory-suggestions[^>]*\bopen\b/);
  assert.doesNotMatch(scoped, /data-directory-suggestions/);
  const [, path] = directory.match(/src="(\/directory-suggestions\.[a-f0-9]{12}\.js)\?v=[a-f0-9]{12}"/);
  const bundle = await readFile(`dist${path}`, "utf8");
  assert.doesNotMatch(bundle, /from ["']/);
  assert.match(bundle, /\/data\/search-index\.json/);
  assert.doesNotMatch(directory.match(/aria-label="Resource suggestions">[\s\S]*?<\/form>/)[0], /\bname=/);
});
