import { SEARCH_CATALOG_SCHEMA } from "../public/catalog-request.js";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { siteFooter } from "../src/utils/site-footer.js";

const footerSource = await readFile("src/utils/site-footer.js", "utf8");
const footerCss = await readFile("public/task-controls.css", "utf8");
const savedCss = await readFile("public/saved-services.css", "utf8");
const generator = await readFile("scripts/enhance-generated-pages.mjs", "utf8");

test("authored homepage Saved entry opens the private fragment without reading saved state", async () => {
  assert.match(siteFooter(), /<a href="\/directory#saved">Saved services<\/a>/);
  assert.doesNotMatch(footerSource, /data-section-link|localStorage|sessionStorage|readSavedResources|saved-services\.js|fetch\(|sendBeacon|XMLHttpRequest/);
  assert.match(await readFile("src/app.js", "utf8"), /siteFooter\(\{ clearBrowserData: true \}\)/);
});

test("Saved footer links keep a 44px text target and visible keyboard focus", () => {
  assert.match(footerCss, /\.rwn-site-footer a, \.rwn-site-footer button\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*44px;/);
  assert.match(footerCss, /\.rwn-site-footer :is\(a,button\):focus-visible\s*\{[^}]*outline: 2px solid #fff;[^}]*outline-offset: 3px;/);
  for (const rule of footerCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.rwn-site-footer a(?:\s|$|,)/.test(rule[1])) {
      assert.doesNotMatch(rule[2], /display\s*:\s*none|visibility\s*:\s*hidden/, "Saved text links remain available at all screen widths");
    }
  }
});

test("every directory scope gets honest, initially hidden guidance and scope-preserving Browse links", () => {
  const first = generator.indexOf("function directorySearchMarkup(scope)");
  const last = generator.indexOf("function localLinksMarkup(", first);
  assert.ok(first >= 0 && last > first);
  const record = { country: "United States", categoryLabels: ["Food"] };
  const scopes = ["/directory", "/directory/help/food", "/directory/united-states/new-york"];
  const context = vm.createContext({
    searchIndex: { schemaVersion: SEARCH_CATALOG_SCHEMA, records: [record], scopes: Object.fromEntries(scopes.map((scope) => [scope, [0]])) },
    escapeHtml: (value) => String(value),
  });
  vm.runInContext(generator.slice(first, last), context);
  for (const scope of scopes) {
    const markup = context.directorySearchMarkup(scope);
    const saved = markup.slice(0, markup.indexOf("</section>") + "</section>".length);
    assert.match(saved, /id="saved"[^>]*data-saved-services[^>]*aria-labelledby="saved-services-heading"/);
    assert.match(saved, /<h2 id="saved-services-heading" tabindex="-1">Saved services<\/h2>/);
    assert.match(saved, /data-saved-empty hidden/);
    assert.match(saved, /data-saved-summary role="status" aria-live="polite"/);
    assert.match(saved, /Only in this browser, on this device/);
    assert.match(saved, /Anyone using this browser can see your list/);
    assert.match(saved, /Saving does not reserve a service or confirm availability/);
    assert.match(saved, /Turn on JavaScript to view or change saved services/);
    assert.match(saved, /Find services to save/);
    assert.equal((saved.match(/href="#directory-results"/g) || []).length, 2, `${scope} keeps both browse actions in the current directory`);
    assert.doesNotMatch(saved, /href="\/directory|<h1\b|sign in|create an account|sync across|reserved for you/i);
    for (const svg of saved.matchAll(/<svg\b[^>]*>/g)) assert.match(svg[0], /aria-hidden="true"/);
  }
});

test("Saved hero treatment is scoped to its fragment and preserves the directory heading for assistive technology", () => {
  const heroRules = [...savedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) => rule[1].includes(".legal-hero"));
  const motionRule = heroRules.find((rule) => rule[1].trim().split("\n").at(-1) === "#directory>.legal-hero");
  assert.equal(motionRule?.[2], "transition:none!important", "return layout must be immediate, including under reduced motion");
  const rules = heroRules.filter((rule) => rule !== motionRule);
  assert.equal(rules.length, 1);
  assert.equal(rules[0][1].trim().split("\n").at(-1), "#directory:has(#saved:target)>.legal-hero");
  assert.match(rules[0][2], /position:absolute/);
  assert.match(rules[0][2], /clip-path:inset\(50%\)/);
  assert.doesNotMatch(rules[0][2], /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(savedCss, /\.saved-services:not\(:target\),\.saved-services \[hidden\]\{display:none!important\}/);
  assert.match(savedCss, /\.saved-services :is\(button,a\):focus-visible\{outline:3px solid/);
});

test("Saved cream guidance retains normal-text contrast and existing presentation byte budgets", async () => {
  const luminance = (hex) => hex.match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const foreground of ["153c30", "405a50", "24583e"]) {
    assert.ok(savedCss.includes(`#${foreground}`));
    const contrast = (luminance("f5f4ee") + 0.05) / (luminance(foreground) + 0.05);
    assert.ok(contrast >= 4.5, `${foreground} on cream has ${contrast.toFixed(2)}:1 contrast`);
  }
  assert.match(savedCss, /\.saved-services__empty\{[^}]*background:#f5f4ee/);
  for (const [path, maximum] of [["public/saved-services.css", 3_000], ["src/clarity.css", 38_000]]) {
    assert.ok((await stat(path)).size <= maximum, `${path} must retain its existing byte budget`);
  }
});
