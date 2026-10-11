import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile("src/clarity.css", "utf8");
const app = await readFile("src/app.js", "utf8");
const fallbackCss = css.slice(css.indexOf("/* The text-first fallback"));

test("unavailable maps use content height rather than the normal map viewport", () => {
  assert.match(fallbackCss, /\.globe-stage\.is-globe-unavailable\s*\{[^}]*height: auto;[^}]*min-height: 0;[^}]*max-height: none;/);
  assert.match(fallbackCss, /\.globe-stage\.is-globe-unavailable \.globe-fallback\s*\{[^}]*position: static;[^}]*inset: auto;/);
});

test("unavailable maps hide unusable controls but retain the live status announcement", () => {
  assert.match(fallbackCss, /\.globe-stage\.is-globe-unavailable :is\(\.globe-meta, \.atlas-key, \.globe-empty, \.globe-cluster-tray, \.globe-gesture-hint, #globeHelp\)\s*\{\s*display: none !important;/);
  assert.match(fallbackCss, /\.globe-stage\.is-globe-unavailable \.globe-readout\s*\{[^}]*clip-path: inset\(50%\);/);
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
  assert.match(fallbackCss, /:focus-visible\s*\{\s*outline: 3px solid #24583e;\s*outline-offset: 3px;/);
});
