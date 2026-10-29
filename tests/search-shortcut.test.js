import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const accessibility = await readFile(new URL("../src/accessibility.js", import.meta.url), "utf8");
const directory = await readFile(new URL("../public/directory.js", import.meta.url), "utf8");

function fixture(kind) {
  class Input {}
  class Textarea {}
  let handler, focus = 0, selection = 0;
  const input = new Input();
  input.attributes = {};
  input.focus = () => { focus += 1; };
  input.select = () => { selection += 1; };
  input.setAttribute = (key, value) => { input.attributes[key] = value; };
  input.addEventListener = () => {};
  const document = { getElementById: () => input, querySelector: () => null,
    addEventListener: (type, callback) => { if (type === "keydown") handler = callback; } };
  const globals = { document, input, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    listen: (target, type, callback) => { if (target === document && type === "keydown") handler = callback; } };
  if (kind === "finder") {
    vm.runInNewContext(accessibility.replace("export function installAccessibility", "function installAccessibility")
      + "\ninstallSearchAccessibility();", globals);
  } else {
    const start = directory.indexOf('listen(document,"keydown",event=>{');
    const end = directory.indexOf('const connectivityChanged=', start);
    assert.ok(start >= 0 && end > start);
    vm.runInNewContext(directory.slice(start, end), globals);
  }
  return { handler, input, Textarea, focus: () => focus, selection: () => selection };
}

for (const kind of ["finder", "directory"]) {
  test(`${kind}: unmodified slash never steals focus; Alt+/ activates search`, () => {
    const f = fixture(kind);
    const event = { key: "/", code: "Slash", target: {}, preventDefault() { this.defaultPrevented = true; } };
    f.handler(event);
    assert.equal(f.focus(), 0);
    assert.equal(event.defaultPrevented, undefined);
    f.handler({ ...event, altKey: true });
    assert.equal(f.focus(), 1);
    if (kind === "finder") assert.equal(f.selection(), 1);
  });
  test(`${kind}: Option+/ works on macOS without consuming text entry or handled keys`, () => {
    const f = fixture(kind);
    const base = { key: "÷", code: "Slash", altKey: true, target: {}, preventDefault() {} };
    f.handler(base);
    assert.equal(f.focus(), 1);
    for (const updates of [{ target: f.input }, { target: new f.Textarea() },
      { target: { isContentEditable: true } }, { ctrlKey: true }, { metaKey: true },
      { defaultPrevented: true }, { isComposing: true }, { key: "x", code: "KeyX" }]) f.handler({ ...base, ...updates });
    assert.equal(f.focus(), 1);
  });
}

test("search hints and accessibility metadata advertise the modified shortcut", async () => {
  const f = fixture("finder");
  assert.equal(f.input.attributes["aria-keyshortcuts"], "Alt+/ Escape");
  const generator = await readFile(new URL("../scripts/enhance-generated-pages.mjs", import.meta.url), "utf8");
  assert.match(generator, /aria-keyshortcuts="Alt\+\/ Escape"/);
  assert.match(generator, /<kbd>Alt\+\/<\/kbd>/);
  assert.doesNotMatch(generator, /aria-keyshortcuts="\/ Escape"/);
});
