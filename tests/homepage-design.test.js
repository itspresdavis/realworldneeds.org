import { isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel } from "../src/utils/resource-location.js";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const css = await readFile('src/clarity.css', 'utf8');
const refinement = await readFile('src/refinement.js', 'utf8');

// Tests the rearrangement itself, rather than relying on a static markup claim.
test('finder composition reuses each existing interactive node exactly once', () => {
  const selectors = ['.finder-map-link', '.finder-search', '.quick-needs', '.jump-results', '.location-actions', '#locationStatus', '#locationRecovery', '.finder-disclosures'];
  const nodes = new Map(selectors.map(selector => [selector, {selector, marker:Symbol(selector)}]));
  const search = nodes.get('.finder-search');
  const appended = [];
  let surface;
  search.before = node => { surface = node; };
  const sidebar = {querySelector: selector => selector === '.finder-surface' ? surface : nodes.get(selector)};
  const document = {
    querySelector: selector => selector === '.finder-sidebar' ? sidebar : nodes.get(selector),
    createElement: tag => ({tag, append: (...values) => appended.push(...values), contains: () => false})
  };
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,document});
  const source = refinement.slice(refinement.indexOf('function composeFinderSurface()'), refinement.indexOf('function improveFilterSummary()'));
  vm.runInContext(source, context);
  context.composeFinderSurface();
  assert.equal(surface.className, 'finder-surface');
  assert.equal(appended[0].htmlFor, 'resourceSearch');
  assert.equal(appended[0].textContent, 'Search the directory');
  assert.deepEqual(appended.slice(1), [...nodes.values()]);
  context.composeFinderSurface();
  assert.equal(appended.length, 9, 'reinstallation is a no-op');
});

test('paper finder, map key and documentary closing retain normal text contrast', () => {
  const rule = selector => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(declaration, `${selector} has a presentation rule`);
    return declaration;
  };
  const property = (selector, name) => {
    const value = rule(selector).match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;}]+)`))?.[1].trim();
    assert.ok(value, `${selector} declares ${name}`);
    return value;
  };
  const color = (selector, name) => {
    let value = property(selector, name);
    if (value.startsWith('var(')) value = property(':root', value.slice(4, -1));
    assert.match(value, /^#[\da-f]{6}$/i);
    return value.slice(1);
  };
  const luminance = hex => hex.match(/../g).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const finder = color('.rwn-professional .finder', 'background');
  const map = color('.rwn-professional .globe-stage', 'background');
  const closing = color('.rwn-professional .about-rwn', 'background');
  for (const [selector, background] of [
    ['.rwn-professional .finder-intro h1', finder],
    ['.rwn-professional .finder-intro p', finder],
    ['.rwn-professional .finder-safety', finder],
    ['.atlas-key', map], ['.atlas-key small', map],
    ['.rwn-professional .about-rwn__heading h2', closing],
    ['.rwn-professional .about-rwn__heading p', closing],
  ]) {
    const foreground = color(selector, 'color');
    const levels = [luminance(foreground),luminance(background)].sort((a,b)=>a-b);
    assert.ok((levels[1]+.05)/(levels[0]+.05)>=4.5, `${selector}: ${foreground} on ${background}`);
  }
  assert.equal(property('.rwn-professional .finder-surface', 'background'), 'transparent');
  assert.equal(property('.rwn-professional .finder-surface', 'box-shadow'), 'none');
  assert.match(property('.rwn-professional .finder-intro h1', 'font-family'), /^Georgia,.*serif$/);
  assert.equal(color('.rwn-professional .site-footer', 'background'), finder, 'the light footer shares the finder paper');
});

test('compact fallback removes the empty column and source review remains visible on phones', () => {
  assert.match(css, /\.finder__grid:has\(\.is-globe-unavailable\)\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.resource-row__reviewed\s*\{\s*display:\s*block;\s*grid-column:\s*1 \/ -1;\s*grid-row:\s*4;/);
  assert.match(css, /\.resource-row__reviewed::before\s*\{\s*content:\s*"Source checked "\s*;?\s*\}/);
  assert.match(refinement, /groupFinderDisclosures\(\);\s*composeFinderSurface\(\);/);
});


test('visible search prompt is included in the accessible name', () => {
  assert.match(refinement, /input\.setAttribute\("aria-label", "Search the directory by need, service, place, ZIP or postcode, or organization"\)/);
});

test('regrouping restores a focused search and its selected text without scrolling', () => {
  let current, surface, restored;
  const input = {selectionStart:2, selectionEnd:6, selectionDirection:'backward', focus: options => {current=input; assert.deepEqual(JSON.parse(JSON.stringify(options)), {preventScroll:true});}, setSelectionRange: (...args) => {restored=args;}};
  current=input;
  const search = {before: node => {surface=node;}};
  const sidebar = {querySelector: selector => selector === '.finder-surface' ? surface : selector === '.finder-search' ? search : null};
  const document = {
    get activeElement() { return current; },
    querySelector: selector => selector === '.finder-sidebar' ? sidebar : search,
    createElement: tag => ({tag, append: node => {if(node===search) current=null;}, contains: node => node===input})
  };
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,document});
  vm.runInContext(refinement.slice(refinement.indexOf('function composeFinderSurface()'), refinement.indexOf('function improveFilterSummary()')), context);
  context.composeFinderSurface();
  assert.equal(current,input);
  assert.deepEqual(restored,[2,6,'backward']);
});


test('location and clear controls can share the narrower grouped phone surface', () => {
  assert.match(css, /\.finder-surface \.location-button\s*\{\s*flex-basis:\s*10rem\s*;?\s*\}/);
});

test('all needs is first in DOM order and compact rows are balanced without smaller targets', () => {
  const markup = refinement.slice(refinement.indexOf('container.innerHTML ='), refinement.indexOf('search.insertAdjacentElement'));
  assert.ok(markup.indexOf('data-quick-type="all"') < markup.indexOf('QUICK_TYPES.map'));
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /data-quick-type="health"\]\s*\{\s*grid-column:\s*span 2\s*;?\s*\}/);
  assert.match(css, /\.quick-need\s*\{[^}]*min-height:\s*44px;/);
});

test('empty results distinguish unsaved, filtered-saved, ordinary and unavailable requests', async () => {
  const app = await readFile('src/app.js','utf8');
  const source = app.slice(app.indexOf('function emptyResultsCopy('), app.indexOf('function renderResults()'));
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,});
  vm.runInContext(source, context);
  const inspect = state => JSON.parse(JSON.stringify(context.emptyResultsCopy({viewMode:'aid',savedOnly:false,savedCount:0,...state})));
  assert.equal(inspect({savedOnly:true}).title,'No saved services yet.');
  assert.match(inspect({savedOnly:true}).detail,/choose Save.*this browser/);
  assert.equal(inspect({savedOnly:true}).action,'Browse all services');
  assert.equal(inspect({savedOnly:true,savedCount:2}).title,'No saved services match these filters.');
  assert.equal(inspect({savedOnly:true,savedCount:2}).action,'Browse all services');
  assert.equal(inspect({}).title,'No services match these filters.');
  assert.equal(inspect({}).action,'Clear search and filters');
  assert.equal(inspect({viewMode:'needs',savedOnly:true}).action,'');
  assert.match(app, /event\.target\.closest\("#clearFinderFilters"\)\) clearFinderFilters\(\)/);
});


test('actual resource finders show their type once and retain meaningful cost labels', async () => {
  const { resources, categories } = await import('../src/data/resources.js');
  const { freeAccessLabel } = await import('../src/data/free-access.js');
  const { isExactServiceSite } = await import('../src/utils/geo.js');
  const app = await readFile('src/app.js','utf8');
  const source = app.slice(app.indexOf('function resourceCard('), app.indexOf('function emptyResultsCopy('));
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,categories, freeAccessLabel, isExactServiceSite, state:{}, allTypes:r=>[r.category], formatResourcePlace:r=>r.city, locationResultLabel:()=>'', reviewLabel:r=>r.lastChecked, icon:{arrow:''}, sourceClosureMarkup:()=>''});
  vm.runInContext(source, context);
  const locator = resources.find(r=>r.id==='feeding-america');
  assert.ok(locator, 'the real catalog fixture exists');
  const markup = context.resourceCard(locator);
  assert.equal((markup.match(/Resource finder/g)||[]).length,1);
  for (const model of ['free','free-eligible','free-option']) {
    const resource = resources.find(r=>r.costModel===model);
    assert.ok(resource, model);
    assert.ok(context.resourceCard(resource).includes(`<b>${freeAccessLabel(resource,true)}</b>`), `${model} is still visible`);
  }
});


test('detailed filters use one readable column with high-contrast selected checks', () => {
  assert.match(css, /\.rwn-professional \.layer-list\s*\{\s*overflow:\s*visible;\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.layer-toggle\.is-active \.layer-toggle__check\s*\{\s*border-color:\s*#24583e;\s*background:\s*#24583e;\s*color:\s*#fff\s*;?\s*\}/);
});


test('expanded filter groups do not clip keyboard focus outlines', () => {
  assert.match(css, /\.rwn-professional \.layer-list\s*\{\s*overflow:\s*visible;/);
  assert.match(css, /\.rwn-professional \.access-switch\s*\{[^}]*overflow:\s*visible\s*;?\s*\}/);
});


test('native focus scrolling reserves space for outer rings at the viewport bottom', () => {
  assert.match(css, /scroll-padding-top:\s*var\(--rwn-header-clearance,\s*5rem\);\s*scroll-padding-bottom:\s*\.75rem;/);
});
