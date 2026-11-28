import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { SAVED_RETURN_WIDTHS, homeSavedViolations, savedViewViolations, directoryReturnViolations, waitForSavedReturnDestination, savedFocusViolations } from '../scripts/qa-saved-return-brand.mjs';
import { pressConnectivityRecoveryKey } from '../scripts/qa-connectivity-recovery.mjs';
import { verifySavedEntryViewport } from '../scripts/qa-directory-discovery.mjs';
const home=()=>({path:'/',width:320,height:900,headerBottom:0,overflow:false,overlay:false,savedEntry:{text:'Saved services',href:'/directory#saved',visible:true,box:{left:251,top:10,right:309,bottom:54,width:58,height:44},neighbors:[{left:10,top:10,right:179,bottom:54},{left:189,top:10,right:240,bottom:54}]}});
const saved=(ids=[])=>({hash:'#saved',savedVisible:true,overlay:false,overflow:false,title:'Saved services | Real World Needs',empty:!ids.length,rows:ids.map(id=>({id})),current:[1].map(()=>({href:'/directory#saved',value:'page'})),privacy:'Only in this browser, on this device. Anyone using this browser can see your list. Saving does not reserve a service or confirm availability.'});
test('Saved return CI covers exact narrow, intermediate and desktop widths',()=>assert.deepEqual(SAVED_RETURN_WIDTHS,[320,508,1180]));
test('home footer gate rejects hidden, too-small, clipped or overlapping Saved entries',()=>{
 assert.deepEqual(homeSavedViolations(home()),[]);
 for(const mutate of [s=>s.overflow=true,s=>s.path='/directory',s=>s.savedEntry.visible=false,s=>s.savedEntry.text='Browse directory',s=>s.savedEntry.href='#saved',s=>s.savedEntry.box.height=43,s=>s.savedEntry.box.right=320,s=>s.savedEntry.box.bottom=901,s=>s.headerBottom=20,s=>s.savedEntry.neighbors[1].right=265]){
  const state=home();mutate(state);assert.ok(homeSavedViolations(state).length);
 }
});
test('Saved gate requires exact row identities, privacy, active navigation, and real empty state',()=>{
 assert.deepEqual(savedViewViolations(saved()),[]);assert.deepEqual(savedViewViolations(saved(['known']),['known']),[]);
 for(const mutate of [s=>s.empty=true,s=>s.savedVisible=false,s=>s.title='Directory',s=>s.rows=[{id:'different'}],s=>s.overflow=true,s=>s.current[0].href='/directory',s=>s.current.pop(),s=>s.privacy='Saved everywhere']){
  const state=saved(['known']);mutate(state);assert.ok(savedViewViolations(state,['known']).length);
 }
});
test('rendered suite invokes the focused runner with explicit keyboard, history and screenshot evidence',async()=>{
 const helper=await readFile('scripts/qa-saved-return-brand.mjs','utf8'),runner=await readFile('scripts/browser-saved-services.mjs','utf8');
 assert.match(runner,/await verifySavedReturnBrand\(\{ client, host: HOST, navigate, evaluate, capture, waitForUI, record: records\[0\], qaDir: QA_DIR \}\)/);
 for(const phase of ['home','empty','populated'])assert.ok(helper.includes(`saved-return-${phase}-`));
 for(const evidence of ['pressConnectivityRecoveryKey','Page.getNavigationHistory','Page.navigateToHistoryEntry','prefers-reduced-motion','last-removal','first-save-return','saved-return-brand.json'])assert.ok(helper.includes(evidence));
 assert.doesNotMatch(helper,/\.click\(|\.focus\(|dispatchEvent\(|history\.(?:back|forward|pushState|replaceState)/);
 assert.match(helper,/await tabTo\('\[data-service-save\]'\);\s*await key\('Enter'\)/);
 assert.match(helper,/await tabTo\('\[data-saved-remove\]'\);\s*await key\('Enter'\)/);
});

test('directory restoration requires the exact title and original current-nav entries',()=>{
 const expected={title:'Free Essential Services Directory | Real World Needs',current:[1].map(()=>({href:'/directory',value:'page'}))};
 const state={...expected,path:'/directory',hash:'#directory-results',savedVisible:false,overflow:false,overlay:false};
 assert.deepEqual(directoryReturnViolations(state,expected),[]);
 for(const change of [{title:'Something else'},{current:[]},{current:[expected.current[0],expected.current[0]]},{current:[{href:'/directory',value:'location'}]},{savedVisible:true}])assert.ok(directoryReturnViolations({...state,...change},expected).length);
});
test('cross-document polling retries only expected execution-context loss and requires a ready destination',async()=>{
 let attempts=0,time=0;
 const result=await waitForSavedReturnDestination({sample:async()=>{attempts++;if(attempts===1)throw new Error('Runtime.evaluate: Execution context was destroyed.');return attempts===3;},wait:async ms=>{time+=ms;},now:()=>time});
 assert.equal(result,undefined);assert.equal(attempts,3);assert.equal(time,200);
 await assert.rejects(waitForSavedReturnDestination({sample:async()=>{throw new Error('TypeError: real app failure');}}),/real app failure/);
 time=0;await assert.rejects(waitForSavedReturnDestination({sample:async()=>false,wait:async ms=>{time+=ms;},now:()=>time,timeoutMs:300}),/did not settle/);
});

test('Saved focus oracle rejects a correctly focused heading behind the header or outside the viewport',()=>{
 const state={focus:{id:'saved-services-heading'},headerBottom:66,height:844,headingBox:{height:45,top:90,bottom:135}};
 assert.deepEqual(savedFocusViolations(state),[]);
 for(const change of [{headingBox:{height:45,top:-350,bottom:-305}},{headingBox:{height:45,top:55,bottom:100}},{headingBox:{height:45,top:825,bottom:870}},{focus:{id:'other'}}])assert.ok(savedFocusViolations({...state,...change}).length);
});
test('scrolled-result Saved entry rejects offscreen first focus even if later sampling would recover',async()=>{
 let sampled=false;
 await assert.rejects(verifySavedEntryViewport({initial:{saved:true,focusedId:'saved-services-heading',focusVisible:false},sample:async()=>{sampled=true;return {};}}),/offscreen heading/);
 assert.equal(sampled,false);
});
test('Saved entry must keep its initial visible focus geometry and scroll stable throughout the observation',async()=>{
 const initial={saved:true,menuOpen:false,focusedId:'saved-services-heading',focusVisible:true,scroll:120,focusBox:{top:100,bottom:145,left:20,right:290,width:270,height:45}};
 const run=async change=>{
  let time=0,count=0;
  await verifySavedEntryViewport({initial,sample:async()=>{count++;return count===6?{...initial,...change}:initial;},wait:async ms=>{time+=ms;},now:()=>time});
  assert.equal(count,10);assert.equal(time,500);
 };
 await run({});
 for(const change of [{scroll:150},{focusVisible:false},{focusedId:'other'},{menuOpen:true},{saved:false},{focusBox:{...initial.focusBox,top:110}}])await assert.rejects(run(change),/pending scroll or layout shift/);
 const source=await readFile('scripts/qa-directory-discovery.mjs','utf8');
 assert.match(source,/const savedEntry = await wait\(s => s.saved && !s.menuOpen && s.focusedId === 'saved-services-heading'/);
 assert.match(source,/await verifySavedEntryViewport\(\{ initial: savedEntry, sample: state \}\)/);
});

test('Saved journeys reuse the established native Enter and Tab protocol without divergent dispatch',async()=>{
 const source=await readFile('scripts/qa-saved-return-brand.mjs','utf8');
 assert.match(source,/import \{ pressConnectivityRecoveryKey \} from '\.\/qa-connectivity-recovery.mjs'/);
 assert.match(source,/const key=\(name,options\)=>pressConnectivityRecoveryKey\(client,name,name==='Tab'\?9:13,options\)/);
 assert.doesNotMatch(source,/Input\.dispatchKeyEvent|dispatchSavedReturnKey/);
 const calls=[],client={call:async(method,event)=>calls.push({method,...event})};
 await pressConnectivityRecoveryKey(client,'Enter',13);
 assert.deepEqual(calls,[
  {method:'Input.dispatchKeyEvent',type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'},
  {method:'Input.dispatchKeyEvent',type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13}
 ]);
 calls.length=0;await pressConnectivityRecoveryKey(client,'Tab',9);
 assert.deepEqual(calls,[
  {method:'Input.dispatchKeyEvent',type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9},
  {method:'Input.dispatchKeyEvent',type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9}
 ]);
});

test('footer reverse traversal sends native Shift+Tab on both phases',async()=>{
 const calls=[],client={call:async(method,event)=>calls.push({method,...event})};
 await pressConnectivityRecoveryKey(client,'Tab',9,{shift:true});
 assert.deepEqual(calls,['rawKeyDown','keyUp'].map(type=>({method:'Input.dispatchKeyEvent',type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8})));
 const source=await readFile('scripts/qa-saved-return-brand.mjs','utf8');
 assert.ok(source.includes(`await tabTo('.rwn-site-footer nav a[href="/directory#saved"]',{shift:true})`));
});

test('institutional browser gate requires the approved Saved label and exact destination',async()=>{
 const source=await readFile('scripts/browser-institutional.mjs','utf8');
 const condition=source.match(/if \((!desktop\.professional[^\n]+)\) \{/)[1];
 const desktop={professional:true,accessibility:true,noHorizontalOverflow:true,sidebarOverflow:'visible',scrollBehavior:'auto',panelRole:'region',panelLive:false,resultLinks:1,directActions:1,jumpResults:true,mobileTaskbar:false,finderRoute:false,headerAction:'Saved',headerActionHref:'/directory#saved',searchShortcuts:'Alt+/ Escape',motionLabel:'Resume globe rotation'};
 const rejects=state=>vm.runInNewContext(condition,{desktop:state});
 assert.equal(rejects(desktop),false);
 for(const change of [{headerAction:'Browse directory'},{headerActionHref:'/directory'},{headerActionHref:''},{headerAction:''}])assert.equal(rejects({...desktop,...change}),true);
 assert.match(source,/headerActionHref: document\.querySelector\("\.header-action"\)\?\.getAttribute\("href"\)/);
});
