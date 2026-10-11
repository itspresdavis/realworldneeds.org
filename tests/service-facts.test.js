import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { resources } from "../src/data/resources.js";
import { phoneMarkup } from "../src/utils/phone.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

const read = (path) => readFile(path, "utf8");
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

test("collapsed directory metadata does not hide service facts or source links", async () => {
  const css = await read("public/directory-enhancements.css");
  const hidden = css.match(/([^{}]+)\{display:none !important\}/g) || [];
  const rule = hidden.find((rule) => rule.includes(".directory-record>dl"));
  assert.ok(rule, "keep the compact directory metadata rule");
  for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) {
    assert.match(selector, /^#directory\s/, "a directory-only rule must not hide the destination page");
  }
});

test("every service page exposes exact snapshot facts, missing details, and dated warnings in semantic markup", async () => {
  for (const resource of resources) {
    const html = await read(`dist/service/${resource.id}/index.html`);
    const facts = html.match(/<dl class="service-facts">([\s\S]*?)<\/dl>/)?.[1];
    assert.ok(facts, `${resource.id}: explicit service facts`);
    for (const [label, value] of [[resource.kind === "direct" ? "Address" : "Coverage", resource.address], ["Access", resource.accessType], ["Hours", resource.hours], ["Eligibility", resource.eligibility]]) {
      if (value) assert.ok(facts.includes(`<dt>${label}</dt><dd>${escape(value)}</dd>`), `${resource.id}: ${label} exact source text`);
    }
    assert.ok(facts.includes(escape(resource.costNote)), `${resource.id}: cost note`);
    assert.ok(facts.includes(resource.phone ? phoneMarkup(resource.phone) : "Not listed in this snapshot. Check the official source for contact details."), `${resource.id}: phone or explicit absence`);
    if (!resource.hours && resource.kind === "direct") assert.ok(facts.includes("Not listed in this snapshot. Confirm current hours with the provider before travel."), resource.id);
    if (!resource.hours && resource.kind !== "direct") assert.ok(!facts.includes("<dt>Hours</dt>"), "coverage records must not imply visit hours");
    if (!resource.eligibility) assert.ok(!facts.includes("<dt>Eligibility</dt>"), "do not invent eligibility");
    const notice = sourceClosureNotice(resource);
    if (notice) {
      assert.ok(html.indexOf('class="source-status-notice"') < html.indexOf('class="service-next-steps"'), `${resource.id}: warning before contact actions`);
      assert.ok(html.includes(escape(notice.detail)), `${resource.id}: snapshot date and uncertainty retained`);
    }
  }
});

test("service clipboard fallback restores focus and cleans up on success, denial, and exception", async () => {
  const source = await read("public/service-actions.js");
  const functionText = source.slice(source.indexOf("  const fallbackCopy ="), source.indexOf("  const copyText ="));
  for (const outcome of [true, false, "throw"]) {
    for (const newerFocus of [false, true]) {
      let removed = false;
      const button = { isConnected: true, focus() { document.activeElement = this; } };
      const other = {};
      const area = { style: {}, setAttribute() {}, select() { document.activeElement = this; }, remove() { removed = true; if (document.activeElement === this) document.activeElement = document.body; } };
      const document = { activeElement: button, body: { append() {} }, createElement: () => area, execCommand() {
        if (newerFocus) document.activeElement = other;
        if (outcome === "throw") throw new Error("denied");
        return outcome;
      } };
      const context = vm.createContext({ document });
      vm.runInContext(`${functionText}\nglobalThis.copy = fallbackCopy;`, context);
      if (outcome === true) context.copy("Public details");
      else assert.throws(() => context.copy("Public details"));
      assert.equal(removed, true, "temporary textarea is always removed");
      assert.equal(document.activeElement, newerFocus ? other : button, "restore only the focus this action owns");
    }
  }
});

test("empty action feedback remains an established live region", async () => {
  const css = await read("public/service-actions.css");
  const emptyRule = css.match(/\.service-utility-actions__status:empty\s*\{([^}]+)\}/)?.[1] || "";
  assert.doesNotMatch(emptyRule, /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(await read("public/service-actions.js"), /data-service-action-status role="status" aria-live="polite"/);
});

test("sharing from listing tools always links to the warning-first service page", async () => {
  const source = await read("public/service-actions.js");
  assert.match(source, /const listingUrl = new URL\(location\.pathname, location\.origin\)\.href/);
  assert.match(source, /RWN listing: \$\{listingUrl\}/);
  assert.match(source, /url: listingUrl/);
  assert.match(source, /await copyText\(listingUrl\)/);
  assert.doesNotMatch(source, /location\.href/);
});
