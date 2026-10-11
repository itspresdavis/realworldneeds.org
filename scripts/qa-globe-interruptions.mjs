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

export async function verifyGlobeInterruptions({ client, evaluate, canvasGeometry, sleep, observations }) {
  const call = (expression) => evaluate(client, expression);
  const point = (x, y) => ({ x, y, id: 0, radiusX: 8, radiusY: 8, force: 1 });
  const touch = (type, points = []) => client.call("Input.dispatchTouchEvent", { type, touchPoints: points });
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
          touches:event.touches?.length,cancelable:event.cancelable,prevented:event.defaultPrevented};
        if(type==='touchstart' && data.activeProof) {
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
      await client.call("Input.synthesizeScrollGesture", {
        x:geometry.point.x,y:geometry.point.y,yDistance:-96,speed:800,
        gestureSourceType:"touch",preventFling:false
      });
      const proof = await call(`new Promise((resolve,reject)=>{
        const release=window.__rwnInterruptions.events.findLast(e=>e.phase==='fling-${cycle}' && e.type==='touchend');
        const samples=[];let expired=false,ready=false;
        const record={phase:'fling-${cycle}',release,samples,stop:()=>{expired=true;clearTimeout(deadline);}};
        (window.__rwnInterruptions.flingProofs ||= []).push(record);
        window.__rwnInterruptions.activeProof=record;
        const deadline=setTimeout(()=>{expired=true;reject(new Error('Native fling precondition could not be established'));},1500);
        const sample=()=>{
          if(expired)return;
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
      })`);
      check(proof.point, "Moving globe has no safe native touch target", proof);
      // No extra CDP round trip between the final moving sample and new input.
      // The first touch's observed time is checked below.
      await touch("touchStart", [point(proof.point.x, proof.point.y)]);
      const trace = await events();
      const start = trace.findLast(event => event.type === "touchstart");
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
    await client.call('Input.synthesizeScrollGesture',{x:leave.x,y:leave.y,yDistance:-240,speed:1800,gestureSourceType:'touch',preventFling:false});
    await sleep(1400);
    const outside=await state();
    check(outside.canvasBottom<=0 && !outside.moving,'Native page fling did not leave the globe cleanly outside the viewport',outside);
    observations.interruptions.leaveViewport={canvasBottom:outside.canvasBottom,scrollY:outside.scrollY};
    observations.interruptions.afterReturn=await rotate((await canvasGeometry(client)).point,'after-return');
    observations.interruptions.events=await events();
    console.log(`Globe native interruption evidence: ${JSON.stringify(observations.interruptions)}`);
  } finally {
    observations.interruptions.events=await events();
    observations.interruptions.flingProofs=await call('window.__rwnInterruptions.flingProofs || []');
    await call('window.__rwnInterruptions.activeProof?.stop();window.__rwnInterruptions.controller.abort()');
  }
}
