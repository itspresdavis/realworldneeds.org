import { mkdir, writeFile } from "node:fs/promises";

// Source-review wording must be equally clear before and after search,
// on scoped entry pages, and in the source ledger.
export async function verifySourceConfidence({ client, host, navigate, evaluate, capture }) {
  const evidence = [];
  const paths = ["/directory", "/directory/united-kingdom", "/directory/help/food", "/directory/region/europe", "/directory/local/united-kingdom/london"];
  const snapshot = () => evaluate(client, `(() => {
    const visible = element => {
      const rect = element?.getBoundingClientRect();
      return !!rect?.width && !!rect?.height && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    };
    const shell = document.querySelector('.directory-shell');
    const cards = [...document.querySelectorAll('.directory-records .directory-record')];
    const results = [...document.querySelectorAll('.directory-global-result')];
    return {
      path:location.pathname,
      filtered:shell?.classList.contains('has-global-search'),
      query:document.querySelector('[data-directory-query]')?.value,
      cards:cards.map(card => ({date:card.querySelector('header time')?.textContent,visible:visible(card.querySelector('header time'))})),
      results:results.map(row => ({text:row.textContent,visible:visible(row)})),
      coverage:document.querySelector('#directory-coverage-note')?.textContent,
      ranges:[...document.querySelectorAll('.source-check-range')].map(node => ({text:node.textContent,visible:visible(node)})),
      sourceNote:document.querySelector('.source-review-note')?.textContent,
      sourceNoteVisible:visible(document.querySelector('.source-review-note')),
      overflow:Math.max(0,(document.documentElement?.scrollWidth || 0) - innerWidth)
    };
  })()`);
  const wait = async predicate => {
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await snapshot();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Source-confidence state did not settle: ${JSON.stringify(state)}`);
  };
  for (const width of [1440, 390]) {
    await client.call('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:width < 600});
    for (const path of paths) {
      await navigate(client, 'about:blank');
      await navigate(client, `${host}${path}`);
      const original = await wait(state => state.path === path && state.cards.length > 0 && !state.filtered);
      if (original.overflow > 1 || original.cards.some(card => !card.visible || !/^Source checked \d{4}-\d{2}-\d{2}$/.test(card.date)) || !original.coverage?.includes('RWN does not list every service or place')) throw new Error(`Unfiltered source context failed ${width}px ${path}: ${JSON.stringify(original)}`);
      await evaluate(client, `document.querySelector('[data-directory-query]').focus()`);
      await client.call('Input.insertText', {text:'food'});
      const filtered = await wait(state => state.path === path && state.query === 'food' && state.filtered && state.results.length > 0);
      if (filtered.overflow > 1 || filtered.results.some(row => !row.visible || !row.text.includes('Source checked'))) throw new Error(`Filtered source context failed ${width}px ${path}: ${JSON.stringify(filtered)}`);
      evidence.push({width,path,staticCards:original.cards.length,filteredRows:filtered.results.length,overflow:filtered.overflow});
    }
    await navigate(client, `${host}/sources`);
    const sources = await wait(state => state.path === '/sources' && state.ranges.length > 0);
    if (sources.overflow > 1 || sources.ranges.some(range => !range.visible || !range.text.startsWith('Source checks ')) || !sources.sourceNoteVisible || !sources.sourceNote.includes('Individual listing dates can differ') || !sources.sourceNote.includes('do not confirm current service availability')) throw new Error(`Source-ledger context failed ${width}px: ${JSON.stringify(sources)}`);
    await evaluate(client, `document.querySelector('.source-review-note').scrollIntoView({block:'center',behavior:'instant'})`);
    await capture(client, `source-confidence-ledger-${width}.png`);
    evidence.push({width,path:'/sources',ranges:sources.ranges.length,overflow:sources.overflow});
  }
  await mkdir('qa-screenshots', {recursive:true});
  await writeFile('qa-screenshots/source-confidence.json', JSON.stringify(evidence, null, 2));
  console.log(`Source-confidence QA passed: ${evidence.length} desktop/mobile entry cases with unfiltered/filtered source dates and readable group context.`);
}
