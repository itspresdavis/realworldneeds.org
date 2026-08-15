import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "dist";
const LIMITS = {
  files: 3200,
  htmlPages: 2900,
  largestFileBytes: 5_500_000,
  searchIndexBytes: 1_500_000,
  resourcesBytes: 5_000_000
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(ROOT);
const sizes = await Promise.all(files.map(async (path) => ({ path, bytes: (await stat(path)).size })));
const largest = sizes.reduce((current, entry) => entry.bytes > current.bytes ? entry : current, { path: "", bytes: 0 });
const htmlPages = sizes.filter(({ path }) => path.endsWith(".html")).length;
const byPath = new Map(sizes.map((entry) => [entry.path, entry.bytes]));
const checks = [
  ["file count", files.length, LIMITS.files],
  ["HTML page count", htmlPages, LIMITS.htmlPages],
  ["largest static file", largest.bytes, LIMITS.largestFileBytes],
  ["search index", byPath.get("dist/data/search-index.json") || 0, LIMITS.searchIndexBytes],
  ["resource corpus", byPath.get("dist/data/resources.json") || 0, LIMITS.resourcesBytes]
];

for (const [label, value, limit] of checks) {
  if (value > limit) throw new Error(`Static scale budget exceeded for ${label}: ${value} > ${limit}`);
}

console.log(`Static scale budgets passed: ${files.length} files, ${htmlPages} HTML pages, largest ${largest.path} (${largest.bytes} bytes).`);
