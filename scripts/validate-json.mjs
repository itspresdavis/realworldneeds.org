import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files;
}

for (const file of await walk(root)) {
  JSON.parse(await readFile(file, "utf8"));
}

console.log("JSON validation passed.");
