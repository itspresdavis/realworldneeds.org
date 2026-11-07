// Explicit maintenance command. Production builds never fetch a mutable source.
// node scripts/build-postal-areas.mjs /private/path/2025_Gaz_zcta_national.txt /tmp/postal-candidate.js
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resources } from "../src/data/resources.js";
const [input, output] = process.argv.slice(2);
if (!input || !output || !output.endsWith(".js"))
  throw Error(
    "Provide a downloaded official Gazetteer text file and a separate candidate .js path.",
  );
const bytes = await readFile(input),
  lines = bytes.toString("utf8").trim().split(/\r?\n/),
  header = lines.shift().split("|");
if (
  header.join("|") !==
    "GEOID|GEOIDFQ|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG" ||
  lines.length < 30000 ||
  lines.length > 40000
)
  throw Error(
    "Unexpected Gazetteer schema or scale; retain the prior snapshot.",
  );
const known = new Set(
    resources
      .filter((r) => r.country === "United States")
      .flatMap((r) => r.address.match(/\b[A-Z]{2}[,\s]+(\d{5})\b/)?.[1] || []),
  ),
  entries = [];
for (const line of lines) {
  const columns = line.split("|"),
    code = columns[0],
    lat = Number(columns[6]),
    lng = Number(columns[7]);
  if (
    !/^\d{5}$/.test(code) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw Error("Invalid Gazetteer row; no candidate written.");
  if (
    (code.slice(0, 3) >= "010" && code.slice(0, 3) <= "029") ||
    known.has(code)
  )
    entries.push([code, [lat, lng]]);
}
const areas = Object.fromEntries(
  entries.sort(([a], [b]) => a.localeCompare(b)),
);
if (
  entries.length !== Object.keys(areas).length ||
  !areas["02108"] ||
  Object.keys(areas).length < 600
)
  throw Error("Duplicate or incomplete postal areas; no candidate written.");
const preamble =
  "// US Census 2025 Gazetteer ZCTA internal reference points.\n// Approximate search areas only: never service coordinates or mailing-address validation.\n// Source/reuse and reproducible selection: docs/catalog-reviews/2026-11-07-postal-areas.json.\n";
await writeFile(
  output,
  `${preamble}export const postalAreas = ${JSON.stringify(areas)};\n`,
);
console.log(
  JSON.stringify({
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    areas: entries.length,
    candidate: output,
    publication: "review required",
  }),
);
