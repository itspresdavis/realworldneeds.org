import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const allowedExtensions = new Set([".liquid", ".json", ".js", ".css", ".md"]);
const forbidden = [
  /href=["']#["']/i,
  /href=["']["']/i,
  /javascript:void\(0\)/i,
  /data-placeholder/i,
  /placeholder-url/i,
  /example\.com/i
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(root);
const failures = [];

for (const file of files) {
  const rel = path.relative(root, file);
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) failures.push(`${rel}: matched ${pattern}`);
  }
}

if (failures.length) {
  console.error("Link audit failed:");
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Link audit passed for ${files.length} files.`);
