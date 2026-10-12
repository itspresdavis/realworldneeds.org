import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { hasIntermediateScrollSample } from "../scripts/qa-page-interactions.mjs";

const source = (await readFile(new URL("../src/page-interactions.js", import.meta.url), "utf8")).replace("export function", "function");
function fixture({ reduced = false, visible = false, observerAvailable = true } = {}) {
  const events = {}, windowEvents = {}, timers = new Map(), properties = {}, animations = [], observed = [], unobserved = [];
  const classSet = new Set();
  const page = { dataset: {}, style: { setProperty: (key, value) => { properties[key] = value; } }, classList: { add: value => classSet.add(value), remove: value => classSet.delete(value), contains: value => classSet.has(value) } };
  const element = (id) => ({ id, attributes: {}, tabIndex: null, hasAttribute(name) { return Object.hasOwn(this.attributes, name); }, setAttribute(name, value) { this.attributes[name] = value; }, getBoundingClientRect: () => ({ top: visible ? 200 : 1200 }) });
  const sections = Object.fromEntries(["finder", "results", "about", "standards"].map(id => [id, element(id)]));
  const header = { id: "top", height: 74, getBoundingClientRect() { return { height: this.height }; }, removeAttribute() { this.id = ""; }, before(node) { sections.top = node; } };
  const item = { ...element("editorial"), targeted: false, focused: false, closest() { return this.targeted; }, contains() { return this.focused; }, animate(frames, options) { const animation = { frames, options, listeners: {}, cancel() { this.cancelled = true; this.listeners.cancel?.(); }, addEventListener(name, handler) { this.listeners[name] = handler; } }; animations.push(animation); return animation; } };
  let resize, intersect, preferenceChange, disconnects = 0;
  class ResizeObserver { constructor(callback) { resize = callback; } observe() {} }
  class IntersectionObserver { constructor(callback) { intersect = callback; } observe(node) { observed.push(node); } unobserve(node) { unobserved.push(node); } disconnect() { disconnects++; } }
  const preference = { matches: reduced, addEventListener(name, callback) { preferenceChange = callback; } };
  const scrolls = [];
  const window = { ResizeObserver, ...(observerAvailable ? { IntersectionObserver } : {}), innerHeight: 800, scrollX: 0, scrollY: 480, matchMedia: () => preference, setTimeout(callback) { timers.set(timers.size + 1, callback); return timers.size; }, clearTimeout(id) { timers.delete(id); }, addEventListener(name, callback) { (windowEvents[name] ||= []).push(callback); }, scrollTo(options) { scrolls.push(options); } };
  const document = { documentElement: page, hidden: false, activeElement: {}, querySelector: () => header, querySelectorAll: () => [item], getElementById: id => sections[id], createElement: () => element(""), addEventListener: (name, callback) => { events[name] = callback; } };
  vm.runInNewContext(`${source}\ninstallPageInteractions();`, { window, document, ResizeObserver, IntersectionObserver });
  const click = (href = "#results", props = {}) => {
    const link = { getAttribute: () => href, hasAttribute: () => false, target: "", classList: { contains: () => false }, ...props.link };
    const event = { button: 0, target: { closest: () => link }, preventDefault() { throw new Error("Native navigation must not be intercepted"); }, ...props };
    events.click(event);
    return event;
  };
  return { page, header, sections, item, document, preference, properties, events, windowEvents, timers, animations, observed, unobserved, scrolls, click, resize: () => resize(), enter: (top = 650) => intersect?.([{ isIntersecting: true, target: item, boundingClientRect: { top } }]), reduce() { preference.matches = true; preferenceChange(); }, disconnected: () => disconnects };
}

test("one measured header clearance follows layout changes without moving the reader", () => {
  const f = fixture();
  assert.equal(f.properties["--rwn-header-clearance"], "86px");
  f.header.height = 112.4; f.resize();
  assert.equal(f.properties["--rwn-header-clearance"], "125px");
  assert.equal(f.scrolls.length, 0);
  for (const id of ["finder", "results", "about", "standards"]) assert.equal(f.sections[id].tabIndex, -1);
  assert.equal(f.header.id, "");
  assert.equal(f.sections.top.id, "top");
});

test("only intentional same-page navigation briefly opts into native smooth travel", () => {
  assert.ok(hasIntermediateScrollSample(0,726,[699,726]));
  assert.ok(hasIntermediateScrollSample(726,0,[699,0]));
  for (const samples of [[726],[0,726],[-5,730],[.5,725.5],[NaN,Infinity]]) {
    assert.equal(hasIntermediateScrollSample(0,726,samples),false,JSON.stringify(samples));
  }
  assert.equal(hasIntermediateScrollSample(726,726,[726]),false);
  assert.equal(hasIntermediateScrollSample(0,Infinity,[699]),false);
  assert.equal(hasIntermediateScrollSample(NaN,726,[699]),false);

  const f = fixture(); f.click();
  assert.equal(f.page.classList.contains("rwn-anchor-travel"), true);
  for (const callback of [...f.timers.values()]) callback();
  assert.equal(f.page.classList.contains("rwn-anchor-travel"), false);
  assert.equal(f.scrolls.length, 0);
  f.click(); f.click("#finder");
  assert.equal(f.timers.size, 1, "repeated navigation leaves only one cleanup");
  assert.equal(f.windowEvents.popstate, undefined, "native fragment popstate must not cancel the default smooth scroll");
  for (const callback of [...f.timers.values()]) callback();
  assert.equal(f.page.classList.contains("rwn-anchor-travel"), false);
});

test("skip links, modified clicks, resource hashes and other pages stay native and immediate", () => {
  for (const [href, props] of [["#finder", { link: { classList: { contains: () => true } } }], ["#results", { ctrlKey: true }], ["#results", { button: 1 }], ["#results", { defaultPrevented: true }], ["#results", { link: { target: "_blank" } }], ["#resource=bowery-mission", {}], ["/directory", {}]]) {
    const f = fixture(); f.click(href, props);
    assert.equal(f.page.classList.contains("rwn-anchor-travel"), false, `${href}: ${JSON.stringify(props)}`);
  }
  const f = fixture({ reduced: true }); f.click();
  assert.equal(f.page.classList.contains("rwn-anchor-travel"), false);
  assert.equal(f.observed.length, 0);
});

test("editorial entrances stay visible, bounded and are unobserved after one arrival", () => {
  const f = fixture();
  assert.equal(f.animations.length, 0);
  f.enter();
  assert.equal(f.unobserved[0], f.item);
  assert.equal(f.disconnected(), 1);
  f.enter();
  assert.equal(f.animations.length, 1, "queued or repeated entries never replay an arrival");
  const animation = f.animations[0];
  assert.equal(animation.options.duration, 280);
  assert.equal(animation.frames[0].opacity, undefined, "text contrast is never faded");
  assert.equal(animation.frames[0].transform, "translateY(8px)");
  assert.equal(animation.frames.at(-1).transform, "none");
  assert.equal(animation.options.fill, undefined, "no retained styles or layers after completion");
});

test("reduced-motion preference changes cancel active effects and native travel in place", () => {
  const f = fixture(); f.enter(); f.click(); f.reduce();
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.page.classList.contains("rwn-anchor-travel"), false);
  assert.equal(f.scrolls[0].top, 480);
  assert.equal(f.scrolls[0].behavior, "instant");
  assert.ok(f.disconnected() > 0);
});

test("already visible, hash-targeted, focused and jumped-past content does not animate", () => {
  assert.equal(fixture({ visible: true }).observed.length, 0);
  assert.equal(fixture({ observerAvailable: false }).observed.length, 0);
  for (const mode of ["targeted", "focused", "hidden", "above"]) {
    const f = fixture();
    if (mode === "hidden") f.document.hidden = true;
    else f.item[mode] = true;
    f.enter(mode === "above" ? -5 : 650);
    assert.equal(f.animations.length, 0, mode);
  }
});

test("no-JS content and control states have no hidden entrance prerequisite", async () => {
  const css = await readFile("src/clarity.css", "utf8");
  assert.doesNotMatch(source, /style\.(?:opacity|visibility)|preventDefault\(|requestAnimationFrame\(|addEventListener\("scroll"/);
  assert.match(css, /scroll-padding-top: var\(--rwn-header-clearance, 5rem\)/);
  assert.match(css, /:where\(#finder, #results, #about, #standards\) \{ scroll-margin-top: 0;/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
  const skipStack = Number(css.match(/\.rwn-professional \.skip-link \{ z-index: (\d+);/)?.[1]);
  const headerStack = Number(css.match(/\.rwn-professional \.site-header\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
  assert.ok(skipStack > headerStack, "the focused skip link paints above the sticky header");
  assert.match(css, /#resourceSearch::-webkit-search-cancel-button \{ -webkit-appearance: none; display: none; \}/, "native search cancel does not duplicate the accessible Clear button");
  assert.match(css, /\.filter-heading button \{[^}]*color: var\(--rwn-green-dark\);[^}]*font-size: \.8125rem;/);
  assert.match(css, /\.resource-panel :is\(p, dd, li, \.cost-scope\) \{ color: var\(--rwn-ink\);/);
  assert.match(css, /\.panel-precision strong/);
  assert.match(css, /\.panel-navigation \{ grid-template-columns: 44px 1fr 44px;/);
  assert.match(css, /:is\(\.globe-controls,\.panel-utilities,\.panel-map-actions\) :focus-visible \{ outline-offset: -4px !important;/);
  assert.match(css, /\.site-footer :is\(a, button\):focus-visible \{ outline-color: #c2e5cc/);
  assert.ok((await stat("src/page-interactions.js")).size < 6_000, "optional motion stays dependency-free and bounded");
});
