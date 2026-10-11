import { readFile, writeFile } from "node:fs/promises";

// build.mjs hashes index.html and every src file, including generated catalogs,
// and applies that release to all source assets and relative module imports.
// Reuse it here: a second hand-maintained input list can omit runtime data and
// report a release that does not match the URLs actually shipped to browsers.
const releasePath = "dist/data/release.json";
const releaseInfo = JSON.parse(await readFile(releasePath, "utf8"));
if (!/^[a-f0-9]{12}$/.test(releaseInfo.release || "")) {
  throw new Error("Build source release is missing or invalid.");
}
releaseInfo.runtimeAssetRelease = releaseInfo.release;
await writeFile(releasePath, `${JSON.stringify(releaseInfo, null, 2)}\n`);
