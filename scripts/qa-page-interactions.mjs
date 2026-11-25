import { mkdir, writeFile } from "node:fs/promises";
import { resources } from "../src/data/resources.js";
import { waitForScrollStability } from "./qa-scroll-stability.mjs";
import { installSkipLinkWitness, withSkipLinkEvidence } from "./qa-skip-link-evidence.mjs";
import { readInspectorReadiness, waitForInspectorReady } from "./qa-focus-continuity.mjs";

// Reviewed against bowery.org/get-help/: meals at Bowery, shelter intake at
// Tribeca. Keep this independent of the production action generator.
export const reviewedBoweryActions = [
  {label:'Directions to meal service',destination:'227 Bowery, New York, NY 10002'},
  {label:'Shelter intake details'},
  {label:'Directions to shelter intake',destination:'90 Lafayette Street, New York, NY 10013'},
  {label:'Showers and clothing details'},
  {label:'Mobile medical care details'},
];

export function hasReviewedBoweryActions({actions, generic}) {
  return generic === 0 && actions.length === reviewedBoweryActions.length && reviewedBoweryActions.every((expected,index) => {
    const actual = actions[index];
    if (actual.label !== expected.label) return false;
    if (!expected.destination) return actual.href === 'https://www.bowery.org/get-help/';
    try {
      const url = new URL(actual.href);
      return url.origin === 'https://www.google.com' && url.pathname === '/maps/dir/' && url.searchParams.get('destination') === expected.destination;
    } catch { return false; }
  });
}

export function hasIntermediateScrollSample(start, end, samples) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end-start)<=2) return false;
  const low = Math.min(start,end) + 1, high = Math.max(start,end) - 1;
  return samples.some(value => Number.isFinite(value) && value > low && value < high);
}

// Native fragment alignment accounts for scroll-padding and the target's
// scroll-margin. Capture these inputs before Enter, never from the arrival.
export function skipLinkDestination(prepared) {
  const { finderDocumentTop, scrollHeight, clientHeight } = prepared;
  const padding = parseFloat(prepared.clearance), margin = parseFloat(prepared.finderMargin);
  if (![finderDocumentTop, scrollHeight, clientHeight, padding, margin].every(Number.isFinite)) {
    throw new Error('Skip-link destination geometry is unavailable');
  }
  const y = Math.max(0, Math.min(scrollHeight - clientHeight, finderDocumentTop - padding - margin));
  return { y, target: finderDocumentTop - y, clearance: padding, margin };
}

export function hasImmediateSkipLinkArrival(actual, expected) {
  return [actual.y, actual.target, actual.header, actual.clearance].every(Number.isFinite)
    && Math.abs(actual.y - expected.y) <= 1 && Math.abs(actual.target - expected.target) <= 1
    && actual.target >= actual.header && actual.clearance === expected.clearance
    && actual.hash === '#finder' && actual.active === 'finder'
    && actual.smooth === 'auto' && actual.overflow === false;
}

// Native browser input and rendered geometry, rather than source-string claims.
// Runs in existing CI Chrome; this is not a physical mobile-device benchmark.
export async function verifyPageInteractions({ client, host, navigate, evaluate, capture }) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evidence = [];
  let completed = false;
  const loadHome = async () => {
    // A hash-only navigation can retain the old observer and history state.
    await navigate(client, "about:blank");
    await navigate(client, `${host}/`);
  };
  const inspect = () => evaluate(client, `(() => {
    const header = document.querySelector('.site-header').getBoundingClientRect();
    const target = document.querySelector(location.hash || '#finder');
    return {hash:location.hash,y:scrollY,active:document.activeElement.id,header:header.bottom,target:target?.getBoundingClientRect().top,clearance:parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),smooth:getComputedStyle(document.documentElement).scrollBehavior,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};
  })()`);
  const settle = (timeoutMs = 5000) => waitForScrollStability({ sample: () => evaluate(client, '({scrollY,scrollX})'), wait, timeoutMs });
  const arrive = async (condition, label, read = inspect, settlePage = true) => {
    const started = Date.now(), deadline = started + 6000;
    const record = {label, trace:[]};
    evidence.push(record);
    const withinDeadline = async operation => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`${label} exceeded its 6000ms arrival deadline`);
      let timer;
      try {
        const result = await Promise.race([
          operation(remaining),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded its 6000ms arrival deadline`)), remaining); })
        ]);
        if (Date.now() >= deadline) throw new Error(`${label} exceeded its 6000ms arrival deadline`);
        return result;
      } finally { clearTimeout(timer); }
    };
    try {
      while (Date.now() < deadline) {
        const state = await withinDeadline(read);
        record.trace.push({elapsed:Date.now()-started, ...state});
        if (condition(state)) {
          if (settlePage) record.stability = await withinDeadline(settle);
          return await withinDeadline(read);
        }
        await wait(Math.min(50, Math.max(0, deadline-Date.now())));
      }
      throw new Error(`${label} did not reach its destination`);
    } catch (error) {
      record.failed = true;
      record.error = error.message;
      throw new Error(`${error.message}: ${JSON.stringify(record.trace)}`, {cause:error});
    }
  };
  const click = async selector => {
    const point = await evaluate(client, `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await client.call('Input.dispatchMouseEvent', { type:'mousePressed',button:'left',clickCount:1,...point });
    await client.call('Input.dispatchMouseEvent', { type:'mouseReleased',button:'left',clickCount:1,...point });
  };
  const assert = (condition, message, state) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(state)}`); };
  const controlContrast = selectors => evaluate(client, `(() => {
    const rgba = value => { const parts=value.match(/[0-9.]+/g).map(Number); return [...parts.slice(0,3),parts[3]??1]; };
    const blend = (front,back) => front.slice(0,3).map((value,index)=>value*front[3]+back[index]*(1-front[3]));
    const luminance = rgb => rgb.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    return [...document.querySelectorAll(${JSON.stringify(selectors)})].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!el.disabled).map(el=>{
      const style=getComputedStyle(el), ancestors=[];
      for(let node=el;node;node=node.parentElement)ancestors.unshift(node);
      let background=[255,255,255];
      for(const node of ancestors)background=blend(rgba(getComputedStyle(node).backgroundColor),background);
      const foreground=blend(rgba(style.color),background),levels=[luminance(foreground),luminance(background)].sort((a,b)=>a-b);
      const box=el.getBoundingClientRect();
      return {id:el.id,w:box.width,h:box.height,focusVisible:el.matches(':focus-visible'),hovered:el.matches(':hover'),text:el.textContent.trim()||el.getAttribute('aria-label'),color:style.color,background,opacity:style.opacity,outlineOffset:parseFloat(style.outlineOffset),outlineWidth:parseFloat(style.outlineWidth),fontSize:parseFloat(style.fontSize),ratio:(levels[1]+.05)/(levels[0]+.05)};
    });
  })()`);
  const keyboardFocus = async selector => {
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
    for(const modifiers of [8,0]) {
      await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers});
      await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers});
    }
    assert(await evaluate(client, `document.activeElement===document.querySelector(${JSON.stringify(selector)})&&document.activeElement.matches(':focus-visible')`), 'Native keyboard did not return visible focus to '+selector);
  };
  const observeArrivals = () => evaluate(client, `(() => {
    window.__rwnArrivals=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      const animation=original.call(this,frames,options);
      if(this.matches('.about-rwn__heading h2, .source-band__heading h2, .mission-steps article, .principle-grid article')) {
        const record={target:this.matches('#about h2')?'about-heading':this.matches('#standards h2')?'standards-heading':this.tagName.toLowerCase(),text:this.textContent,frames,options,startedAt:performance.now(),finished:false,cancelled:false};
        window.__rwnArrivals.push(record);
        animation.addEventListener('finish',()=>{record.finished=true;record.finishedAt=performance.now()},{once:true});
        animation.addEventListener('cancel',()=>{record.cancelled=true;record.cancelledAt=performance.now()},{once:true});
        window.__rwnMotionReady?.();
      }
      return animation;
    };
  })()`);
  const enhancementReady = () => arrive(state=>state.ready==='ready', 'Editorial enhancement installation', () => evaluate(client, `({ready:document.documentElement.dataset.pageInteractions,y:scrollY,visibility:document.visibilityState})`), false);
  // A quiet offset or even rAF delivery cannot establish that the independent
  // IntersectionObserver task source has delivered an entry. Passive witnesses
  // use the production threshold/margin and require newer exit/entry records.
  const readIntersection = selector => () => evaluate(client, `(() => {
    const selector=${JSON.stringify(selector)};
    window.__rwnIntersectionWitnesses??={};
    let witness=window.__rwnIntersectionWitnesses[selector];
    if(!witness){
      witness=window.__rwnIntersectionWitnesses[selector]={entries:[]};
      witness.observer=new IntersectionObserver(entries=>{
        for(const entry of entries)witness.entries.push({sequence:witness.entries.length+1,intersecting:entry.isIntersecting,at:performance.now(),top:entry.boundingClientRect.top});
      },{threshold:0,rootMargin:'0px 0px -24px 0px'});
      witness.observer.observe(document.querySelector(selector));
    }
    return {entries:witness.entries,latest:witness.entries.at(-1),y:scrollY,visibility:document.visibilityState};
  })()`);
  const enterAbout = () => evaluate(client, `scrollTo({top:document.querySelector('#about h2').getBoundingClientRect().top+scrollY-innerHeight+160,behavior:'instant'})`);

  try {
    for (const width of [320, 390, 1180]) {
      await client.call('Emulation.setDeviceMetricsOverride', {width,height:844,deviceScaleFactor:1,mobile:false});
      await client.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await loadHome();
      await client.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await client.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      const firstTab = await evaluate(client, `(() => {
        const link=document.querySelector('.skip-link'),box=link.getBoundingClientRect();
        return {focused:document.activeElement===link,top:box.top,bottom:box.bottom,painted:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('.skip-link')===link};
      })()`);
      assert(firstTab.focused && firstTab.top>=0 && firstTab.bottom<=844 && firstTab.painted, 'First-Tab skip link is offscreen or painted behind the header', firstTab);
      await capture(client, `page-interactions-skip-focus-${width}.png`);
      // Fresh navigation already owns an empty, all-services state. Do not
      // trigger redundant Clear/All actions (and software-GPU redraws) here.
      const fresh=await evaluate(client, `({query:document.querySelector('#resourceSearch').value,all:document.querySelector('.quick-need--all').getAttribute('aria-pressed'),y:scrollY,hash:location.hash})`);
      assert(fresh.query===''&&fresh.all==='true'&&fresh.y<=1&&fresh.hash==='', 'Fresh native navigation did not start from the default finder', fresh);
      // First-Tab/cold content was already checked and captured. Measure smooth
      // travel on a settled interactive page after actual frame delivery, not
      // merely a quiet scroll offset while the software GPU is still warming.
      const readFrames=()=>evaluate(client, `(() => {if(!window.__rwnFrameReady){window.__rwnFrameReady={frames:[],done:false};const frame=at=>{window.__rwnFrameReady.frames.push({at,observed:performance.now(),visibility:document.visibilityState});if(window.__rwnFrameReady.frames.length<4)requestAnimationFrame(frame);else window.__rwnFrameReady.done=true;};requestAnimationFrame(frame);}return window.__rwnFrameReady;})()`);
      const frameReady=await arrive(state=>state.done,'Frame delivery readiness at '+width+'px',readFrames,false);
      assert(frameReady.frames.length===4&&frameReady.frames.every((frame,index)=>Number.isFinite(frame.at)&&frame.visibility==='visible'&&(!index||frame.at>frameReady.frames[index-1].at)), 'Frame readiness did not observe four distinct visible rendering opportunities', frameReady);
      await evaluate(client, `window.__rwnScrollSamples=[]; window.addEventListener('scroll',()=>{if(window.__rwnScrollSamples.length<180)window.__rwnScrollSamples.push(scrollY)},{passive:true});`);
      await settle();
      const initial = await inspect();
      await evaluate(client, 'window.__rwnScrollSamples=[]');
      await click('#jumpResults');
      const arrived = await arrive(state=>state.hash==='#results'&&state.target>=state.header+10&&state.target<=state.header+15, `Results travel at ${width}px`);
      const samples = await evaluate(client, 'window.__rwnScrollSamples');
      evidence.push({label:`Native anchor at ${width}px`,initial,arrived,samples});
      assert(arrived.hash === '#results' && arrived.active === 'results', 'Results anchor did not move native focus/hash', arrived);
      assert(arrived.target >= arrived.header + 10 && arrived.target <= arrived.header + 15, 'Anchor clearance is missing or doubled', arrived);
      assert(arrived.smooth === 'auto' && !arrived.overflow, 'Travel policy leaked into ordinary page behavior', arrived);
      assert(hasIntermediateScrollSample(initial.y,arrived.y,samples), 'Intentional anchor travel has no observed intermediate position', {start:initial.y,end:arrived.y,samples});
      await capture(client, `page-interactions-results-${width}.png`);
      await evaluate(client, 'history.back()');
      const back = await arrive(state=>state.hash===''&&Math.abs(state.y-initial.y)<=2, `Back at ${width}px`);
      assert(back.hash === '' && Math.abs(back.y - initial.y) <= 2, 'Native Back did not restore the previous place', {initial,back});
      await evaluate(client, 'history.forward()');
      const forward = await arrive(state=>state.hash==='#results'&&Math.abs(state.y-arrived.y)<=2, `Forward at ${width}px`);
      assert(forward.hash === '#results' && Math.abs(forward.y - arrived.y) <= 2, 'Native Forward did not restore results', {arrived,forward});
      // The sticky header's brand must return to the document start from here.
      await click('.site-header .brand'); await click('.site-header .brand');
      const top = await arrive(state=>state.hash==='#top'&&state.y<=1, `Repeated brand return at ${width}px`);
      assert(top.hash === '#top' && top.y <= 1, 'Brand home link stayed pinned to the sticky header', top);
      const readSkipWitness = () => evaluate(client, 'window.__rwnSkipLinkWitness.snapshot()');
      await withSkipLinkEvidence({
        record: {label: `Keyboard skip at ${width}px`}, evidence,
        install: () => evaluate(client, `(${installSkipLinkWitness.toString()})()`),
        read: readSkipWitness,
        observeFrames: () => evaluate(client, 'window.__rwnSkipLinkWitness.observeFrames()'),
        capture: () => capture(client, `page-interactions-skip-failure-${width}.png`),
        dispose: () => evaluate(client, 'window.__rwnSkipLinkWitness?.dispose()'),
        run: async record => {
          record.prepared = await evaluate(client, `scrollTo({top:300,behavior:'instant'}); document.querySelector('.skip-link').focus({preventScroll:true}); window.__rwnSkipLinkWitness.snapshot()`);
          record.expected = skipLinkDestination(record.prepared.state);
          await client.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
          await client.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
          const skipImmediate = await inspect();
          record.immediate = skipImmediate;
          assert(hasImmediateSkipLinkArrival(skipImmediate, record.expected), 'Keyboard skip link did not arrive immediately', {expected:record.expected,actual:skipImmediate});
          await settle();
          const skipped = await inspect();
          record.settled = skipped;
          assert(hasImmediateSkipLinkArrival(skipped, record.expected), 'Keyboard skip link lost native focus or immediate scrolling', {expected:record.expected,actual:skipped});
        },
      });
    }

    await loadHome();
    await enhancementReady();
    await observeArrivals();
    const aboutIntersection=readIntersection('#about h2');
    await arrive(state=>state.latest?.intersecting===false, 'About initially outside the arrival viewport', aboutIntersection, false);
    await enterAbout();
    const editorialState=()=>evaluate(client, `({arrivals:window.__rwnArrivals,transform:getComputedStyle(document.querySelector('#about h2')).transform,running:document.querySelector('#about h2').getAnimations().some(animation=>animation.playState==='running')})`);
    const editorial=await arrive(state=>state.arrivals.some(item=>item.target==='about-heading'&&item.finished&&!item.cancelled)&&state.arrivals.every(item=>item.finished&&!item.cancelled)&&state.transform==='none'&&!state.running, 'Actual editorial start and finish events', editorialState, false);
    const arrivals=editorial.arrivals;
    assert(arrivals.length > 0 && arrivals.every(item => item.frames.every(frame=>frame.opacity === undefined || frame.opacity === 1) && item.options.duration <= 300 && !item.options.fill && item.finishedAt>=item.startedAt), 'Editorial arrivals were absent, hidden or unbounded', arrivals);
    const visibleAbout=await arrive(state=>state.latest?.intersecting===true, 'About initial entry delivered', aboutIntersection, false);
    await evaluate(client, `scrollTo({top:0,behavior:'instant'})`);
    const exitedAbout=await arrive(state=>state.latest?.intersecting===false&&state.latest.sequence>visibleAbout.latest.sequence, 'About exit delivered before repeat', aboutIntersection, false);
    await enterAbout();
    await arrive(state=>state.latest?.intersecting===true&&state.latest.sequence>exitedAbout.latest.sequence, 'About repeat entry delivered', aboutIntersection, false);
    const repeated=await editorialState();
    assert(repeated.arrivals.length===arrivals.length&&repeated.transform==='none'&&!repeated.running, 'Previously seen editorial text replays on repeated scrolling', repeated);
    await evaluate(client, `window.__rwnIntersectionWitnesses['#about h2'].observer.disconnect()`);
    await capture(client, 'page-interactions-editorial.png');

    // Change the live preference while a real arrival is still playing.
    // Slow the browser's actual animation clock for this one experiment so
    // scheduler stalls between the two CDP commands cannot finish the 280 ms
    // effect first. The earlier normal-speed check still verifies its duration.
    await client.call('Animation.enable');
    let running, cancelled;
    try {
      await loadHome();
      await client.call('Animation.setPlaybackRate', {playbackRate:0.01});
      await enhancementReady();
      await observeArrivals();
      let startPromise;
      const readStart=()=>startPromise??=evaluate(client, `(async () => {
        window.__rwnMotionPreference = matchMedia('(prefers-reduced-motion: reduce)');
        window.__rwnMotionPreferenceChanges = [];
        window.__rwnMotionPreference.addEventListener('change',event=>window.__rwnMotionPreferenceChanges.push({matches:event.matches,at:performance.now()}));
        let timer;
        const started=new Promise(resolve=>{
          window.__rwnMotionReady=()=>{clearTimeout(timer);resolve(true)};
          timer=setTimeout(()=>resolve(false),2000);
        });
        scrollTo({top:document.querySelector('#about h2').getBoundingClientRect().top+scrollY-innerHeight+160,behavior:'instant'});
        const observedStart=await started;
        return {started:observedStart,timeoutMs:2000,arrivals:window.__rwnArrivals,y:scrollY,count:window.__rwnArrivals.length,running:document.querySelector('#about h2').getAnimations().some(animation=>animation.playState==='running'),preference:window.__rwnMotionPreference.matches,timeline:document.timeline.currentTime,visibility:document.visibilityState,animations:document.getAnimations().map(animation=>({state:animation.playState,time:animation.currentTime,pending:animation.pending}))};
      })()`);
      running=await arrive(state=>typeof state.started==='boolean', 'Active editorial start event', readStart, false);
      assert(running.started && running.running && !running.preference, 'Preference-change test never observed an active editorial animation with motion allowed', running);
      await client.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      // The CDP override acknowledges before the browser renders and dispatches
      // MediaQueryList change/cancel events. Await those real signals; stationary
      // scrolling says nothing about whether this preference change was delivered.
      const cancellationState = () => evaluate(client, `({y:scrollY,matches:window.__rwnMotionPreference.matches,changes:window.__rwnMotionPreferenceChanges,cancelled:window.__rwnArrivals.some(item=>item.target==='about-heading'&&item.cancelled&&!item.finished),arrivals:window.__rwnArrivals,transform:getComputedStyle(document.querySelector('#about h2')).transform,visibility:document.visibilityState,timeline:document.timeline.currentTime,animations:document.getAnimations().map(animation=>({state:animation.playState,time:animation.currentTime,pending:animation.pending}))})`);
      cancelled = await arrive(state=>state.matches&&state.changes.some(event=>event.matches)&&state.cancelled&&state.transform==='none', 'Live reduced-motion event and cancellation', cancellationState, false);
    } finally {
      await client.call('Animation.setPlaybackRate', {playbackRate:1});
      await client.call('Animation.disable');
    }
    evidence.push({label:'Live reduced-motion cancellation',running,cancelled});
    assert(cancelled.cancelled && cancelled.transform==='none' && Math.abs(cancelled.y-running.y)<=1, 'Live reduced motion did not cancel in place', {running,cancelled});
    // Controlled CPU throttle is a resilience check, not a hardware speed claim.
    await client.call('Emulation.setCPUThrottlingRate', {rate:4});
    const standardsIntersection=readIntersection('#standards h2');
    const unseenStandards=await arrive(state=>state.latest?.intersecting===false, 'Reduced-motion Standards initially unseen', standardsIntersection, false);
    await evaluate(client, `document.querySelector('#standards').scrollIntoView({behavior:'instant'})`);
    await arrive(state=>state.latest?.intersecting===true&&state.latest.sequence>unseenStandards.latest.sequence, 'Reduced-motion Standards entry delivered', standardsIntersection, false);
    const reduced = await evaluate(client, `({arrivals:window.__rwnArrivals.length,opacity:getComputedStyle(document.querySelector('#standards h2')).opacity})`);
    assert(reduced.arrivals === running.count && Number(reduced.opacity) === 1, 'Reduced-motion change left unseen editorial animation enabled', reduced);
    await evaluate(client, `window.__rwnIntersectionWitnesses['#standards h2'].observer.disconnect()`);
    await evaluate(client, `scrollTo({top:0,behavior:'instant'})`); await settle();
    await click('#jumpResults');
    const reducedImmediate = await inspect();
    assert(reducedImmediate.target>=reducedImmediate.header+10 && reducedImmediate.target<=reducedImmediate.header+15, 'Reduced-motion anchor did not arrive immediately', reducedImmediate);
    await settle();
    const reducedTarget = await inspect();
    assert(reducedTarget.active === 'results' && reducedTarget.smooth === 'auto', 'Reduced-motion results navigation failed', reducedTarget);
    await client.call('Emulation.setCPUThrottlingRate', {rate:1});

    for (const [width,height] of [[320,489],[320,844],[390,568],[390,844],[900,844],[1440,844]]) {
      await client.call('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
      await loadHome();
      const controls = await evaluate(client, `(() => {
        document.querySelector('.filter-disclosure').open=true;
        document.querySelector('#clearLocation').hidden=false;
        document.querySelector('#clearSearch').hidden=false;
        const selectors='#clearSearch, .quick-need, .location-button, .location-clear, .filter-heading button, .layer-toggle, .access-switch button, .directory-tool, .outline-button--dark, .region-menu select';
        const targets=[...document.querySelectorAll(selectors)].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({text:el.textContent.trim(),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
        const location=[...document.querySelectorAll('.location-actions button')].map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height}));
        return {width:innerWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,targets,location};
      })()`);
      assert(!controls.overflow && controls.targets.every(target=>target.w>=43.5&&target.h>=43.5), 'Finder control target or reflow contract failed', controls);
      assert(controls.location.length===2 && Math.abs(controls.location[0].top-controls.location[1].top)<=1, 'Location and Clear actions unnecessarily split into two rows', controls.location);
      // Document overflow cannot reveal children clipped inside a filter list.
      const expanded = await evaluate(client, `(() => {
        document.querySelector('.finder-location-notes').open=true;
        const check = (node,container) => {
          const box=node.getBoundingClientRect(),owner=container.getBoundingClientRect();
          let visible={left:box.left,right:box.right,top:box.top,bottom:box.bottom};
          for(let parent=node.parentElement;parent;parent=parent.parentElement){
            const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
            if(/hidden|clip|auto|scroll/.test(style.overflowX)){visible.left=Math.max(visible.left,bounds.left);visible.right=Math.min(visible.right,bounds.right);}
            if(/hidden|clip|auto|scroll/.test(style.overflowY)){visible.top=Math.max(visible.top,bounds.top);visible.bottom=Math.min(visible.bottom,bounds.bottom);}
          }
          return {text:node.textContent.trim(),rendered:node.getClientRects().length>0&&box.width>0&&box.height>0&&getComputedStyle(node).visibility==='visible'&&Number(getComputedStyle(node).opacity)>0,within:box.left>=owner.left-1&&box.right<=owner.right+1&&box.top>=owner.top-1&&box.bottom<=owner.bottom+1,unclipped:visible.right-visible.left>=box.width-1&&visible.bottom-visible.top>=box.height-1,contentFits:node.scrollWidth<=node.clientWidth+1};
        };
        return ['.layer-list','.access-switch','.finder-location-notes__body'].flatMap(selector=>{
          const container=document.querySelector(selector);
          return [...container.querySelectorAll('button,button>span,button>strong,a')].map(node=>check(node,container));
        });
      })()`);
      assert(expanded.length>=39&&expanded.every(item=>item.rendered&&item.within&&item.unclipped&&item.contentFits), 'Expanded finder clips a label, count, indicator or control', expanded);
      evidence.push({label:'Expanded finder descendant bounds at '+width+'x'+height,expanded});
      // Traverse every real disclosure action using native Tab, including the
      // location explanation link, category choices and listing-type options.
      const expandedTargets = await evaluate(client, `(() => {
        const nodes=[...document.querySelectorAll('.finder-disclosures summary,.finder-disclosures button,.finder-disclosures a')].filter(node=>!node.disabled&&node.getClientRects().length);
        nodes.forEach((node,index)=>node.dataset.qaExpandedTarget=String(index));
        return nodes.map((node,index)=>({index,text:node.textContent.trim()}));
      })()`);
      await keyboardFocus('[data-qa-expanded-target="0"]');
      const reached=[];
      for(const target of expandedTargets){
        if(target.index){
          await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        }
        const readFocused=()=>evaluate(client, `(() => {
          const node=document.activeElement,style=getComputedStyle(node),header=document.querySelector('.site-header').getBoundingClientRect();
          const extent=Math.max(0,parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset));
          const fragments=[...node.getClientRects()].map(box=>{
            const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
            let ringUnclipped=box.left-extent>=0&&box.right+extent<=document.documentElement.clientWidth+1&&box.top-extent>=header.bottom&&box.bottom+extent<=innerHeight;
            for(let parent=node.parentElement;parent;parent=parent.parentElement){
              const parentStyle=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
              if(/hidden|clip|auto|scroll/.test(parentStyle.overflowX))ringUnclipped&&=box.left-extent>=bounds.left-1&&box.right+extent<=bounds.right+1;
              if(/hidden|clip|auto|scroll/.test(parentStyle.overflowY))ringUnclipped&&=box.top-extent>=bounds.top-1&&box.bottom+extent<=bounds.bottom+1;
            }
            return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height,visible:box.width>0&&box.height>0&&box.left>=0&&box.right<=document.documentElement.clientWidth+1&&box.top>=header.bottom&&box.bottom<=innerHeight,hit:node===hit||node.contains(hit),ringUnclipped};
          });
          return {index:Number(node.dataset.qaExpandedTarget),text:node.textContent.trim(),headerBottom:header.bottom,viewportHeight:innerHeight,scrollY,fragments,ring:node.matches(':focus-visible')&&parseFloat(style.outlineWidth)>=3,visible:fragments.length>0&&fragments.every(item=>item.visible),hit:fragments.some(item=>item.hit),ringUnclipped:fragments.every(item=>item.ringUnclipped)};
        })()`);
        // Focus updates before its native scroll is necessarily painted. Wait
        // for real arrival without moving the target or relaxing any bounds.
        let focused;
        try {
          focused=await arrive(state=>state.index===target.index&&state.ring&&state.visible&&state.hit&&state.ringUnclipped, 'Expanded finder keyboard target '+target.index+' at '+width+'x'+height, readFocused);
        } catch(error) {
          await capture(client,`page-interactions-expanded-focus-failure-${width}x${height}.png`);
          throw error;
        }
        assert(focused.index===target.index&&focused.ring&&focused.visible&&focused.hit&&focused.ringUnclipped, 'Keyboard cannot visibly reach an expanded finder control', {target,focused});
        reached.push(focused);
      }
      evidence.push({label:'Expanded finder keyboard reachability at '+width+'x'+height,reached});
      await evaluate(client, `document.querySelector('.finder-location-notes').open=false;document.querySelector('.finder-controls').scrollIntoView({behavior:'instant',block:'center'})`);
      await capture(client,`page-interactions-expanded-filters-${width}x${height}.png`);
      const contrast = await controlContrast('#clearSearch,.quick-need,.location-button,.location-clear,.filter-heading button,.layer-toggle,.access-switch button,.directory-tool,.outline-button--dark,.region-menu select,.layer-toggle strong,.layer-toggle.is-active .layer-toggle__check,.finder-search-label,#resourceSearch,.finder-intro h1,.finder-intro p,.finder-safety,.finder-safety strong,.globe-meta strong,.atlas-key,.atlas-key small,#jumpResults,#matchingResultCount,.globe-controls button');
      evidence.push({label:'Enabled finder control contrast at '+width+'px',contrast});
      assert(contrast.length>10&&contrast.every(item=>item.ratio>=4.5&&Number(item.opacity)===1), 'Enabled finder controls inherit unreadable light-theme text', contrast);
      assert(contrast.find(item=>item.id==='toggleAll')?.fontSize>=13, 'Filter Clear label is too small', contrast);
      await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      for (const selector of ['#clearSearch','#toggleAll','.location-privacy a']) {
        await evaluate(client, `(() => {document.querySelector('.finder-location-notes').open=true;const item=document.querySelector(${JSON.stringify(selector)});item.scrollIntoView({behavior:'instant',block:'center'});item.blur();})()`);
        const point=await evaluate(client, `(() => {const box=document.querySelector(${JSON.stringify(selector)}).getClientRects()[0];return {x:box.x+box.width/2,y:box.y+box.height/2};})()`);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
        const activeContrast=await controlContrast(selector);
        assert(activeContrast.length===1&&activeContrast[0].ratio>=4.5&&activeContrast[0].hovered, 'Focused/hovered finder action loses light-theme contrast', activeContrast);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
        await keyboardFocus(selector);
        const keyboardContrast=await controlContrast(selector);
        assert(keyboardContrast[0]?.focusVisible&&keyboardContrast[0].ratio>=4.5,'Keyboard finder action loses contrast',keyboardContrast);
        evidence.push({label:'Hover and keyboard '+selector+' at '+width+'px',hover:activeContrast,keyboard:keyboardContrast});
      }
      await evaluate(client, `document.querySelector('.finder-location-notes').open=false;document.activeElement.blur();scrollTo({top:0,behavior:'instant'})`);


      if(width === 320) {
        await capture(client,'page-interactions-controls-320.png');
        await evaluate(client, `document.querySelector('.globe-stage').scrollIntoView({behavior:'instant',block:'center'});document.querySelector('#zoomIn').focus({preventScroll:true})`);
        await client.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        await client.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        const focus = await evaluate(client, `(() => { const style=getComputedStyle(document.activeElement);return {active:document.activeElement.id,width:parseFloat(style.outlineWidth),offset:parseFloat(style.outlineOffset)}; })()`);
        assert(focus.active==='zoomOut'&&focus.width>=3&&focus.offset<=-3, 'Clipped globe group has no inset keyboard focus ring', focus);
        await capture(client,'page-interactions-globe-focus-320.png');
      }
    }

    for (const width of [320,1180]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
      await loadHome();
      await evaluate(client, `document.querySelector('#resourceSearch').focus()`);
      await client.call('Input.insertText',{text:'London'});
      const searchState=()=>evaluate(client, `({value:document.querySelector('#resourceSearch').value,matches:Number(document.querySelector('#matchingResultCount').textContent.match(/[0-9,]+/)?.[0].replaceAll(',','')),focus:document.activeElement.id,hidden:document.querySelector('#clearSearch').hidden})`);
      await arrive(state=>state.value==='London'&&state.matches>0&&state.matches<resources.length,'Populated search before Clear at '+width+'px',searchState,false);
      const clear=await evaluate(client, `({value:document.querySelector('#resourceSearch').value,buttons:[...document.querySelectorAll('.search-box button')].filter(item=>item.getClientRects().length).map(item=>({id:item.id,label:item.getAttribute('aria-label'),w:item.getBoundingClientRect().width,h:item.getBoundingClientRect().height}))})`);
      assert(clear.value==='London'&&clear.buttons.length===1&&clear.buttons[0].id==='clearSearch'&&clear.buttons[0].label==='Clear search'&&clear.buttons[0].w>=44&&clear.buttons[0].h>=44,'Populated search lacks one accessible44px Clear control',clear);
      // Source guard covers the UA cancel pseudo-element; native preview and
      // this focused populated-input screenshot verify actual duplicate paint.
      await capture(client,`page-interactions-search-clear-${width}.png`);
      await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert(await evaluate(client, `document.activeElement.id==='clearSearch'&&document.activeElement.matches(':focus-visible')`),'Keyboard missed the custom Clear control');
      await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
      await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      const cleared=await arrive(state=>state.value===''&&state.matches===resources.length,'Restored search after Clear at '+width+'px',searchState,false);
      assert(cleared.value===''&&cleared.focus==='resourceSearch'&&cleared.hidden,'Custom Clear failed or lost input focus',cleared);
      evidence.push({label:'One search Clear at '+width+'px',clear,cleared});
    }

    for (const width of [320,1440]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      await navigate(client,'about:blank');
      const bowery = resources.find(resource => resource.id === 'bowery-mission');
      await navigate(client,`${host}/#resource=${encodeURIComponent(bowery.id)}`);
      await waitForInspectorReady({id:bowery.id,name:bowery.name,read:()=>evaluate(client,`(${readInspectorReadiness.toString()})()`)});
      await evaluate(client, `document.querySelector('.panel-detail-disclosure').open=true;document.querySelector('.panel-source-note').open=true;document.querySelector('#resourcePanel').scrollIntoView({behavior:'instant',block:'start'})`);
      const selectors='.panel-source,.panel-source b,.panel-title p,.panel-precision,.panel-precision strong,.panel-facts dt,.panel-facts dd,.free-cost,.cost-scope,.panel-services h3,.panel-services li,.availability-note p,.availability-note strong,.panel-source-note p,.panel-source-note strong,#resourcePanel summary,#resourcePanel summary span,#resourcePanel button,#resourcePanel a';
      const contrast=await controlContrast(selectors);
      assert(contrast.length>15&&contrast.every(item=>item.ratio>=4.5&&Number(item.opacity)===1), 'Inspector facts or secondary controls have unreadable light-theme contrast', contrast);
      const geometry=await evaluate(client, `({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,buttons:[...document.querySelectorAll('#resourcePanel button,.panel-actions a,.panel-map-actions a')].filter(item=>item.getClientRects().length).map(item=>({id:item.id,w:item.getBoundingClientRect().width,h:item.getBoundingClientRect().height,disabled:item.disabled,opacity:getComputedStyle(item).opacity}))})`);
      assert(!geometry.overflow&&geometry.buttons.every(item=>item.w>=43.5&&item.h>=43.5), 'Inspector action targets or reflow failed', geometry);
      assert(geometry.buttons.some(item=>item.disabled&&Number(item.opacity)<1), 'Inspector disabled navigation lost its distinct state', geometry);
      evidence.push({label:'Inspector palette and targets at '+width+'px',contrast,geometry});
      await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      const access = await evaluate(client, `({actions:[...document.querySelectorAll('.panel-actions--primary a.primary-button')].map(a=>({label:a.textContent.trim(),href:a.href})),generic:document.querySelectorAll('.panel-map-actions a').length})`);
      const expectedAccess = reviewedBoweryActions.map(action=>action.label);
      assert(hasReviewedBoweryActions(access), 'Multisite inspector must retain reviewed meal and shelter destinations, intake details, and no generic maps', access);
      const serviceActionSelectors = expectedAccess.map((_,index)=>'.panel-actions--primary a.primary-button:nth-child('+(index+1)+')');
      for (const selector of ['.secondary-button','#saveResource','#shareResource','#copyAddress','#closeInspector',...serviceActionSelectors]) {
        await evaluate(client, `(() => {const item=document.querySelector(${JSON.stringify(selector)});item.scrollIntoView({behavior:'instant',block:'center'});item.blur();})()`);
        const point=await evaluate(client, `(() => {const box=document.querySelector(${JSON.stringify(selector)}).getClientRects()[0];return {x:box.x+box.width/2,y:box.y+box.height/2};})()`);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
        const activeContrast=await controlContrast(selector);
        assert(activeContrast.length>0&&activeContrast.every(item=>item.ratio>=4.5)&&activeContrast.some(item=>item.hovered), 'Hovered inspector action loses contrast', activeContrast);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
        await keyboardFocus(selector);
        const keyboardContrast=await controlContrast(selector);
        assert(keyboardContrast.some(item=>item.focusVisible)&&keyboardContrast.every(item=>item.ratio>=4.5),'Keyboard inspector action loses contrast',keyboardContrast);
        if(['#saveResource','#shareResource','#copyAddress'].includes(selector))assert(keyboardContrast.filter(item=>item.focusVisible).every(item=>item.outlineOffset<=-3),'Clipped inspector action has no inset focus ring',keyboardContrast);
        if(serviceActionSelectors.includes(selector))assert(keyboardContrast.some(item=>item.focusVisible&&item.outlineWidth>=3), 'Service action needs a visible keyboard focus ring', keyboardContrast);
        evidence.push({label:'Hover and keyboard inspector '+selector+' at '+width+'px',hover:activeContrast,keyboard:keyboardContrast});
      }
      const savedBefore=await evaluate(client, `document.querySelector('#saveResource').getAttribute('aria-pressed')`);
      if(savedBefore!=='true')await evaluate(client, `document.querySelector('#saveResource').click()`);
      assert(await evaluate(client, `document.querySelector('#saveResource').getAttribute('aria-pressed')==='true'`),'Inspector Save action did not enter the Saved state');
      const savedContrast=await controlContrast('#saveResource');
      assert(savedContrast.length===1&&savedContrast[0].ratio>=4.5, 'Saved inspector state loses contrast', savedContrast);
      if(savedBefore!=='true')await evaluate(client, `document.querySelector('#saveResource').click()`);
      assert(await evaluate(client, `document.querySelector('#saveResource').getAttribute('aria-pressed')`)===savedBefore,'Inspector Save state was not restored');
      await evaluate(client, `document.querySelector('.panel-detail-disclosure').open=true;document.querySelector('.panel-source-note').open=true;document.querySelector('.panel-facts').scrollIntoView({behavior:'instant',block:'center'})`);
      await capture(client,`page-interactions-inspector-facts-${width}.png`);
      await evaluate(client, `document.querySelector('.panel-actions').scrollIntoView({behavior:'instant',block:'center'})`);
      await capture(client,`page-interactions-inspector-actions-${width}.png`);
      // Retain the original clipped-map focus check on a genuine single-site
      // listing; Bowery intentionally no longer has this generic map group.
      const singleSite = resources.find(item=>item.kind==='direct'&&!item.serviceAccess&&Number.isFinite(item.lat)&&Number.isFinite(item.lng));
      assert(!!singleSite, 'Single-site inspector fixture is required');
      await navigate(client,'about:blank');
      await navigate(client,`${host}/#resource=${encodeURIComponent(singleSite.id)}`);
      for(const selector of ['.panel-map-actions a:first-child','.panel-map-actions a:last-child']) {
        await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'})`);
        const point=await evaluate(client, `(() => {const box=document.querySelector(${JSON.stringify(selector)}).getClientRects()[0];return {x:box.x+box.width/2,y:box.y+box.height/2};})()`);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
        const hovered=await controlContrast(selector);
        assert(hovered.length===1&&hovered[0].hovered&&hovered[0].ratio>=4.5, 'Single-site hovered maps retain readable contrast', hovered);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
        await keyboardFocus(selector);
        const focus = await controlContrast(selector);
        assert(focus.length===1&&focus[0].focusVisible&&focus[0].outlineOffset<=-3&&focus[0].ratio>=4.5, 'Single-site clipped maps retain inset visible focus and contrast', focus);
      }
    }

    await client.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await loadHome();
    const found = await evaluate(client, `(() => { const found=window.find('Before you go');const item=document.querySelector('#about h2');return {found,selected:String(getSelection()),opacity:Number(getComputedStyle(item).opacity),display:getComputedStyle(item).display}; })()`);
    assert(found.found && found.selected.includes('Before you go') && found.opacity === 1 && found.display !== 'none', 'Browser find could not reach readable editorial text', found);
    completed = true;
    console.log('Page interactions QA passed: native smooth anchors, history/focus, header clearance, once-only arrivals, live reduced motion, controlled4x CPU check, readable find targets and44px controls at four widths.');
  } finally {
    await mkdir('qa-screenshots',{recursive:true});
    await writeFile('qa-screenshots/page-interactions.json',JSON.stringify({completed,evidence},null,2));
    await client.call('Emulation.setCPUThrottlingRate', {rate:1});
    await client.call('Emulation.setEmulatedMedia', {features:[]});
  }
}
