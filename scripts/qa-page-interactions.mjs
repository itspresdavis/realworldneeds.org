import { waitForScrollStability } from "./qa-scroll-stability.mjs";

// Native browser input and rendered geometry, rather than source-string claims.
// Runs in existing CI Chrome; this is not a physical mobile-device benchmark.
export async function verifyPageInteractions({ client, host, navigate, evaluate, capture }) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const settle = () => waitForScrollStability({ sample: () => evaluate(client, '({scrollY,scrollX})'), wait });
  const click = async selector => {
    const point = await evaluate(client, `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await client.call('Input.dispatchMouseEvent', { type:'mousePressed',button:'left',clickCount:1,...point });
    await client.call('Input.dispatchMouseEvent', { type:'mouseReleased',button:'left',clickCount:1,...point });
  };
  const assert = (condition, message, state) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(state)}`); };
  const observeArrivals = () => evaluate(client, `(() => {
    window.__rwnArrivals=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      const animation=original.call(this,frames,options);
      if(this.matches('.about-rwn__heading h2, .source-band__heading h2, .mission-steps article, .principle-grid article')) {
        const record={text:this.textContent,frames,options,cancelled:false};
        window.__rwnArrivals.push(record);
        animation.addEventListener('cancel',()=>{record.cancelled=true},{once:true});
        window.__rwnMotionReady?.();
      }
      return animation;
    };
  })()`);
  const enterAbout = () => evaluate(client, `scrollTo({top:document.querySelector('#about h2').getBoundingClientRect().top+scrollY-innerHeight+160,behavior:'instant'})`);

  try {
    for (const width of [390, 1180]) {
      await client.call('Emulation.setDeviceMetricsOverride', {width,height:844,deviceScaleFactor:1,mobile:false});
      await client.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await loadHome();
      await evaluate(client, `document.querySelector('#clearSearch').click(); document.querySelector('.quick-need--all').click(); scrollTo({top:0,behavior:'instant'}); window.__rwnScrollSamples=[]; window.addEventListener('scroll',()=>{if(window.__rwnScrollSamples.length<180)window.__rwnScrollSamples.push(scrollY)},{passive:true});`);
      await settle();
      const initial = await inspect();
      await evaluate(client, 'window.__rwnScrollSamples=[]');
      await click('#jumpResults');
      await settle();
      const arrived = await inspect();
      const samples = await evaluate(client, 'window.__rwnScrollSamples');
      assert(arrived.hash === '#results' && arrived.active === 'results', 'Results anchor did not move native focus/hash', arrived);
      assert(arrived.target >= arrived.header + 10 && arrived.target <= arrived.header + 15, 'Anchor clearance is missing or doubled', arrived);
      assert(arrived.smooth === 'auto' && !arrived.overflow, 'Travel policy leaked into ordinary page behavior', arrived);
      assert(new Set(samples.map(Math.round)).size > 2, 'Intentional anchor travel jumped instead of scrolling smoothly', samples);
      await capture(client, `page-interactions-results-${width}.png`);
      await evaluate(client, 'history.back()'); await settle();
      const back = await inspect();
      assert(back.hash === '' && Math.abs(back.y - initial.y) <= 2, 'Native Back did not restore the previous place', {initial,back});
      await evaluate(client, 'history.forward()'); await settle();
      const forward = await inspect();
      assert(forward.hash === '#results' && Math.abs(forward.y - arrived.y) <= 2, 'Native Forward did not restore results', {arrived,forward});
      // The sticky header's brand must return to the document start from here.
      await click('.site-header .brand'); await click('.site-header .brand'); await settle();
      const top = await inspect();
      assert(top.hash === '#top' && top.y <= 1, 'Brand home link stayed pinned to the sticky header', top);
      await evaluate(client, `scrollTo({top:300,behavior:'instant'}); document.querySelector('.skip-link').focus({preventScroll:true})`);
      await client.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
      await client.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      const skipImmediate = await inspect();
      assert(skipImmediate.y<=1 && skipImmediate.active==='finder', 'Keyboard skip link did not arrive immediately', skipImmediate);
      await settle();
      const skipped = await inspect();
      assert(skipped.hash === '#finder' && skipped.active === 'finder' && skipped.smooth === 'auto', 'Keyboard skip link lost native focus or immediate scrolling', skipped);
    }

    await loadHome();
    await observeArrivals(); await enterAbout(); await settle();
    const arrivals = await evaluate(client, 'window.__rwnArrivals');
    assert(arrivals.length > 0 && arrivals.every(item => item.frames.every(frame=>frame.opacity === undefined || frame.opacity === 1) && item.options.duration <= 300 && !item.options.fill), 'Editorial arrivals were absent, hidden or unbounded', arrivals);
    await evaluate(client, `scrollTo({top:0,behavior:'instant'})`); await settle();
    await enterAbout(); await settle();
    assert(await evaluate(client, 'window.__rwnArrivals.length') === arrivals.length, 'Previously seen editorial text replays on repeated scrolling');
    await capture(client, 'page-interactions-editorial.png');

    // Change the live preference while a real arrival is still playing.
    await loadHome();
    await observeArrivals();
    const running = await evaluate(client, `(async () => {
      let timer;
      const started=new Promise((resolve,reject)=>{
        window.__rwnMotionReady=()=>{clearTimeout(timer);resolve()};
        timer=setTimeout(()=>reject(new Error('Editorial motion did not begin')),2000);
      });
      scrollTo({top:document.querySelector('#about h2').getBoundingClientRect().top+scrollY-innerHeight+160,behavior:'instant'});
      await started;
      return {y:scrollY,count:window.__rwnArrivals.length,running:document.getAnimations().some(animation=>animation.playState==='running')};
    })()`);
    assert(running.running, 'Preference-change test never observed an active animation', running);
    await client.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await settle();
    const cancelled = await evaluate(client, `({y:scrollY,cancelled:window.__rwnArrivals.some(item=>item.cancelled),transform:getComputedStyle(document.querySelector('#about h2')).transform})`);
    assert(cancelled.cancelled && cancelled.transform==='none' && Math.abs(cancelled.y-running.y)<=1, 'Live reduced motion did not cancel in place', {running,cancelled});
    // Controlled CPU throttle is a resilience check, not a hardware speed claim.
    await client.call('Emulation.setCPUThrottlingRate', {rate:4});
    await evaluate(client, `document.querySelector('#standards').scrollIntoView({behavior:'instant'})`); await settle();
    const reduced = await evaluate(client, `({arrivals:window.__rwnArrivals.length,opacity:getComputedStyle(document.querySelector('#standards h2')).opacity})`);
    assert(reduced.arrivals === running.count && Number(reduced.opacity) === 1, 'Reduced-motion change left unseen editorial animation enabled', reduced);
    await evaluate(client, `scrollTo({top:0,behavior:'instant'})`); await settle();
    await click('#jumpResults');
    const reducedImmediate = await inspect();
    assert(reducedImmediate.target>=reducedImmediate.header+10 && reducedImmediate.target<=reducedImmediate.header+15, 'Reduced-motion anchor did not arrive immediately', reducedImmediate);
    await settle();
    const reducedTarget = await inspect();
    assert(reducedTarget.active === 'results' && reducedTarget.smooth === 'auto', 'Reduced-motion results navigation failed', reducedTarget);
    await client.call('Emulation.setCPUThrottlingRate', {rate:1});

    for (const width of [320,390,900,1440]) {
      await client.call('Emulation.setDeviceMetricsOverride', {width,height:844,deviceScaleFactor:1,mobile:false});
      await loadHome();
      const controls = await evaluate(client, `(() => {
        document.querySelector('.filter-disclosure').open=true;
        document.querySelector('#clearLocation').hidden=false;
        const selectors='.quick-need, .location-button, .location-clear, .filter-heading button, .layer-toggle, .access-switch button, .directory-tool, .outline-button--dark, .region-menu select';
        const targets=[...document.querySelectorAll(selectors)].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({text:el.textContent.trim(),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
        const location=[...document.querySelectorAll('.location-actions button')].map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height}));
        return {width:innerWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,targets,location};
      })()`);
      assert(!controls.overflow && controls.targets.every(target=>target.w>=43.5&&target.h>=43.5), 'Finder control target or reflow contract failed', controls);
      assert(controls.location.length===2 && Math.abs(controls.location[0].top-controls.location[1].top)<=1, 'Location and Clear actions unnecessarily split into two rows', controls.location);
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

    await client.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await loadHome();
    const found = await evaluate(client, `(() => { const found=window.find('Everyone deserves a clear next step.');const item=document.querySelector('#about h2');return {found,selected:String(getSelection()),opacity:Number(getComputedStyle(item).opacity),display:getComputedStyle(item).display}; })()`);
    assert(found.found && found.selected.includes('Everyone deserves') && found.opacity === 1 && found.display !== 'none', 'Browser find could not reach readable editorial text', found);
    console.log('Page interactions QA passed: native smooth anchors, history/focus, header clearance, once-only arrivals, live reduced motion, controlled4x CPU check, readable find targets and44px controls at four widths.');
  } finally {
    await client.call('Emulation.setCPUThrottlingRate', {rate:1});
    await client.call('Emulation.setEmulatedMedia', {features:[]});
  }
}
