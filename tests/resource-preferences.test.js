import test from 'node:test';
import assert from 'node:assert/strict';
import preferences from '../api/preferences.js';
import account from '../api/account.js';
import { validatePreferences } from '../server/resource-preferences.js';
import { projectUrl } from '../server/supabase.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: Buffer.from(JSON.stringify({ alg:'HS256' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub:user.id, exp:expires })).toString('base64url') + '.fixture', refresh_token: 'fixture-refresh', expires_at:expires, expires_in:3600, token_type:'bearer', user };
const cookie = `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
const origin = 'https://www.realworldneeds.org';
function request(body, extra = {}) { return { method: body ? 'POST' : 'GET', url:'/api/preferences', body, headers:{ host:'www.realworldneeds.org', origin, 'content-type':'application/json', cookie }, ...extra }; }
function response() { return { headers:{}, setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(body){this.body=JSON.parse(body || '{}');} }; }
function setup(t, { enabled = true, anonymous = false, fail = false } = {}) {
  const prior = process.env.RWN_PERSONAL_ACCOUNTS_ENABLED;
  process.env.RWN_PERSONAL_ACCOUNTS_ENABLED = String(enabled);
  t.after(() => { if(prior===undefined) delete process.env.RWN_PERSONAL_ACCOUNTS_ENABLED; else process.env.RWN_PERSONAL_ACCOUNTS_ENABLED=prior; });
  const calls=[];
  t.mock.method(globalThis,'fetch',async (input,init={})=>{
    const url=new URL(input); calls.push({url,method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined});
    if(url.pathname==='/auth/v1/user') return Response.json({...user,is_anonymous:anonymous});
    if(url.pathname==='/rest/v1/rwn_resource_preferences') {
      if(fail) return Response.json({message:'PRIVATE DATABASE ERROR',code:'XX000'},{status:500});
      if(!init.method || init.method==='GET') return Response.json({topics:['food'],area:'Boston',consent_version:1});
      return new Response(null,{status:204});
    }
    throw new Error('Unexpected request '+url.pathname);
  });
  return calls;
}
test('preferences need explicit consent and allow only bounded broad topics and coarse places',()=>{
  assert.deepEqual(validatePreferences({topics:['health','food'],area:' Boston, United States ',consent:true}),{topics:['food','health'],area:'Boston, United States',consent_version:1});
  for(const change of [{consent:false},{topics:['diagnosis']},{topics:['food','food']},{area:'42 Main Street'},{area:'x'.repeat(81)},{area:'Boston\nUSA'},{notes:'private'}]) assert.equal(validatePreferences({topics:['food'],area:'02108',consent:true,...change}),null);
});
test('disabled accounts do not reach Auth or the database',async t=>{
  const calls=setup(t,{enabled:false}); const res=response(); await preferences(request(),res); assert.equal(res.statusCode,503); assert.equal(calls.length,0);
  const publicRes=response(); await preferences(request(undefined,{url:'/api/preferences?action=availability'}),publicRes); assert.deepEqual(publicRes.body,{enabled:false});
  const signup=response(); await account(request({action:'signup',audience:'personal',email:'fixture@example.invalid',password:'valid-fixture-password'},{url:'/api/account'}),signup); assert.equal(signup.statusCode,503); assert.equal(calls.length,0);
});
test('preferences require a confirmed nonanonymous session and reject cross-origin writes',async t=>{
  const calls=setup(t,{anonymous:true}); const res=response(); await preferences(request(),res); assert.equal(res.statusCode,401); assert.equal(calls.length,1);
  const forbidden=response(); await preferences(request({action:'clear'},{headers:{host:'www.realworldneeds.org',origin:'https://evil.invalid','content-type':'application/json'}}),forbidden); assert.equal(forbidden.statusCode,403); assert.equal(calls.length,1);
});
test('read, save and delete use the verified identity, never a caller-supplied owner',async t=>{
  const calls=setup(t);
  const read=response(); await preferences(request(),read); assert.equal(read.statusCode,200); assert.equal(read.headers['cache-control'],'private, no-store');
  const save=response(); await preferences(request({action:'save',user_id:'attacker',preferences:{topics:['food'],area:'Boston',consent:true}}),save); assert.equal(save.statusCode,200);
  const clear=response(); await preferences(request({action:'clear',user_id:'attacker'}),clear); assert.equal(clear.statusCode,200);
  const db=calls.filter(call=>call.url.pathname.startsWith('/rest/'));
  assert.equal(db.length,3); assert.equal(db[0].url.searchParams.get('user_id'),'eq.'+user.id); assert.equal(db[1].body.user_id,user.id); assert.equal(db[2].url.searchParams.get('user_id'),'eq.'+user.id); assert.equal(db[2].method,'DELETE');
});
test('database failures stay failures and do not expose backend details',async t=>{
  setup(t,{fail:true});const res=response();await preferences(request({action:'clear'}),res);assert.equal(res.statusCode,503);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE DATABASE ERROR/);
});
test('invalid answers and unsupported methods never mutate preferences',async t=>{
  const calls=setup(t); const bad=response();await preferences(request({action:'save',preferences:{topics:['food'],area:'Boston',consent:false}}),bad);assert.equal(bad.statusCode,400);assert.equal(calls.length,1);
  const wrong=response();await preferences(request(undefined,{method:'DELETE'}),wrong);assert.equal(wrong.statusCode,405);assert.equal(calls.length,1);
});
