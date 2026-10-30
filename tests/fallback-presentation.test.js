import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile("src/clarity.css", "utf8");
const app = await readFile("src/app.js", "utf8");
const fallbackCss = css.match(/\.rwn-professional\.rwn-atlas \.globe-stage\.is-globe-unavailable\s*\{[\s\S]*?(?=\n@media|$)/)?.[0] || "";

test("unavailable maps use content height rather than the normal map viewport", () => {
  assert.match(fallbackCss, /\.globe-stage\.is-globe-unavailable\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*max-height:\s*none;/);
  assert.match(fallbackCss, /\.globe-stage\.is-globe-unavailable \.globe-fallback\s*\{[^}]*position:\s*static;[^}]*inset:\s*auto;/);
});

test("unavailable maps hide unusable controls but retain the live status announcement", () => {
  const hiddenChrome = fallbackCss.match(/\.globe-stage\.is-globe-unavailable :is\(([^)]+)\)\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/)?.[1];
  assert.ok(hiddenChrome, "unavailable map chrome has an explicit hidden rule");
  assert.deepEqual(hiddenChrome.split(",").map(selector => selector.trim()).sort(), [
    ".globe-meta", ".globe-touch-controls", ".atlas-key", ".globe-empty",
    ".globe-cluster-tray", ".globe-gesture-hint", "#globeHelp"
  ].sort(), "all unusable map chrome, including Explore/Done, is hidden without hiding the live readout");
  assert.match(css, /\.rwn-professional \.globe-readout\s*\{[^}]*display:\s*block !important;[^}]*clip-path:\s*inset\(50%\);/);
  assert.match(app, /id="globeReadout" aria-live="polite"/);
  assert.match(app, /class="globe-fallback__action" href="\/directory"/);
  assert.match(app, /class="jump-results" id="jumpResults" href="#results"/);
});

test("fallback presentation is scoped to failure and preserves retry recovery", () => {
  for (const rule of fallbackCss.matchAll(/([^{}]+)\{/g)) {
    assert.match(rule[1], /\.globe-stage\.is-globe-unavailable/);
  }
  assert.match(app, /classList\.remove\("is-globe-unavailable"\)/);
  assert.match(app, /retryButton\.hidden = !retry/);
  assert.match(fallbackCss, /:focus-visible\s*\{\s*outline:\s*3px solid #24583e;\s*outline-offset:\s*3px\s*;?\s*\}/);
});
