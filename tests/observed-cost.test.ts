import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {latestObservedCost} from '../apps/api/src/observed-cost.ts';
import {createApp} from '../apps/api/src/app.ts';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(files:Record<string,string[]>){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mandate-cost-'));roots.push(root);
 fs.mkdirSync(path.join(root,'data'));
 for(const [name,lines] of Object.entries(files))fs.writeFileSync(path.join(root,'data',name),lines.join('\n')+'\n');
 return root;
}
const row=(ts:string,other:Record<string,unknown>={})=>JSON.stringify({ts,tk:'NVDA',plat:'ondo',side:'buy',usd:10000,...other});
const query={ticker:'NVDA',platform:'ondo' as const,side:'buy' as const,usd:10000};

it('returns only the newest exact cost attempt with line provenance',()=>{
 const first=row('2026-09-20T10:00:00Z',{pct:1.3,route:'Venue A|Venue B'});
 const newest=row('2026-09-21T10:00:00Z',{pct:-0.25,route:'Venue C'});
 const root=fixture({'cost-2026-09-20.jsonl':[first,row('2026-09-20T11:00:00Z',{usd:100,pct:900}),row('2026-09-20T12:00:00Z',{side:'sell',pct:900})],
  'cost-2026-09-21.jsonl':[newest,row('2026-09-21T11:00:00Z',{plat:'bstock',pct:900})]});
 expect(latestObservedCost(root,query)).toEqual({...query,observation:'measured',observedAt:'2026-09-21T10:00:00Z',pct:-0.25,route:'Venue C',errorCode:null,
  source:{file:'data/cost-2026-09-21.jsonl',line:1,sha256:createHash('sha256').update(newest).digest('hex')},executable:false,
  note:'Historical cost versus the quote’s token reference price; it is not a current executable fee or authorization.'});
});

it('does not reuse an old measured number after a newer failed attempt',()=>{
 const root=fixture({'cost-2026-09-20.jsonl':[row('2026-09-20T10:00:00Z',{pct:28976})],
  'cost-2026-09-21.jsonl':[row('2026-09-21T10:00:00Z',{err:40374}),'{"ts":"incomplete"']});
 const result=latestObservedCost(root,query);
 expect(result).toMatchObject({observation:'none',observedAt:'2026-09-21T10:00:00Z',pct:null,errorCode:'40374',source:{file:'data/cost-2026-09-21.jsonl',line:1},executable:false});
 expect(result.note).toContain('older number is not substituted');
});

it('reports no observation for an unmatched ticker or unsampled size',()=>{
 const root=fixture({'cost-2026-09-20.jsonl':[row('2026-09-20T10:00:00Z',{pct:1})]});
 expect(latestObservedCost(root,{ticker:'AAOIB',platform:'bstock',side:'buy',usd:10})).toMatchObject({observation:'none',observedAt:null,pct:null,source:null});
 expect(latestObservedCost(root,{...query,usd:10})).toMatchObject({observation:'none',observedAt:null,pct:null});
});

it('exposes the read-only review endpoint with strict exact-match input',async()=>{
 const root=fixture({'cost-2026-09-20.jsonl':[row('2026-09-20T10:00:00Z',{pct:2.2})]});
 const app=createApp(root,{recurringTickMs:null});
 try{
  expect((await app.inject('/v1/cost-review?ticker=NVDA&platform=ondo&side=buy&usd=10000')).json()).toMatchObject({observation:'measured',pct:2.2,executable:false});
  expect((await app.inject('/v1/cost-review?ticker=AAOIB&platform=bstock&side=buy&usd=10')).json()).toMatchObject({observation:'none',pct:null,executable:false});
  for(const url of ['/v1/cost-review?ticker=NVDA&platform=ondo&side=buy&usd=-1','/v1/cost-review?ticker=../NVDA&platform=ondo&side=buy&usd=10000','/v1/cost-review?ticker=NVDA&platform=ondo&side=buy&usd=10000&extra=1'])expect((await app.inject(url)).statusCode).toBe(400);
 }finally{await app.close();}
});
