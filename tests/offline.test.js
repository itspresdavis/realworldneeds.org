import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("offline directory caches only public same-origin essentials", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /const CACHE_PREFIX = "rwn-offline-"/);
  assert.match(sw, /"\/directory"/);
  assert.match(sw, /"\/data\/search-index\.json"/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /new Request\(`\$\{url\.origin\}\$\{url\.pathname\}`\)/);
  assert.doesNotMatch(sw, /localStorage|sessionStorage|searchParams\.get\(|URLSearchParams/);
});

test("offline registration is non-blocking and clear-browser-data removes offline caches", async () => {
  const bootstrap = await read("src/bootstrap.js");
  const directory = await read("public/directory.js");
  assert.match(bootstrap, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(directory, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(bootstrap, /name\.startsWith\("rwn-offline-"\)/);
  assert.match(bootstrap, /CLEAR_RWN_OFFLINE/);
  assert.match(bootstrap, /\.catch\(\(\) => \{\}\)/);
});

test("production CSP permits only same-origin workers and service worker revalidates", async () => {
  const config = JSON.parse(await read("vercel.json"));
  const catchAll = config.headers.find((entry) => entry.source === "/(.*)");
  const worker = config.headers.find((entry) => entry.source === "/sw.js");
  assert.ok(catchAll, "catch-all security headers missing");
  assert.ok(worker, "service worker cache policy missing");
  const csp = catchAll.headers.find((header) => header.key === "Content-Security-Policy")?.value || "";
  assert.match(csp, /worker-src 'self'/);
  assert.doesNotMatch(csp, /worker-src \*/);
  const cacheControl = worker.headers.find((header) => header.key === "Cache-Control")?.value || "";
  assert.match(cacheControl, /no-cache/);
  assert.match(cacheControl, /no-store/);
});

test("built site publishes the offline worker", async () => {
  const sw = await read("dist/sw.js");
  assert.match(sw, /networkFirstNavigation/);
  assert.match(sw, /staleWhileRevalidate/);
});
