import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectoryStartupNavigationError } from './qa-directory-startup.mjs';

// CI-only coverage using the already-running browser. No new browser or service.
export const SAVED_RETURN_WIDTHS = [320, 508, 1180];
export function savedReturnSnapshot() {
  const box = node => {
    const r = node?.getBoundingClientRect();
    return r ? { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height } : null;
  };
  const visible = node => Boolean(node && !node.hidden && box(node).width && box(node).height && getComputedStyle(node).display !== 'none');
  const saved = document.querySelector('.header-action');
  const header = saved?.closest('header');
  const neighbors = header ? [...header.children].filter(node => node !== saved && visible(node)).map(box) : [];
  const panel = document.querySelector('[data-saved-services]');
  const focus = document.activeElement;
  return {
    path:location.pathname, hash:location.hash, title:document.title, width:innerWidth, height:innerHeight, scroll:scrollY,
    headingBox:box(document.querySelector('#saved-services-heading')),headerBottom:document.querySelector('.legal-header')?.getBoundingClientRect().bottom || 0,
    overflow:document.documentElement.scrollWidth > innerWidth + 1,
    savedEntry: saved ? { text:saved.textContent.trim(), href:saved.getAttribute('href'), visible:visible(saved), box:box(saved),
      focused:focus === saved, focusVisible:saved.matches(':focus-visible'), neighbors } : null,
    savedVisible:visible(panel), empty:visible(document.querySelector('[data-saved-empty]')),
    summary:document.querySelector('[data-saved-summary]')?.textContent,
    privacy:document.querySelector('.saved-services__privacy')?.textContent,
    rows:[...document.querySelectorAll('[data-saved-id]')].map(node => ({id:node.dataset.savedId,text:node.textContent})),
    current:[...document.querySelectorAll('.legal-header nav a[aria-current]')].map(node => ({href:node.getAttribute('href'),value:node.getAttribute('aria-current')})),
    focus:{id:focus?.id,href:focus?.getAttribute('href'),remove:focus?.hasAttribute('data-saved-remove'),save:focus?.hasAttribute('data-service-save')},
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    overlay:Boolean(document.querySelector('vite-error-overlay,nextjs-portal,#webpack-dev-server-client-overlay'))
  };
}
export function homeSavedViolations(s) {
  const e=s?.savedEntry, b=e?.box, issues=[];
  if (!s || s.path !== '/' || s.overlay || s.overflow) issues.push('home-identity-or-overflow');
  if (!e?.visible || e.text !== 'Saved' || e.href !== '/directory#saved' || !b || b.width < 44 || b.height < 44) issues.push('visible-saved-target');
  if (b && (b.left < 3 || b.right > s.width-3 || b.top < 3)) issues.push('saved-focus-clearance');
  for (const other of e?.neighbors || []) if (b && b.left < other.right-1 && b.right > other.left+1 && b.top < other.bottom-1 && b.bottom > other.top+1) issues.push('header-overlap');
  return issues;
}
export function savedViewViolations(s, ids=[]) {
  const issues=[];
  if (!s || s.hash !== '#saved' || !s.savedVisible || s.overlay || s.overflow || s.title !== 'Saved services | Real World Needs') issues.push('saved-identity-or-overflow');
  if (s?.empty !== (ids.length === 0)) issues.push('empty-state');
  if (JSON.stringify(s?.rows.map(row=>row.id)) !== JSON.stringify(ids)) issues.push('saved-identity');
  if (s?.current.length !== 2 || s.current.some(link=>link.href !== '/directory#saved' || link.value !== 'page')) issues.push('current-navigation');
  if (!s?.privacy?.includes('Only in this browser, on this device') || !s.privacy.includes('Anyone using this browser can see your list') || !s.privacy.includes('does not reserve a service or confirm availability')) issues.push('privacy');
  return issues;
}
export function savedFocusViolations(s) {
  const b=s?.headingBox;
  return !b || s.focus?.id !== 'saved-services-heading' || b.height <= 0 || b.top < s.headerBottom+6 || b.bottom > s.height-6
    ? ['saved-heading-focus-not-visible'] : [];
}
export function directoryReturnViolations(s, expected) {
  return !s || s.path !== '/directory' || s.hash !== '#directory-results' || s.savedVisible || s.overflow || s.overlay
    || s.title !== expected.title || JSON.stringify(s.current) !== JSON.stringify(expected.current)
    ? ['directory-restoration'] : [];
}
export async function waitForSavedReturnDestination({ sample, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), now=Date.now, timeoutMs=10000 }) {
  const start=now();
  while(now()-start<timeoutMs){
    try { if(await sample())return; }
    catch(error){if(!isDirectoryStartupNavigationError(error))throw error;}
    await wait(100);
  }
  throw new Error('Saved return destination did not settle');
}
export async function verifySavedReturnBrand({client,host,navigate,evaluate,capture,waitForUI,record,qaDir='qa-screenshots'}) {
  const evidence=[];
  const assert=(condition,message,data)=>{if(!condition)throw new Error(`${message}: ${JSON.stringify(data)}`);};
  const snapshot=()=>evaluate(client,`(${savedReturnSnapshot.toString()})()`);
  const destination=expression=>waitForSavedReturnDestination({sample:()=>evaluate(client,expression)});
  const key=async(key,code=key,value=key==='Tab'?9:13)=>{
    await client.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:value,nativeVirtualKeyCode:value});
    await client.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:value,nativeVirtualKeyCode:value});
  };
  const tabTo=async selector=>{
    for(let i=0;i<80;i++){
      await key('Tab');
      if(await evaluate(client,`document.activeElement?.matches(${JSON.stringify(selector)})`))return;
    }
    throw new Error(`Keyboard could not reach ${selector}`);
  };
  await navigate(client,`${host}/directory`);
  const directoryBaseline=await snapshot();
  assert(directoryBaseline.current.length===2 && directoryBaseline.current.every(link=>link.href==='/directory' && link.value==='page'),'Missing directory navigation baseline',directoryBaseline);
  for(const width of SAVED_RETURN_WIDTHS){
    await client.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await client.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:width===320?'reduce':'no-preference'}]});
    // Isolated CI profile only. Every save and removal below is a trusted key action.
    await evaluate(client,"localStorage.removeItem('rwn-saved-resources')");
    await navigate(client,`${host}/`);
    await waitForUI("document.querySelector('.header-action')?.getAttribute('href') === '/directory#saved'");
    await tabTo('.header-action');
    let state=await snapshot();
    assert(homeSavedViolations(state).length===0,'Homepage Saved layout failed',{width,issues:homeSavedViolations(state),state});
    assert(state.savedEntry.focused && state.savedEntry.focusVisible,'Homepage Saved lacks keyboard focus',state);
    assert(state.reduced===(width===320),'Reduced-motion preference lost',state);
    await capture(client,`saved-return-home-${width}.png`);
    evidence.push({width,state,stage:'home-keyboard-entry'});
    await key('Enter');
    await destination("location.pathname === '/directory' && location.hash === '#saved' && document.querySelector('[data-saved-empty]')?.hidden === false");
    state=await snapshot();
    assert(savedViewViolations(state).length===0,'Empty Saved layout failed',{width,issues:savedViewViolations(state),state});
    assert(savedFocusViolations(state).length===0,'Direct Saved entry lost visible heading focus',state);
    await capture(client,`saved-return-empty-${width}.png`);
    evidence.push({width,state,stage:'empty'});
    await tabTo('.saved-services__empty a');
    await key('Enter');
    await waitForUI("location.hash === '#directory-results' && !document.querySelector('.has-saved-view')");
    state=await snapshot();
    assert(directoryReturnViolations(state,directoryBaseline).length===0,'Browse did not restore the directory exactly',state);
    const history=await client.call('Page.getNavigationHistory');
    await client.call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});
    await waitForUI("location.hash === '#saved' && document.querySelector('.has-saved-view')");
    state=await snapshot();
    assert(savedViewViolations(state).length===0 && savedFocusViolations(state).length===0,'Browser Back did not restore Saved with visible focus',state);
    await client.call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex].id});
    await waitForUI("location.hash === '#directory-results' && !document.querySelector('.has-saved-view')");
    state=await snapshot();
    assert(directoryReturnViolations(state,directoryBaseline).length===0,'Browser Forward did not restore the directory exactly',state);
    evidence.push({width,state,stage:'forward-restored'});
    await navigate(client,`${host}/service/${encodeURIComponent(record.id)}`);
    await waitForUI("document.querySelector('[data-service-save]') && !document.querySelector('[data-service-save]').disabled");
    await tabTo('[data-service-save]');
    await key('Enter');
    await waitForUI("document.querySelector('[data-service-save]').getAttribute('aria-pressed') === 'true'");
    assert(await evaluate(client,"document.activeElement.matches('[data-service-save]')"),'First save lost keyboard focus',{width});
    await tabTo('.service-save-actions a');
    await key('Enter');
    await destination("location.pathname === '/directory' && location.hash === '#saved' && document.querySelectorAll('[data-saved-id]').length === 1");
    state=await snapshot();
    assert(savedViewViolations(state,[record.id]).length===0,'Populated Saved layout failed',{width,issues:savedViewViolations(state,[record.id]),state});
    assert(savedFocusViolations(state).length===0,'First-save return lost visible heading focus',state);
    assert(state.rows[0].text.includes(record.name)&&state.rows[0].text.includes(record.checked),'Saved contact or source review date disappeared',state);
    await capture(client,`saved-return-populated-${width}.png`);
    evidence.push({width,state,stage:'first-save-return'});
    await tabTo('[data-saved-remove]');
    await key('Enter');
    await waitForUI("document.querySelectorAll('[data-saved-id]').length === 0 && document.querySelector('[data-saved-empty]').hidden === false");
    state=await snapshot();
    assert(savedViewViolations(state).length===0 && savedFocusViolations(state).length===0,'Final removal lost empty state or focus',state);
    evidence.push({width,state,stage:'last-removal'});
  }
  await client.call('Emulation.setEmulatedMedia',{features:[]});
  await mkdir(qaDir,{recursive:true});
  await writeFile(join(qaDir,'saved-return-brand.json'),JSON.stringify(evidence,null,2)+'\n');
}
