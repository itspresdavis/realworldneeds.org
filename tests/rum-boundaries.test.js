import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/rum.js';
import {errorName, startTelemetry} from '../src/telemetry.js';

const request=(body,overrides={})=>({method:'POST',headers:{host:'www.realworldneeds.org',origin:'https://www.realworldneeds.org','content-type':'application/json'},body,...overrides});
async function invoke(req){const headers={};const res={setHeader:(key,value)=>headers[key]=value,end:()=>{}};await handler(req,res);return{status:res.statusCode,headers};}

test('diagnostic logging drops arbitrary exception text, URLs, location, query and legacy false INP',async t=>{
  const logged=[];t.mock.method(console,'log',value=>logged.push(JSON.parse(value)));
  const result=await invoke(request({type:'client_error',route:'service',viewportClass:'small',errorName:'private@example.org',file:'secret-token.js',query:'shelter tonight',lat:42.36,saved:['private-id'],inp:123,cls:0.1}));
  assert.equal(result.status,204);assert.match(result.headers['Cache-Control'],/no-store/);
  assert.equal(logged.length,1);const event=logged[0];
  assert.equal(event.errorName,null);assert.equal(event.lcp,null);
  for(const key of ['file','query','lat','saved','inp','cls'])assert.equal(key in event,false,key);
  assert.equal(JSON.stringify(event).includes('private'),false);
  assert.equal(errorName({name:'alice@example.org'}),'UnknownError');assert.equal(errorName(new TypeError('sensitive message')),'TypeError');
});
test('real streamed, lazy-parsed, oversized and malformed diagnostic bodies return client errors',async()=>{
  assert.equal((await invoke(request('{'))).status,400);
  const lazy=request(undefined);Object.defineProperty(lazy,'body',{get(){const e=new Error('Invalid JSON');e.statusCode=400;throw e;}});
  assert.equal((await invoke(lazy)).status,400);
  const stream=request(undefined);stream[Symbol.asyncIterator]=async function*(){yield Buffer.from('{"type":"client_error","note":"');yield Buffer.alloc(13000,97);};
  assert.equal((await invoke(stream)).status,413);
  assert.equal((await invoke(request({type:'client_error',note:'a'.repeat(4100)}))).status,413);
});
test('diagnostic origins cannot select arbitrary hosts or bypass content type and method guards',async()=>{
  const req=request({type:'performance'});req.headers.origin='https://attacker.example';assert.equal((await invoke(req)).status,403);
  req.headers.host='attacker.example';assert.equal((await invoke(req)).status,403);
  req.headers={host:'www.realworldneeds.org'};assert.equal((await invoke(req)).status,403);
  const type=request({type:'performance'});type.headers['content-type']='text/plain';assert.equal((await invoke(type)).status,415);
  assert.equal((await invoke(request({}, {method:'GET'}))).status,405);
});
test('global privacy control prevents diagnostic observers and transmission',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{globalPrivacyControl:true}});
  try { assert.doesNotThrow(()=>startTelemetry()); }
  finally { Object.defineProperty(globalThis,'navigator',previous); }
});
