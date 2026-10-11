import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const css = await readFile('src/clarity.css', 'utf8');
const refinement = await readFile('src/refinement.js', 'utf8');

// Tests the rearrangement itself, rather than relying on a static markup claim.
test('finder composition reuses each existing interactive node exactly once', () => {
  const selectors = ['.finder-search', '.quick-needs', '.jump-results', '.location-actions', '#locationStatus', '#locationRecovery', '.finder-disclosures'];
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
  const context = vm.createContext({document});
  const source = refinement.slice(refinement.indexOf('function composeFinderSurface()'), refinement.indexOf('function improveFilterSummary()'));
  vm.runInContext(source, context);
  context.composeFinderSurface();
  assert.equal(surface.className, 'finder-surface');
  assert.equal(appended[0].htmlFor, 'resourceSearch');
  assert.equal(appended[0].textContent, 'What do you need?');
  assert.deepEqual(appended.slice(1), [...nodes.values()]);
  context.composeFinderSurface();
  assert.equal(appended.length, 8, 'reinstallation is a no-op');
});

test('forest hero, map legend and warning colors retain normal text contrast', () => {
  const luminance = hex => hex.match(/../g).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  for (const [foreground,background] of [['f9f8ef','102f27'],['c6d7cc','102f27'],['bfd1c5','102f27'],['d3e2d8','2b5948'],['b7cfc0','2b5948'],['153c30','fffefb']]) {
    const levels = [luminance(foreground),luminance(background)].sort((a,b)=>a-b);
    assert.ok((levels[1]+.05)/(levels[0]+.05)>=4.5, `${foreground} on ${background}`);
    assert.ok(css.includes('#'+foreground), 'the tested foreground is used');
  }
});

test('compact fallback removes the empty column and source review remains visible on phones', () => {
  assert.match(css, /\.finder__grid:has\(\.is-globe-unavailable\) \{ grid-template-columns: minmax\(0,1fr\);/);
  assert.match(css, /\.resource-row__reviewed \{ display:block; grid-column:1 \/ -1; grid-row:4;/);
  assert.match(css, /\.resource-row__reviewed::before \{ content:"Source checked ";/);
  assert.match(refinement, /groupFinderDisclosures\(\);\s*composeFinderSurface\(\);/);
});


test('visible search prompt is included in the accessible name', () => {
  assert.match(refinement, /input\.setAttribute\("aria-label", "What do you need\? Search by need, service, place, ZIP or postcode, or organization"\)/);
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
  const context = vm.createContext({document});
  vm.runInContext(refinement.slice(refinement.indexOf('function composeFinderSurface()'), refinement.indexOf('function improveFilterSummary()')), context);
  context.composeFinderSurface();
  assert.equal(current,input);
  assert.deepEqual(restored,[2,6,'backward']);
});


test('location and clear controls can share the narrower grouped phone surface', () => {
  assert.match(css, /\.finder-surface \.location-button \{ flex-basis: 10rem; \}/);
});
