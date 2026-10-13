import { writeFile } from "node:fs/promises";
import { phoneLinks } from "../src/utils/phone.js";
import { sourceClosureNotice } from "../src/utils/source-status.js";

// Use the existing CI browser. No external provider is contacted or called.
export async function verifyServiceContact({ client, host, payload, navigate, evaluate, capture }) {
  const samples = [
    payload.resources.find(item => item.id === "bowery-mission"),
    payload.resources.find(item => item.id === "la-regional-food-bank"),
    payload.resources.find(item => item.providerUrl && sourceClosureNotice(item)),
    payload.resources.find(item => item.id === "doctors-of-the-world-uk-advice-line"),
    payload.resources.find(item => item.kind === "direct" && !item.phone),
    payload.resources.find(item => phoneLinks(item.phone).length > 1)
  ];
  if (samples.some(item => !item)) throw new Error("Service contact fixtures are missing.");
  const evidence = [];
  for (const width of [1440, 500, 390, 320]) {
    await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    for (const [index, item] of samples.entries()) {
      await navigate(client, `${host}/service/${encodeURIComponent(item.id)}`);
      const state = await evaluate(client, `(() => {
        const next = document.querySelector('.service-next-steps');
        const contact = next?.querySelector('.service-contact-actions');
        const maps = contact?.querySelector('.service-location-actions');
        const warning = document.querySelector('#service > .directory-shell > .source-status-notice');
        const heading = next?.querySelector('h2');
        const links = [...(next?.querySelectorAll('a') || [])];
        const primary = [...(contact?.querySelectorAll('.service-contact-buttons > a') || [])];
        const rect = node => node?.getBoundingClientRect();
        return {
          id: document.querySelector('#service')?.dataset.serviceId,
          heading: heading?.textContent, labelled: next?.getAttribute('aria-labelledby') === heading?.id,
          calls: links.filter(a => a.href.startsWith('tel:')).map(a => a.getAttribute('href')),
          source: next?.querySelector('.is-primary')?.getAttribute('href'),
          provider: next?.querySelector('.is-provider')?.getAttribute('href') || null,
          finderLabel: next?.querySelector('.is-primary strong')?.textContent,
          links: links.map(a => ({text:a.textContent.trim(),height:rect(a).height,width:rect(a).width,clipped:a.scrollWidth > a.clientWidth + 1,tabIndex:a.tabIndex})),
          mapsAfterContact: !maps || primary.every(a => rect(a).bottom <= rect(maps).top + 1),
          warningBeforeContact: !warning || !!(warning.compareDocumentPosition(next) & 4),
          sourceDate: document.querySelector('#service .legal-meta')?.textContent.includes(${JSON.stringify(item.lastChecked)}),
          overflow: Math.max(0,document.documentElement.scrollWidth-innerWidth)
        };
      })()`);
      const expectedProvider = item.providerUrl && item.providerUrl !== item.sourceUrl && item.providerUrl !== item.accessUrl ? item.providerUrl : null;
      if (state.id !== item.id || !state.labelled || !state.heading || state.source !== item.sourceUrl || state.provider !== expectedProvider || JSON.stringify(state.calls) !== JSON.stringify(phoneLinks(item.phone).map(link => link.href)) || state.links.some(link => link.height < 44 || !link.width || link.clipped || link.tabIndex < 0) || !state.mapsAfterContact || !state.warningBeforeContact || !state.sourceDate || state.overflow > 1) {
        throw new Error(`Service contact failed at ${width}px: ${JSON.stringify(state)}`);
      }
      if (item.id === 'la-regional-food-bank' && state.finderLabel !== 'Open resource finder') throw new Error('Reviewed finder route needs a purposeful label.');
      if (item.id === 'doctors-of-the-world-uk-advice-line' && state.finderLabel !== 'Official source') throw new Error('Advice line must not be presented as an online finder.');
      await evaluate(client, `document.querySelector('.service-next-steps').scrollIntoView({block:'center',behavior:'instant'})`);
      if (index < 3) await capture(client, `service-contact-${index}-${width}.png`);
      // Follow the actual Tab sequence through primary contact and quieter maps.
      await evaluate(client, `document.querySelector('.service-contact-buttons > a').focus()`);
      for (let position = 0; position < state.links.length; position++) {
        const focus = await evaluate(client, `(async () => {
          const deadline=performance.now()+2000; let state;
          do { const a=document.activeElement,r=a.getBoundingClientRect(),style=getComputedStyle(a);
            state={inPanel:!!a.closest('.service-next-steps'),text:a.textContent.trim(),outline:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),visible:r.top>=0&&r.bottom<=innerHeight};
            if(state.visible) return state; await new Promise(resolve=>requestAnimationFrame(resolve));
          } while(performance.now()<deadline); return state;
        })()`);
        if (!focus.inPanel || focus.text !== state.links[position].text || !focus.visible || position > 0 && (focus.outline === 'none' || focus.outlineWidth < 2)) throw new Error(`Contact keyboard order failed: ${JSON.stringify({width,position,focus})}`);
        await client.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        await client.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      }
      evidence.push({width,...state});
    }
  }
  await writeFile('qa-screenshots/service-contact.json', JSON.stringify(evidence, null, 2));
  console.log(`Service contact QA passed: ${evidence.length} cases, exact provider/source/phone routes, warning precedence, wrapping, targets and keyboard order.`);
}
