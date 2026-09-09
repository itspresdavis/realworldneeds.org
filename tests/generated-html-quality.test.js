import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (extname(path) === ".html") files.push(path);
  }
  return files;
}

function captures(html, regex) {
  return [...html.matchAll(regex)].map((match) => match[1]);
}

test("every generated HTML document keeps a clean crawl/index structure", async () => {
  const files = await walk("dist");
  assert.ok(files.length > 2_000, `expected more than 2,000 generated HTML pages, found ${files.length}`);

  const canonicalOwners = new Map();
  const failures = [];

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const isNotFound = file.endsWith("/404.html") || file.endsWith("\\404.html") || file === "dist/404.html";
    const titles = captures(html, /<title>([\s\S]*?)<\/title>/gi);
    const canonicals = captures(html, /<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi);
    const h1s = captures(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi);
    const ids = captures(html, /\bid=["']([^"']+)["']/gi);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const descriptions = captures(html, /<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi);
    const jsonLd = captures(html, /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    const noindex = /name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);

    if (!/^<!doctype html>/i.test(html.trimStart())) failures.push(`${file}: missing HTML5 doctype`);
    if (!/<html\b[^>]*\blang=["']en["']/i.test(html)) failures.push(`${file}: missing lang=en`);
    if (!/<meta\b[^>]*\bname=["']viewport["']/i.test(html)) failures.push(`${file}: missing viewport meta`);
    if (titles.length !== 1 || !titles[0].trim()) failures.push(`${file}: expected exactly one non-empty title`);
    if (descriptions.length !== 1 || descriptions[0].trim().length < 40) failures.push(`${file}: expected one useful meta description`);
    if (h1s.length !== 1) failures.push(`${file}: expected exactly one H1, found ${h1s.length}`);
    if (duplicateIds.length) failures.push(`${file}: duplicate IDs ${duplicateIds.join(", ")}`);

    if (file === "dist/join.html") {
      if (!noindex) failures.push(`${file}: account entry must be noindex`);
      if (canonicals.length) failures.push(`${file}: account entry must not declare an indexable canonical`);
    } else if (isNotFound) {
      if (!noindex) failures.push(`${file}: 404 must be noindex`);
      if (canonicals.length) failures.push(`${file}: 404 should not declare an indexable canonical`);
    } else {
      if (canonicals.length !== 1 || !canonicals[0].startsWith("https://www.realworldneeds.org/")) failures.push(`${file}: invalid canonical`);
      if (noindex) failures.push(`${file}: unexpectedly noindexed`);
    }

    for (const block of jsonLd) {
      try {
        JSON.parse(block);
      } catch (error) {
        failures.push(`${file}: invalid JSON-LD (${error.message})`);
      }
    }

    const canonical = canonicals[0];
    if (canonical) {
      const prior = canonicalOwners.get(canonical);
      if (prior && prior !== file) failures.push(`${file}: canonical duplicates ${prior} (${canonical})`);
      else canonicalOwners.set(canonical, file);
    }

    if (failures.length >= 30) break;
  }

  assert.deepEqual(failures, [], `generated HTML quality failures:\n${failures.join("\n")}`);
});
