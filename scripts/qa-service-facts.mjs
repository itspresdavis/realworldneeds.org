import { mkdir, writeFile } from "node:fs/promises";
import { phoneLinks } from "../src/utils/phone.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";
import { freeAccessModels } from "../src/data/free-access.js";

// Run in the established Chromium CI suite. DOM presence alone missed a shared
// directory CSS rule that made every service's address/eligibility invisible.
export async function verifyServiceFacts({ client, host, payload, navigate, evaluate, capture }) {
  const samples = [
    payload.resources.find((item) => item.id === "whitechapel-mission"),
    payload.resources.find((item) => item.id === "feeding-america"),
    payload.resources.find((item) => item.kind === "direct" && !item.phone && !item.hours),
    [...payload.resources].sort((a, b) => b.name.length - a.name.length)[0],
    [...payload.resources].sort((a, b) => b.address.length - a.address.length)[0],
    payload.resources.find((item) => sourceClosureNotice(item))
  ];
  if (samples.some((item) => !item)) throw new Error("Service fact browser fixtures missing.");
  const evidence = [];
  const key = async (name, code, text) => {
    await client.call('Input.dispatchKeyEvent', {type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code,...(text ? {text,unmodifiedText:text} : {})});
    await client.call('Input.dispatchKeyEvent', {type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code});
  };
  const inspect = async (item, mode) => {
    const state = await evaluate(client, `(() => {
      const visible = (element) => {
        const rect = element?.getBoundingClientRect();
        return !!rect && rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
      };
      const record = document.querySelector('#service .directory-record');
      const facts = record?.querySelector('dl');
      const tools = document.querySelector('[data-service-utility]');
      const jump = document.querySelector('.service-tools-jump');
      const warning = document.querySelector('#service > .directory-shell > .source-status-notice');
      const next = document.querySelector('.service-next-steps');
      const sourceReview = document.querySelector('.service-source-review');
      const coordinateNote = document.querySelector('.service-coordinate-note');
      const costScope = document.querySelector('.service-cost-scope');
      const rows = [...(facts?.querySelectorAll(':scope > div') || [])].map(row => ({
        label:row.querySelector('dt')?.textContent.trim(), value:row.querySelector('dd')?.textContent.trim(),
        visible:visible(row) && visible(row.querySelector('dt')) && visible(row.querySelector('dd')),
        fontSize:parseFloat(getComputedStyle(row.querySelector('dd')).fontSize)
      }));
      return { title:document.querySelector('#service h1')?.textContent.trim(), factsVisible:visible(facts), display:facts && getComputedStyle(facts).display,
        rows, linksVisible:visible(record?.querySelector('.directory-links')),
        sourceChecked:document.querySelector('#service .legal-meta')?.textContent.includes('Source checked ${item.lastChecked}'),
        sourceReview:sourceReview?.textContent, sourceReviewVisible:visible(sourceReview),
        coordinateNote:coordinateNote?.textContent || null, coordinateNoteVisible:visible(coordinateNote),
        costScope:costScope?.textContent || null, costScopeVisible:visible(costScope),
        calls:[...(facts?.querySelectorAll('a[href^="tel:"]') || [])].map(a => a.getAttribute('href')),
        factsBeforeTools:!tools || !!(record.compareDocumentPosition(tools) & 4),
        warningBeforeActions:!warning || !!(warning.compareDocumentPosition(next) & 4),
        warning:warning?.textContent || '', warningVisible:visible(warning),
        toolsPresent:!!tools,jumpPresent:!!jump,toolsVisible:visible(tools),jumpVisible:visible(jump),
        directions:[...document.querySelectorAll('#service a[href]')].some(link => {
          const url = new URL(link.href);
          return url.hostname === 'maps.apple.com' || url.hostname === 'www.google.com' && url.pathname.startsWith('/maps/');
        }),
        overflow:Math.max(0,document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    const expected = new Map([[item.kind === "direct" ? "Address" : "Coverage", item.address], ["Access", item.accessType]]);
    if (item.hours) expected.set("Hours", item.hours);
    if (item.eligibility) expected.set("Eligibility", item.eligibility);
    if (item.phone) expected.set("Phone", item.phone);
    for (const [label, value] of expected) {
      if (!state.rows.some(row => row.label === label && row.value === value && row.visible)) throw new Error(`${item.id} ${mode}: hidden or changed ${label}: ${JSON.stringify(state)}`);
    }
    const notice = sourceClosureNotice(item);
    if (!state.sourceChecked || !state.sourceReviewVisible || !state.sourceReview?.includes('not a confirmation of current service availability')) throw new Error(`Source-review boundary is missing or hidden: ${item.id} ${mode}`);
    if (state.coordinateNote !== (item.coordinateNote || null) || item.coordinateNote && !state.coordinateNoteVisible) throw new Error(`Coordinate evidence is missing, changed or hidden: ${item.id} ${mode}`);
    const expectedCostScope = item.costModel === 'free-navigation' ? freeAccessModels[item.costModel].description : null;
    if (state.costScope !== expectedCostScope || expectedCostScope && !state.costScopeVisible) throw new Error(`Free-navigation cost scope is missing, changed or hidden: ${item.id} ${mode}`);
    const phoneTargets = phoneLinks(item.phone).map(({ href }) => href);
    if (!state.factsVisible || !state.linksVisible || state.title !== item.name || state.rows.some(row => !row.visible || row.fontSize < 15) || !state.factsBeforeTools || !state.warningBeforeActions || state.overflow > 1 || JSON.stringify(state.calls) !== JSON.stringify(phoneTargets) || (notice && (!state.warningVisible || !state.warning.includes(notice.detail))) || state.directions !== (item.kind === 'direct')) {
      throw new Error(`Service facts failed ${item.id} ${mode}: ${JSON.stringify(state)}`);
    }
    if (!item.hours && item.kind === 'direct' && !state.rows.some(row => row.label === 'Hours' && row.value.includes('Not listed in this snapshot'))) throw new Error('Missing hours need explicit uncertainty.');
    if (!item.phone && !state.rows.some(row => row.label === 'Phone' && row.value.includes('Not listed in this snapshot'))) throw new Error('Missing phone needs explicit uncertainty.');
    if (mode === 'print' && (state.toolsVisible || state.jumpVisible)) throw new Error('Print must omit interactive listing tools.');
    if (mode === 'JavaScript disabled' && (state.toolsPresent || state.jumpPresent)) throw new Error('No-JavaScript page must not show inactive listing tools.');
    evidence.push({id:item.id,mode,...state});
  };
  for (const width of [1440, 390, 320]) {
    await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    for (const [index, item] of samples.entries()) {
      await navigate(client, `${host}/service/${encodeURIComponent(item.id)}`);
      await inspect(item, `${width}px`);
      await evaluate(client, `document.querySelector('#service .directory-record').scrollIntoView({block:'start',behavior:'instant'})`);
      if (index === 0 || index === 3) await capture(client, `service-facts-${index}-${width}.png`);
      if (index === 0) {
        await evaluate(client, `document.querySelector('.service-tools-jump').focus()`);
        await key('Enter', 13, '\r');
        const jumped = await evaluate(client, `document.activeElement.id === 'service-listing-tools' && location.hash === '#service-listing-tools'`);
        if (!jumped) throw new Error('Tools link did not focus its labelled destination.');
        await key('Tab', 9);
        await key('Enter', 13, '\r');
        // A fragment jump uses the site's smooth scrolling. Wait for the
        // actual visible destination, rather than sampling the first frame.
        const saved = await evaluate(client, `(async () => {
          const deadline = performance.now() + 3000;
          let state;
          do {
            const active = document.activeElement, rect = active.getBoundingClientRect();
            state = {focused:active.matches('[data-service-save]'),pressed:active.getAttribute('aria-pressed'),top:rect.top,bottom:rect.bottom,height:innerHeight};
            if (state.focused && state.pressed === 'true' && state.top >= 0 && state.bottom <= state.height) return state;
            await new Promise(resolve => requestAnimationFrame(resolve));
          } while (performance.now() < deadline);
          return state;
        })()`);
        if (!saved.focused || saved.pressed !== 'true' || saved.top < 0 || saved.bottom > saved.height) throw new Error(`Save jump/key activation failed: ${JSON.stringify(saved)}`);
        await evaluate(client, `document.querySelector('[data-service-save]').click()`);
      }
    }
  }
  await client.call('Emulation.setEmulatedMedia', {media:'print'});
  await inspect(samples.at(-1), 'print');
  await client.call('Emulation.setEmulatedMedia', {media:''});
  await client.call('Emulation.setScriptExecutionDisabled', {value:true});
  await navigate(client, `${host}/service/${encodeURIComponent(samples[0].id)}`);
  await inspect(samples[0], 'JavaScript disabled');
  await client.call('Emulation.setScriptExecutionDisabled', {value:false});
  await mkdir('qa-screenshots', {recursive:true});
  await writeFile('qa-screenshots/service-facts.json', JSON.stringify(evidence, null, 2));
  console.log(`Service fact QA passed: ${evidence.length} cases covering readable facts, exact source wording, warnings, safe calls, missing fields, long names/addresses, tools, print and no JavaScript.`);
}
