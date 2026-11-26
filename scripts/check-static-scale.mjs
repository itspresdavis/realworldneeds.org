import { readdir, stat, readFile } from "node:fs/promises";
import { gzipSync } from 'node:zlib';
import { join } from "node:path";

const ROOT = "dist";
const LIMITS = {
  files: 10000,
  htmlPages: 9500,
  largestFileBytes: 16_000_000,
  searchIndexBytes: 5_500_000,
  resourcesBytes: 16_000_000,
  // Decoded limits protect memory; compressed limits bound transfer growth.
  // The full export is separate from the search payload and compact map index.
  searchGzipBytes: 650_000,
  resourcesGzipBytes: 1_000_000,
  generatedDataGzipBytes: 650_000
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
const searchGzipBytes = gzipSync(await readFile('dist/data/search-index.json')).length;
const resourcesGzipBytes = gzipSync(await readFile('dist/data/resources.json')).length;
// The interactive finder imports generated data modules. Count those bytes too,
// so compact export budgets cannot hide a growing browser module payload.
const generatedDataGzipBytes = (await Promise.all(sizes
  .filter(({path}) => /\/src\/data\/.*\.js$/.test(path))
  .map(async ({path}) => gzipSync(await readFile(path)).length))).reduce((sum, n) => sum + n, 0);
if (!generatedDataGzipBytes) throw new Error('Finder data modules were not measured.');
const checks = [
  ["file count", files.length, LIMITS.files],
  ["HTML page count", htmlPages, LIMITS.htmlPages],
  ["largest static file", largest.bytes, LIMITS.largestFileBytes],
  ["search index", byPath.get("dist/data/search-index.json") || 0, LIMITS.searchIndexBytes],
  ["resource corpus", byPath.get("dist/data/resources.json") || 0, LIMITS.resourcesBytes],
  ["compressed search index", searchGzipBytes, LIMITS.searchGzipBytes],
  ["compressed resource export", resourcesGzipBytes, LIMITS.resourcesGzipBytes],
  ["compressed finder data modules", generatedDataGzipBytes, LIMITS.generatedDataGzipBytes]
];

for (const [label, value, limit] of checks) {
  if (value > limit) throw new Error(`Static scale budget exceeded for ${label}: ${value} > ${limit}`);
}

console.log(`Static scale budgets passed: ${files.length} files, ${htmlPages} HTML pages, largest ${largest.path} (${largest.bytes} bytes).`);
console.log(`Gzip sizes: search ${searchGzipBytes}, export ${resourcesGzipBytes}, finder data ${generatedDataGzipBytes} bytes. Hosting transport compression must be verified separately.`);
