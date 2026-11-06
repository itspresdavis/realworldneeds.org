import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import correctionsHandler from '../api/corrections.js';
import { correctionConfig } from '../server/corrections.js';

// Built presentation with isolated UI transport. This does not verify hosted authentication or
// durable storage; API/PostgreSQL tests verify those independent boundaries.
export async function correctionUIFixture() {
  const report = { id:'c09386bc-02cd-49ab-b3f4-5273511262bd',resourceId:'bowery-mission',listingName:'The Bowery Mission',category:'wrong-address',note:'<img src=x onerror=alert(1)> Check the public entrance.',status:'open',priority:'urgent',assignedTo:null,revision:1,createdAt:'2026-11-06T12:00:00Z' };
  const state = { enabled:false, denied:false, failSubmission:false, conflict:false, submissions:[],decisions:[],report };
  const assetRoot = resolve('dist');
  if(correctionConfig())throw new Error('UI fixture requires disabled correction configuration; it must not contact hosted services.');
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://fixture.test');
    const send = (status,type,value) => { res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow'});res.end(value); };
    const json = (status,value) => send(status,'application/json',JSON.stringify(value));
    if (url.pathname==='/api/corrections') {
      if(req.method==='GET')return state.enabled ? json(200,{enabled:true}) : correctionsHandler(req,res);
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      state.submissions.push(JSON.parse(Buffer.concat(chunks)));
      if(state.failSubmission){state.failSubmission=false;return json(503,{error:'Fixture storage unavailable'});}
      return json(201,{ok:true});
    }
    if (url.pathname==='/api/catalog')return json(200,{locations:[],reviews:[],page:0,total:0});
    if (url.pathname==='/api/correction-review') {
      if(state.denied)return json(403,{error:'Editor required'});
      if(req.method==='PATCH'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks));state.decisions.push(body);
        if(state.conflict){state.conflict=false;state.report.revision++;return json(409,{error:'Fixture conflict'});}
        state.report={...state.report,...body,revision:state.report.revision+1};return json(200,{report:state.report});
      }
      return json(200,url.searchParams.has('id')?{report:state.report,events:[]}:{reports:[state.report],page:0,hasMore:false});
    }
    try {
      if(url.pathname==='/corrections')return send(200,'text/html',await readFile('dist/corrections.html','utf8'));
      if(url.pathname==='/review-fixture')return send(200,'text/html',await readFile('server/workspace.html','utf8'));
      const path=resolve(assetRoot,'.'+decodeURIComponent(url.pathname));
      if(path.startsWith(assetRoot+sep)) {
        const types={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
        const type=types[extname(path)];
        if(type)return send(200,type,await readFile(path));
      }
      return send(404,'text/plain','UI fixture route not found');
    }catch{return send(500,'text/plain','UI fixture failed');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {state,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
