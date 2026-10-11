import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertFlingProof } from "../scripts/qa-globe-interruptions.mjs";

const fixture=()=>({release:{type:'touchend',trusted:true,touches:0,at:100,scrollY:200},samples:[{at:116,scrollY:208},{at:133,scrollY:216}],start:{type:'touchstart',trusted:true,target:'globeCanvas',touches:1,at:140,scrollY:218}});
test('native fling proof requires motion after all fingers lift and an immediate canvas touch',()=>assert.doesNotThrow(()=>assertFlingProof(fixture())));
test('settled scrolling, held fingers, stale samples and synthetic events cannot pass as a fling interruption',()=>{
  const invalid=[
    f=>f.release.trusted=false,f=>f.release.touches=1,f=>f.release.type='touchcancel',
    f=>f.samples=[],f=>f.samples[0].at=90,f=>f.samples[1].at=116,
    f=>{f.samples[1].at=1450;f.start.at=1455;},
    f=>f.samples[1].scrollY=208,f=>f.release.scrollY=210,f=>f.samples[1].scrollY=NaN,
    f=>f.start.trusted=false,f=>f.start.target='zoomIn',f=>f.start.touches=2,
    f=>f.start.at=500,f=>f.start.at=120,f=>{f.start.at=282;f.start.scrollY=216;},
    f=>f.start.scrollY=210,f=>f.start.scrollY=NaN
  ];
  for(const mutate of invalid){const proof=fixture();mutate(proof);assert.throws(()=>assertFlingProof(proof));}
});
test('interruption QA uses native input without changing page scroll policy or weakening settled QA',async()=>{
  const source=await readFile(new URL('../scripts/qa-globe-interruptions.mjs',import.meta.url),'utf8');
  assert.match(source,/client\.call\("Input.dispatchTouchEvent", \{ type, touchPoints: points \}\)/);
  assert.match(source,/await verticalSwipe\(geometry.point\)/);
  assert.match(source,/assertFlingProof\(\{release:proof.release,samples:start\?\.flingSamples,start\}\)/);
  assert.match(source,/Math\.abs\(pageDrift\)<=18/);
  assert.doesNotMatch(source,/\.dispatchEvent\(|\.preventDefault\(|\.style\.(touchAction|overflow)|scrollTo\(/);
  const runner=await readFile(new URL('../scripts/browser-globe-touch-v4.mjs',import.meta.url),'utf8');
  assert.match(runner,/await verifyGlobeInterruptions\(\{ client, evaluate, canvasGeometry, sleep, observations \}\)/);
  assert.match(runner,/Math\.abs\(horizontalEnd\.scrollY - horizontal\.scrollY\) > 18/);
});
