import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { categories } from "../src/data/resources.js";

const execute = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const contactFixtureLabel = "SYNTHETIC LOCAL QA — not real services. Do not contact these examples.";
const base = {
  country: "United States", region: "North America", category: "food", secondaryCategories: [],
  summary: "Synthetic local QA example. This does not describe a real service or source review.",
  kind: "locator", locationPrecision: "contact-only", lat: null, lng: null,
  address: "Synthetic Massachusetts coverage example; no walk-in address.",
  coverageNote: "Synthetic coverage: Massachusetts residents only; availability is not verified.",
  eligibility: "Synthetic eligibility: adults seeking food referrals in Massachusetts.",
  accessType: "Contact-only synthetic example", costModel: "free-navigation",
  costNote: "Synthetic free referral example; no real service is offered.",
  availabilityNote: "Synthetic example only. Do not call or submit information.",
  sourceName: "Synthetic QA source (not a real provider)", sourceKind: "Local test fixture",
  sourceUrl: "https://rwn-qa.example.invalid/synthetic-source",
  sourceDetail: "Entirely fictional data used only to test rendering. No source was reviewed.",
  services: ["Synthetic food referral example"], lastChecked: "2026-10-10"
};

// Never import these records into a catalog, public route, migration, or deployment.
// Reserved example domains and fictional NANP numbers are inspected, never opened.
export const contactFixtureResources = [
  { ...base, id: "qa-contact-phone", name: "Synthetic QA phone-only shortcode", phone: "211", phoneAccess: "Synthetic dialing scope: 211 is domestic-only; do not call this fixture." },
  { ...base, id: "qa-contact-web", name: "Synthetic QA online-only long URL", kind: "network", city: "Boston", accessUrl: `https://rwn-qa.example.invalid/${"longcontactpath".repeat(20)}?area=ma&service=food` },
  { ...base, id: "qa-contact-mixed", name: "Synthetic QA phone and online closed example", city: "Boston", phone: "+1 (617) 555-0123", phoneAccess: "Synthetic dialing scope: United States callers only; do not call this fixture.", accessUrl: "https://rwn-qa.example.invalid/contact", collectionStatus: "Temporarily closed", collectionStatusCheckedOn: "2026-10-10" },
  ...[1, 2, 3].map(number => ({
    ...base, id: `qa-physical-${number}`, name: `Synthetic QA physical location ${number}`,
    kind: "direct", locationPrecision: "exact", city: "Boston", lat: 42.36 + number / 100, lng: -71.05,
    address: `${number} Fictional Example Street, Boston, MA 02101`,
    coverageNote: undefined, costModel: "free", phone: "+1 (617) 555-0199",
    hours: "Synthetic hours: Monday 09:00–10:00", accessType: "Synthetic walk-in example"
  }))
];

const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
};

async function labelHtml(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await labelHtml(path);
    else if (entry.name.endsWith(".html")) {
      const html = await readFile(path, "utf8");
      await writeFile(path, html
        .replace(/<title>/i, "<title>[SYNTHETIC LOCAL QA] ")
        .replace(/<meta\s+name="robots"[^>]*>/gi, "")
        .replace("</head>", '<meta name="robots" content="noindex, nofollow, noarchive" /></head>')
        .replace(/<body([^>]*)>/i, `<body$1><aside data-qa-fixture-banner style="padding:10px 16px;background:#fff1b8;color:#241a00;font:600 14px/1.4 system-ui;overflow-wrap:anywhere">${contactFixtureLabel}</aside>`));
    }
  }
}

// This server deliberately has no imports from api/ or server/ and accepts only
// static GET/HEAD requests. It cannot read source files outside its temporary dist.
async function staticServer(root, catalogControl, navigationControl) {
  const inside = path => path === root || path.startsWith(`${root}${sep}`);
  const server = createServer(async (request, response) => {
    const end = (status, text) => { response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); response.end(request.method === "HEAD" ? undefined : text); };
    try {
      if (!["GET", "HEAD"].includes(request.method)) return end(405, "Static fixture only");
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").includes("..")) return end(400, "Bad path");
      if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/workspace") return end(404, "No API in this fixture");
      if (navigationControl?.paths?.includes(pathname)) {
        const mode = navigationControl.mode || "healthy";
        const record = { path: pathname, mode, fetchMode: request.headers["sec-fetch-mode"] || null, cacheControl: request.headers["cache-control"] || null, method: request.method, hasQuery: Boolean(new URL(request.url, "http://127.0.0.1").search), probe: request.headers["x-rwn-connectivity-probe"] === "1", closed: false };
        navigationControl.requests.push(record);
        response.once("close", () => { record.closed = true; });
        if (["503", "504", "404", "410"].includes(mode)) return end(Number(mode), `Synthetic navigation ${mode}`);
        if (["hung-headers", "hung-body"].includes(mode)) {
          if (mode === "hung-body") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            response.write("<!doctype html><html><head>");
          }
          return;
        }
      }
      if (pathname === "/data/search-index.json" && catalogControl) {
        const mode = catalogControl.mode || "healthy";
        const record = { mode, closed: false };
        catalogControl.requests.push(record);
        response.once("close", () => { record.closed = true; });
        if (["hung-headers", "hung-body", "held-success"].includes(mode)) {
          if (mode === "hung-body") {
            response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            response.write('{"records":[');
          }
          if (mode === "held-success") catalogControl.release = async () => {
            if (response.destroyed) throw new Error("Held catalog response was unexpectedly canceled");
            const body = await readFile(join(root, "data/search-index.json"));
            response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            response.end(body);
          };
          return;
        }
      }
      const relative = pathname.replace(/^\/+/, "");
      const paths = !relative ? [join(root, "index.html")] : extname(relative)
        ? [resolve(root, relative)] : [resolve(root, `${relative}.html`), resolve(root, relative, "index.html")];
      for (const path of paths) {
        if (!inside(path)) return end(400, "Bad path");
        let actual, info;
        try { actual = await realpath(path); info = await stat(actual); } catch { continue; }
        if (!inside(actual)) return end(400, "Bad path");
        if (!info.isFile()) continue;
        response.writeHead(200, {
          "Content-Type": contentTypes[extname(actual)] || "application/octet-stream", "Content-Length": info.size,
          "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive",
          "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
        });
        if (request.method === "HEAD") response.end();
        else createReadStream(actual).on("error", () => response.destroy()).pipe(response);
        return;
      }
      end(404, "Synthetic fixture file not found");
    } catch { end(400, "Bad request"); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

/** Full normal build in an automatically cleaned, isolated local/CI workspace. */
export async function createContactFixtureApp({ serve = true, sourceDir = sourceRoot, catalogControl, navigationControl } = {}) {
  sourceDir = resolve(sourceDir);
  // macOS /tmp and configured temporary parents may be symlinks. Keep the
  // serving root canonical so containment checks compare like-for-like paths.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "rwn-contact-fixture-")));
  const dist = join(directory, "dist");
  let server, cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    try {
      if (server?.listening) await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      cleaned = true;
    }
  };
  try {
    await Promise.all(["src", "public", "scripts", "index.html", "package.json"].map(path => cp(join(sourceDir, path), join(directory, path), { recursive: true })));
    await symlink(join(sourceDir, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(join(directory, "src/data/resources.js"), [
      `export const categories = ${JSON.stringify(categories)};`,
      "export const resourceTypes = Object.keys(categories);",
      `export const resources = ${JSON.stringify(contactFixtureResources)};`,
      `export const trustPrinciples = [{title:"Synthetic local QA only",text:${JSON.stringify(contactFixtureLabel)}}];`
    ].join("\n"));
    // Local examples must neither claim actual publisher audits nor fetch live feeds.
    await writeFile(join(directory, "src/data/live-sources.js"), "export const sourceRegistry = [];\nexport async function fetchNearbyUsdaSites() { return []; }\nexport async function fetchUsdaActiveCount() { return null; }\n");
    const { scripts } = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const commands = ["node scripts/validate-data.mjs", ...scripts.build.split(" && ")];
    for (const command of commands) {
      if (!/^node scripts\/[a-z0-9-]+\.mjs$/.test(command)) throw new Error(`Unexpected fixture build command: ${command}`);
      await execute(process.execPath, [command.slice(5)], { cwd: directory, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH } });
    }
    await labelHtml(dist);
    await writeFile(join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
    if (serve) server = await staticServer(dist, catalogControl, navigationControl);
    return { directory, dist, host: server ? `http://127.0.0.1:${server.address().port}` : null, resources: contactFixtureResources, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
