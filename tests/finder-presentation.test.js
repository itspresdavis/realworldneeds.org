import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("finder owns one map coordinate space and fixed-size controls", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  assert.match(css, /\.rwn-professional \.globe-canvas,\s*\.rwn-professional \.globe-pin-layer\s*\{[^}]*inset: 4rem 0 4\.5rem;[^}]*height: calc\(100% - 8\.5rem\);/);
  assert.match(css, /\.rwn-professional \.globe-controls\s*\{[^}]*top: auto;[^}]*transform: none;[^}]*grid-auto-rows: 44px;/);
  assert.match(css, /\.rwn-professional \.globe-readout\s*\{[^}]*display: block !important;[^}]*clip-path: inset\(50%\);/);
  assert.doesNotMatch(css, /A GLOBAL DIRECTORY OF PRACTICAL HELP/);
});

test("explanation sections reset inherited two-column layouts at every width", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  assert.match(css, /\.rwn-professional \.about-rwn,\s*\.rwn-professional \.source-band\s*\{[^}]*display: block;[^}]*min-width: 0;/);
  assert.match(css, /\.rwn-professional \.principle-grid \{ min-width: 0; max-width: none;/);
  const browser = await readFile("scripts/browser-institutional.mjs", "utf8");
  const contract = await readFile("scripts/qa-finder-presentation.mjs", "utf8");
  assert.match(browser, /await verifyFinderPresentation\(/);
  assert.match(contract, /\[320, 390, 500, 600, 760, 900, 901, 1024, 1180, 1440\]/);
  assert.match(contract, /Real WebGL is required/);
});

test("finder, directory, and service pages keep a shared forest-green hierarchy", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  const pages = await readFile("public/professional-pages.css", "utf8");
  const nav = await readFile("public/navigation-actions.css", "utf8");
  assert.match(css, /--rwn-green-dark: #24583e/);
  assert.match(pages, /--page-green-dark: #24583e/);
  assert.match(nav, /--rwn-action-green-dark:#24583e/);
  assert.match(css, /font-family: Georgia, "Times New Roman", serif/);
  assert.match(pages, /#service > \.legal-hero h1 \{\s*font-family: Georgia/);
});


test("preboot style does not override the initialized finder design", async () => {
  const html = await readFile("index.html", "utf8");
  const css = await readFile("src/clarity.css", "utf8");
  assert.doesNotMatch(html, /\.finder-intro(?: h1| p)?\s*\{/);
  assert.doesNotMatch(html, /\.quick-need\s*\{|\.location-status\s*\{|\.finder-safety\s*\{/);
  assert.match(html, /\.preboot-finder h1\s*\{/);
  assert.match(html, /\.globe-stage \{ contain: paint; \}/);
  assert.match(html, /prefers-reduced-transparency/);
  assert.match(css, /\.rwn-professional \.finder-intro \{[^}]*padding-left: 0; border-left: 0;/);
});

test("small directory and service metadata has readable text contrast", async () => {
  const pages = await readFile("public/professional-pages.css", "utf8");
  const finder = await readFile("src/clarity.css", "utf8");
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return linear.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  };
  const ratio = (foreground, background) => {
    const levels = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    return (levels[1] + .05) / (levels[0] + .05);
  };
  for (const selector of [".directory-record dt", ".service-next-steps a span", ".legal-toc a"]) {
    const rule = pages.slice(pages.indexOf(`${selector} {`)).split("}")[0];
    const color = rule.match(/color:\s*(#[a-f\d]{6})/i)?.[1];
    assert.ok(color, `${selector} exposes its foreground`);
    for (const background of ["#ffffff", "#f5f4ee"]) {
      assert.ok(ratio(color, background) >= 4.5, `${selector} against ${background} has normal-text contrast`);
    }
  }
  assert.match(pages, /\.directory-record dt \{[^}]*font-size:\.8125rem/);
  assert.match(pages, /#service \.service-next-steps a span \{ font-size: \.8125rem/);
  assert.match(finder, /\.resource-list-head \{ color: #586b60; font-size: \.8125rem/);
  assert.doesNotMatch(pages, /color:#(?:748389|6f7f84|77868b|697a80|6d7d82)/);
});

test("service Save states retain their own contrasting colors", async () => {
  const pages = await readFile("public/professional-pages.css", "utf8");
  const browser = await readFile("scripts/qa-finder-presentation.mjs", "utf8");
  assert.doesNotMatch(pages, /#service \.service-utility-actions button\s*\{[^}]*color:/);
  assert.match(pages, /#service \.service-utility-actions__buttons button \{ color: #24583e;/);
  assert.match(pages, /#service \[data-service-save\] \{ transition: none;/);
  assert.match(browser, /state\.contrast < 4\.5/);
  assert.match(browser, /service\.before\.pressed !== service\.restored\.pressed/);
});

test("map empty state stays readable and leaves room for the controls", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  assert.match(css, /\.rwn-professional \.globe-empty \{[^}]*width: min\(24rem, calc\(100% - 5\.5rem\)\);[^}]*background: #fff;[^}]*color: var\(--rwn-ink-strong\);/);
  assert.match(css, /\.rwn-professional \.globe-empty p \{ color: var\(--rwn-muted\); font-size: \.8125rem;/);
});

test("provider visiting warnings precede optional listing tools", async () => {
  const source = await readFile("public/service-actions.js", "utf8");
  const placement = source.match(/const providerNote = nextSteps\.nextElementSibling;[\s\S]*?utilityAnchor\.insertAdjacentElement\("afterend", utility\);/)?.[0];
  assert.ok(placement);
  for (const kind of [".policy-note", "article", null]) {
    const calls = [];
    const note = kind && { matches: (selector) => selector === kind, insertAdjacentElement: (...args) => calls.push(["note", ...args]) };
    const nextSteps = { nextElementSibling: note, insertAdjacentElement: (...args) => calls.push(["actions", ...args]) };
    const utility = {};
    new Function("nextSteps", "utility", placement)(nextSteps, utility);
    assert.deepEqual(calls, [[kind === ".policy-note" ? "note" : "actions", "afterend", utility]]);
  }
});

test("mobile filter chips do not turn a lone reset into a full-width primary action", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  assert.match(css, /\.quick-need--all\[aria-pressed="true"\] \{[^}]*background: var\(--rwn-green-soft\);/);
  assert.match(css, /\.rwn-professional \.quick-need \{[^}]*min-width: 44px;[^}]*flex: 0 1 auto;/);
});

test("handoff subtitles and medium-width action rows share the readable layout", async () => {
  const nav = await readFile("public/navigation-actions.css", "utf8");
  const pages = await readFile("public/professional-pages.css", "utf8");
  const finder = await readFile("src/clarity.css", "utf8");
  assert.match(nav, /\.service-next-steps a\.is-primary span\{color:#586b60!important\}/);
  assert.doesNotMatch(nav, /color:#(?:6f7f84|697a80|728188)/);
  assert.match(pages, /@media \(max-width:1024px\) \{\s*\.service-next-steps \{ grid-template-columns:1fr; \}/);
  assert.match(finder, /\.results-empty__reset\)\{min-height:44px/);
});


test("compact navigation keeps full focus text and editorial heading weight", async () => {
  const source = await readFile("src/app.js", "utf8");
  const pages = await readFile("public/professional-pages.css", "utf8");
  const nav = await readFile("public/navigation-actions.css", "utf8");
  assert.match(source, /<option value="focus" hidden>This area<\/option>/);
  assert.match(pages, /\[aria-label="Breadcrumb"\] span \{ flex:0 0 auto;/);
  assert.match(nav, /#directory>\.legal-hero h1\{[^}]*font-weight:400;/);
});
