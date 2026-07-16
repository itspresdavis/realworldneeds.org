import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const allowedExtensions = new Set([".liquid", ".json", ".js", ".css", ".md", ".yml"]);
const secretPatterns = [
  /ghp_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk_live_[A-Za-z0-9]{20,}/,
  /sk_test_[A-Za-z0-9]{20,}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /password\s*=\s*["'][^"']{8,}["']/i,
  /api[_-]?key\s*=\s*["'][^"']{12,}["']/i
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

const failures = [];
for (const file of await walk(root)) {
  const text = await readFile(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) failures.push(path.relative(root, file));
  }
}

if (failures.length) {
  console.error("Potential secrets found:");
  console.error([...new Set(failures)].join("\n"));
  process.exit(1);
}

console.log("Secret scan passed.");
