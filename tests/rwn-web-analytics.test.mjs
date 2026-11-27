import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/rwn-web-analytics.js", import.meta.url), "utf8");
function boot(href, { navigator = {}, doNotTrack, referrer = "" } = {}) {
  const location = new URL(href);
  const scriptTags = [];
  const window = { doNotTrack };
  const document = {
    referrer, createElement: () => ({}),
    head: { appendChild: (script) => scriptTags.push(script) },
  };
  const context = { URL, location, navigator, window, document };
  runInNewContext(source, context);
  return { context, scriptTags, filter: window.vaq?.[0]?.[1] };
}
test("only clean production landing pages load the verified same-origin script", () => {
  for (const url of ["https://www.realworldneeds.org/", "https://realworldneeds.org/directory"]) {
    const { scriptTags, filter } = boot(url);
    assert.equal(scriptTags.length, 1);
    assert.equal(scriptTags[0].src, "/_vercel/insights/script.js");
    assert.equal(scriptTags[0].referrerPolicy, "no-referrer");
    assert.equal(filter({ type: "pageview", url }).url, url);
  }
});
test("does not load for previews, sensitive routes, URLs or privacy signals", () => {
  for (const [url, options] of [
    ["https://rwn-preview.vercel.app/"],
    ["https://www.realworldneeds.org/account"],
    ["https://www.realworldneeds.org/resources/example"],
    ["https://www.realworldneeds.org/directory?q=private"],
    ["https://www.realworldneeds.org/#private"],
    ["https://www.realworldneeds.org/", { navigator: { globalPrivacyControl: true } }],
    ["https://www.realworldneeds.org/", { doNotTrack: "1" }],
    ["https://www.realworldneeds.org/", { navigator: { doNotTrack: "1" } }],
    ["https://www.realworldneeds.org/", { referrer: "https://example.org/private" }],
  ]) assert.equal(boot(url, options).scriptTags.length, 0, url);
});
test("queued hook drops unexpected routes and custom events and prevents duplicate loads", () => {
  const { context, filter, scriptTags } = boot("https://www.realworldneeds.org/");
  for (const event of [
    { type: "event", url: "/" },
    { type: "pageview", url: "/account" },
    { type: "pageview", url: "/directory?search=private" },
    { type: "pageview", url: "https://realworldneeds.org/" },
  ]) assert.equal(filter(event), null);
  context.location = new URL("https://www.realworldneeds.org/#private");
  assert.equal(filter({ type: "pageview", url: "/" }), null);
  runInNewContext(source, context);
  assert.equal(scriptTags.length, 1);
});
