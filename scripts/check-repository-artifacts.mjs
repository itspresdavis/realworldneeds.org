import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Inspect the index, not the working tree: local builds and installed dependencies
// are expected to exist. --cached removals are therefore validated before commit.
const generatedRoots = new Set(["dist", "qa-screenshots", "playwright-report", "test-results", "qa-cross-browser"]);
export function findTrackedArtifacts(paths) {
  return paths.filter((path) => generatedRoots.has(path.split("/")[0]) || path.split("/").includes("node_modules"));
}

export function checkRepositoryArtifacts(cwd = process.cwd()) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean);
  const artifacts = findTrackedArtifacts(tracked);
  if (artifacts.length) {
    throw new Error(`Generated output or dependencies are tracked (${artifacts.length} files):\n${artifacts.slice(0, 20).join("\n")}\nRemove only these paths from the index with git rm --cached; preserve authored source and local files.`);
  }
  return tracked.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Repository artifact guard passed (${checkRepositoryArtifacts()} source-controlled files).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
