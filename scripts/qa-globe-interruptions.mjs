// Native Chromium input regression, not physical-device/Safari coverage.
// A fling is only accepted after the released touch has left the browser
// scrolling on its own. Never manufacture momentum with scrollTo/DOM events.
export function assertFlingProof({ release, samples, start }) {
  if (!release?.trusted || release.type !== "touchend" || release.touches !== 0) throw new Error("Fling has no trusted, fully released touch.");
  if (!Array.isArray(samples) || samples.length < 2) throw new Error("Fling needs two post-release frame samples.");
  const [before, after] = samples.slice(-2);
  if (![release.at, release.scrollY, before.at, before.scrollY, after.at, after.scrollY].every(Number.isFinite)
    || before.at <= release.at || after.at <= before.at || after.at - before.at > 80
    || after.scrollY - before.scrollY < 1 || after.scrollY - release.scrollY < 8) {
    throw new Error("No genuine continuing post-release page fling was observed.");
  }
  if (!start?.trusted || start.type !== "touchstart" || start.target !== "globeCanvas" || start.touches !== 1
    || !Number.isFinite(start.at) || start.at < after.at || start.at - after.at > 40
    || !Number.isFinite(start.scrollY) || start.scrollY < after.scrollY) {
    throw new Error("The new native globe touch did not immediately follow the moving fling sample.");
  }
}

// Finger movement is paced by elapsed real time, not by GPU acknowledgement.
// CDP commands remain ordered on one connection and keep native timestamps.
export async function dispatchNativeVerticalSwipe({ touch, sleep, start, step = 22, delay = 28 }) {
  if(!start || !Number.isFinite(start.x) || !Number.isFinite(start.y) || start.y-step*5<12) throw new Error('Native vertical swipe would leave the device viewport.');
  const point=(x,y)=>({x,y,id:0,radiusX:8,radiusY:8,force:1});
  await touch('touchStart',[point(start.x,start.y)]);
  const pending=[];
  const queue=(type,points=[])=>pending.push((async()=>{
    try {await touch(type,points);return {ok:true};} catch(error){return {ok:false,error};}
  })());
  for(let i=1;i<=5;i++) {
    await sleep(delay);
    queue('touchMove',[point(start.x+2,start.y-i*step)]);
  }
  queue('touchEnd');
  const failed=(await Promise.all(pending)).find(result=>!result.ok);
  if(failed)throw failed.error;
}

export async function verifyGlobeInterruptions({ client, evaluate, canvasGeometry, sleep, observations }) {
  const call = (expression) => evaluate(client, expression);
  const point = (x, y) => ({ x, y, id: 0, radiusX: 8, radiusY: 8, force: 1 });
  const touch = (type, points = []) => client.call("Input.dispatchTouchEvent", { type, touchPoints: points });
  const verticalSwipe = (start, step, delay) => dispatchNativeVerticalSwipe({touch,sleep,start,step,delay});
  const pendingSwipes=[];
  const check = (ok, message, detail) => { if (!ok) throw new Error(`${message}: ${JSON.stringify(detail)}`); };
  const phase = (name) => call(`window.__rwnInterruptions.phase=${JSON.stringify(name)}`);
  const events = () => call("window.__rwnInterruptions.events");
  const state = () => call(`(() => {
    const stage=document.querySelector('.globe-stage');
    const layer=document.getElementById('pinLayer');
    const rect=document.getElementById('globeCanvas').getBoundingClientRect();
    return {scrollY,moving:stage.classList.contains('is-globe-moving'),pinOpacity:Number(getComputedStyle(layer).opacity),
      canvasBottom:rect.bottom,pins:Object.fromEntries(Array.from(layer.children).map(node=>[node.dataset.globeKey,node.style.transform]))};
  })()`);
  const stabilized = async (label) => {
    await sleep(350);
    const result = await state();
    check(!result.moving && result.pinOpacity >= .85, `${label} left unstable map targets`, result);
    return result;
  };
  const changedPins = (before, after) => Object.keys(before.pins).filter(key => after.pins[key] && before.pins[key] !== after.pins[key]).length;
  const waitForMotion = async () => {
    for(let attempt=0;attempt<20;attempt++) {
      if((await state()).moving)return;
      await sleep(50);
    }
    throw new Error('Native mouse capture never produced a rendered motion frame.');
  };
  const rotate = async (startPoint, label, cancel = false) => {
    const baseline = await state();
    await phase(label);
    await touch("touchStart", [point(startPoint.x, startPoint.y)]);
    for (let i = 1; i <= 5; i++) {
      await touch("touchMove", [point(startPoint.x + i * 20, startPoint.y + 2)]);
      await sleep(28);
    }
    const active = await state();
    await touch(cancel ? "touchCancel" : "touchEnd");
    const end = await stabilized(label);
    const trace = (await events()).filter(event => event.phase === label);
    check(trace.some(event => event.type === "touchstart" && event.trusted && event.target === "globeCanvas"), `${label} missed the canvas`, trace);
    check(active.moving && changedPins(baseline, active) > 0, `${label} did not visibly rotate the mounted markers`, {baseline,active});
    check(Math.abs(end.scrollY - baseline.scrollY) <= 18, `${label} moved the page`, {baseline,end});
    if (cancel) check(trace.some(event => event.type === "touchcancel" && event.trusted), "Browser did not deliver native touch cancellation", trace);
    return {pageDrift:end.scrollY-baseline.scrollY,changedPins:changedPins(baseline,active),cancelled:cancel};
  };

  await call(`(() => {
    const controller=new AbortController();
    window.__rwnInterruptions={phase:'setup',events:[],controller};
    for(const type of ['pointerdown','pointercancel','gotpointercapture','lostpointercapture','touchstart','touchmove','touchend','touchcancel']) {
      document.addEventListener(type,event=>{
        const data=window.__rwnInterruptions;
        const row={phase:data.phase,type,at:performance.now(),eventAt:event.timeStamp,scrollY,
          trusted:event.isTrusted,target:event.target.id || event.target.className,pointerType:event.pointerType,pointerId:event.pointerId,
          touches:event.touches?.length,x:event.touches?.[0]?.clientX,y:event.touches?.[0]?.clientY,
          cancelable:event.cancelable,prevented:event.defaultPrevented};
        if(type==='touchend' && data.activeProof && !data.activeProof.release) data.activeProof.onRelease(row);
        if(type==='touchstart' && data.activeProof?.release) {
          row.flingSamples=data.activeProof.samples.slice(-2);
          data.activeProof.stop();data.activeProof=null;
        }
        data.events.push(row);
      },{passive:true,signal:controller.signal});
    }
  })()`);
  observations.interruptions = {};
  try {
    // Each cycle must witness fresh browser-owned inertia, then use the same
    // native input backend to interrupt it. No quiet-scroll helper is allowed
    // between the fling release and this new touch.
    for (let cycle = 0; cycle < 2; cycle++) {
      const geometry = await canvasGeometry(client);
      await phase(`fling-${cycle}`);
      // Use the same native press/move/release path as the established vertical
      // scroll check. Chromium's high-level synthesizeScrollGesture produced
      // only a press/release with no movement in the verified CI environment.
      // Observe the actual release and following frames while input command
      // acknowledgements are still outstanding. Waiting for the GPU first
      // could consume the entire short browser-owned inertia window.
      await call(`window.__rwnFlingProofPromise=new Promise((resolve,reject)=>{
        const samples=[];let expired=false,ready=false;
        let deadline=setTimeout(()=>{expired=true;reject(new Error('Native vertical swipe did not release within 5 seconds'));},5000);
        const record={phase:'fling-${cycle}',release:null,samples,stop:()=>{expired=true;clearTimeout(deadline);},onRelease:release=>{
          record.release=release;clearTimeout(deadline);
          deadline=setTimeout(()=>{expired=true;reject(new Error('Native fling precondition could not be established'));},1500);
        }};
        (window.__rwnInterruptions.flingProofs ||= []).push(record);
        window.__rwnInterruptions.activeProof=record;
        const sample=()=>{
          if(expired)return;
          const release=record.release;
          if(!release){requestAnimationFrame(sample);return;}
          const current={at:performance.now(),scrollY};samples.push(current);
          const previous=samples.at(-2);
          if(!ready && release && previous && previous.at>release.at && current.scrollY-previous.scrollY>=1 && current.scrollY-release.scrollY>=8) {
            const canvas=document.getElementById('globeCanvas'),rect=canvas.getBoundingClientRect();
            const points=[];
            for(const yf of [.45,.6,.3,.75]) for(const xf of [.25,.35,.45]) {
              const x=rect.left+rect.width*xf,y=rect.top+rect.height*yf;
              if(y>120 && y<innerHeight-90 && x+100<innerWidth-12 && document.elementFromPoint(x,y)===canvas) points.push({x,y});
            }
            ready=true;resolve({release,samples,point:points[0] || null});
          }
          requestAnimationFrame(sample);
        };requestAnimationFrame(sample);
      });void window.__rwnFlingProofPromise.catch(()=>{});true`);
      const proofPending = call('window.__rwnFlingProofPromise').then(proof=>({proof}),error=>({error}));
      const swipePending=verticalSwipe(geometry.point).then(()=>null,error=>error);
      pendingSwipes.push(swipePending);
      const proofResult=await proofPending;
      if(proofResult.error)throw proofResult.error;
      const proof=proofResult.proof;
      check(proof.point, "Moving globe has no safe native touch target", proof);
      // No extra CDP round trip between the final moving sample and new input.
      // The first touch's observed time is checked below.
      await touch("touchStart", [point(proof.point.x, proof.point.y)]);
      const swipeError=await swipePending;
      if(swipeError)throw swipeError;
      const trace = await events();
      const start = trace.findLast(event => event.type === "touchstart");
      const verticalMoves=trace.filter(event=>event.phase===`fling-${cycle}` && event.type==='touchmove' && event.at<proof.release.at);
      check(verticalMoves.length>=2 && verticalMoves.every((event,index)=>event.trusted
        && Math.abs(event.x-geometry.point.x-2)<.5 && event.y<geometry.point.y
        && event.eventAt<=proof.release.eventAt && (!index || (event.y<verticalMoves[index-1].y && event.eventAt>=verticalMoves[index-1].eventAt))),
        'Native vertical input did not preserve the ordered real-time swipe',verticalMoves);
      assertFlingProof({release:proof.release,samples:start?.flingSamples,start});
      const baseline = await state();
      for(let i=1;i<=5;i++) {
        await touch("touchMove",[point(proof.point.x+i*20,proof.point.y+2)]);
        await sleep(28);
      }
      const active = await state();
      await touch(cycle ? "touchCancel" : "touchEnd");
      const end = await stabilized(`fling interruption ${cycle}`);
      const finalTrace = (await events()).filter(event=>event.phase===`fling-${cycle}`);
      const pageDrift=end.scrollY-start.scrollY;
      check(Math.abs(pageDrift)<=18,"Horizontal touch did not stop the page fling",{start,end,pageDrift});
      check(active.moving && changedPins(baseline,active)>0,"Touch during fling did not rotate the globe",{baseline,active});
      const verticalPointer=finalTrace.find(event=>event.type==='pointerdown' && event.pointerType==='touch');
      check(finalTrace.some(event=>event.type==='pointercancel' && event.trusted && event.pointerType==='touch'
        && event.pointerId===verticalPointer?.pointerId && event.at<proof.release.at),"Vertical page ownership did not produce a native pointercancel before release",finalTrace);
      if(cycle) check(finalTrace.some(event=>event.type==='touchcancel' && event.trusted),"Interrupted fling rotation did not receive touchcancel",finalTrace);
      observations.interruptions[`fling${cycle}`]={release:proof.release,samples:start.flingSamples,start,pageDrift,changedPins:changedPins(baseline,active),cancelled:Boolean(cycle)};
      const next=await canvasGeometry(client,false);
      observations.interruptions[`repeated${cycle}`]=await rotate(next.point,`repeat-${cycle}`);
    }

    const cancelGeometry=await canvasGeometry(client);
    observations.interruptions.touchCancel=await rotate(cancelGeometry.point,'cancel-rotation',true);
    observations.interruptions.afterCancel=await rotate((await canvasGeometry(client,false)).point,'after-cancel');

    // Test the real browser capture lifecycle, not a dispatched DOM event.
    const mousePoint=(await canvasGeometry(client)).point;
    await phase('lost-mouse-capture');
    await client.call('Input.dispatchMouseEvent',{type:'mousePressed',x:mousePoint.x,y:mousePoint.y,button:'left',buttons:1,clickCount:1});
    await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:mousePoint.x+65,y:mousePoint.y,button:'left',buttons:1});
    await waitForMotion();
    const capture=await call(`(() => {
      const event=window.__rwnInterruptions.events.findLast(e=>e.phase==='lost-mouse-capture' && e.type==='pointerdown');
      const stage=document.querySelector('.globe-stage');
      if(!event || !stage.hasPointerCapture(event.pointerId))return false;
      stage.releasePointerCapture(event.pointerId);return true;
    })()`);
    check(capture,'Native mouse capture was not held',await events());
    await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:mousePoint.x+70,y:mousePoint.y,button:'left',buttons:1});
    const lost=await stabilized('lost mouse capture while the button remains held');
    check((await events()).some(event=>event.phase==='lost-mouse-capture' && event.type==='lostpointercapture' && event.trusted),'Browser did not issue lostpointercapture',await events());
    await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:mousePoint.x+105,y:mousePoint.y,button:'left',buttons:1});
    const held=await stabilized('held movement after lost capture');
    check(changedPins(lost,held)===0,'Held mouse movement kept rotating after capture was lost',{lost,held});
    await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:mousePoint.x+105,y:mousePoint.y,button:'left',buttons:0,clickCount:1});
    observations.interruptions.afterLostCapture=await rotate((await canvasGeometry(client,false)).point,'after-lost-capture');

    // Leave the viewport by scrolling the actual page, then return. Coordinates
    // stay on the device; no impossible off-screen touch is injected.
    const leave=(await canvasGeometry(client)).point;
    await phase('leave-viewport');
    await verticalSwipe(leave,48,20);
    await sleep(1400);
    const outside=await state();
    check(outside.canvasBottom<=0 && !outside.moving,'Native page fling did not leave the globe cleanly outside the viewport',outside);
    observations.interruptions.leaveViewport={canvasBottom:outside.canvasBottom,scrollY:outside.scrollY};
    observations.interruptions.afterReturn=await rotate((await canvasGeometry(client)).point,'after-return');
    observations.interruptions.events=await events();
    console.log(`Globe native interruption evidence: ${JSON.stringify(observations.interruptions)}`);
  } finally {
    observations.interruptions.swipeErrors=(await Promise.all(pendingSwipes)).filter(Boolean).map(error=>String(error.message || error));
    observations.interruptions.events=await events();
    observations.interruptions.flingProofs=await call('window.__rwnInterruptions.flingProofs || []');
    await call('window.__rwnInterruptions.activeProof?.stop();window.__rwnInterruptions.controller.abort()');
  }
}
