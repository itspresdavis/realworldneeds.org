import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readInspectorReadiness, waitForInspectorReady } from '../scripts/qa-focus-continuity.mjs';

const ready = {selectedId:'beacon-houston',inspectorOpen:true,panelVisible:true,heading:'The Beacon',toastReady:true,missingControls:[]};
function fixture(states) {
  let elapsed = 0, reads = 0;
  return {
    run: () => waitForInspectorReady({id:'beacon-houston',name:'The Beacon',timeoutMs:150,
      read: async () => states[Math.min(reads++,states.length-1)], now:()=>elapsed, wait:async ms=>{elapsed+=ms;}}),
    elapsed:()=>elapsed, reads:()=>reads,
  };
}

test('ready inspector proceeds immediately without an arbitrary settling delay', async () => {
  const f = fixture([ready]);
  assert.equal(await f.run(), ready);
  assert.equal(f.elapsed(),0);
  assert.equal(f.reads(),1);
});

test('clipboard setup waits for the actual selected inspector, controls and toast', async () => {
  const f = fixture([{...ready,selectedId:null,inspectorOpen:false}, {...ready,toastReady:false,missingControls:['copyAddress']}, ready]);
  let activated = false;
  await f.run().then(()=>{activated=true;});
  assert.equal(activated,true);
  assert.equal(f.elapsed(),100);
});

for (const unavailable of [
  {selectedId:'another-listing'}, {inspectorOpen:false}, {panelVisible:false},
  {heading:'Another provider'}, {toastReady:false}, {missingControls:['shareResource']},
]) test(`unready inspector fails before interaction with diagnostic state: ${JSON.stringify(unavailable)}`, async () => {
  const f = fixture([{...ready,...unavailable}]);
  let activated = false;
  await assert.rejects(f.run().then(()=>{activated=true;}), error => {
    assert.match(error.message,/Inspector beacon-houston was not ready within 150ms/);
    assert.ok(error.message.endsWith(JSON.stringify({...ready,...unavailable})));
    return true;
  });
  assert.equal(activated,false);
  assert.equal(f.elapsed(),150);
});

test('a stalled browser read rejects within the bounded readiness operation', async () => {
  await assert.rejects(waitForInspectorReady({id:'beacon-houston',name:'The Beacon',timeoutMs:20,read:()=>new Promise(()=>{})}), /not ready within 20ms: null/);
});

test('DOM readiness requires connected visible controls inside the inspector and the live status region', () => {
  const nodes = new Map();
  const panel = {isConnected:true,hidden:false,getClientRects:()=>[{}],contains:element=>element.inside===true};
  nodes.set('resourcePanel',panel);
  nodes.set('resourcePanelHeading',{textContent:' The Beacon '});
  nodes.set('statusToast',{isConnected:true,getAttribute:name=>name==='role'?'status':'polite'});
  for (const id of ['saveResource','copyAddress','shareResource','closeInspector']) nodes.set(id,{isConnected:true,inside:true,hidden:false,disabled:false,getClientRects:()=>[{}]});
  const context = vm.createContext({document:{getElementById:id=>nodes.get(id)},history:{state:{rwnFinder:{selectedId:'beacon-houston',inspectorOpen:true}}}});
  const read = () => JSON.parse(JSON.stringify(vm.runInContext(`(${readInspectorReadiness.toString()})()`,context)));
  assert.deepEqual(read(),ready);
  nodes.get('saveResource').isConnected=false;
  nodes.get('copyAddress').disabled=true;
  nodes.get('shareResource').inside=false;
  nodes.get('closeInspector').getClientRects=()=>[];
  nodes.delete('statusToast');
  assert.deepEqual(read().missingControls,['saveResource','copyAddress','shareResource','closeInspector']);
  assert.equal(read().toastReady,false);
  panel.hidden=true;
  assert.equal(read().panelVisible,false);
});
