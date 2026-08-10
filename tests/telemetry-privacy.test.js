import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { routeClass } from "../src/telemetry.js";

test("telemetry route classes never expose service, city, or need identifiers", () => {
  const cases = new Map([
    ["/", "finder"],
    ["/service/bowery-mission", "service"],
    ["/service/private-looking-id", "service"],
    ["/directory", "directory"],
    ["/directory/page/4", "directory"],
    ["/directory/help/food", "need_directory"],
    ["/directory/region/north-america", "region_directory"],
    ["/directory/united-states", "country_directory"],
    ["/directory/local/united-states/boston", "local_directory"],
    ["/directory/local/united-states/ma/boston/help/food", "local_need_directory"],
    ["/privacy", "policy"],
    ["/something-else", "other"]
  ]);

  for (const [path, expected] of cases) assert.equal(routeClass(path), expected, path);
});

test("client telemetry does not persist sampling or send sensitive path/device characteristics", async () => {
  const client = await readFile("src/telemetry.js", "utf8");
  assert.doesNotMatch(client, /sessionStorage|localStorage/);
  assert.doesNotMatch(client, /path:\s*location\.pathname/);
  assert.doesNotMatch(client, /reducedMotion|navigator\.connection|effectiveType/);
  assert.doesNotMatch(client, /viewport:\s*`/);
  assert.match(client, /route:\s*routeClass\(location\.pathname\)/);
  assert.match(client, /viewportClass:\s*viewportClass\(\)/);
});

test("RUM endpoint accepts only coarse route and viewport classes", async () => {
  const server = await readFile("api/rum.js", "utf8");
  assert.match(server, /ALLOWED_ROUTES/);
  assert.match(server, /ALLOWED_VIEWPORTS/);
  assert.doesNotMatch(server, /payload\.path|payload\.viewport\b|payload\.reducedMotion|payload\.connection|requestId/);
  assert.match(server, /route,\n\s*viewportClass,/);
});

test("privacy notice explicitly describes minimized first-party diagnostics", async () => {
  const privacy = await readFile("public/privacy.html", "utf8");
  assert.match(privacy, /about 2% of page loads/);
  assert.match(privacy, /does <strong>not<\/strong> include your search words, exact page path, service identifier, city/);
  assert.match(privacy, /third-party analytics service/);
  assert.match(privacy, /RWN has not added a third-party analytics or advertising tool/);
  assert.match(privacy, /first-party endpoint on the same website/);
});