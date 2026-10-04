import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readRegime} from '../apps/api/src/regime.ts';
import {createApp} from '../apps/api/src/app.ts';

const projectRoot=path.resolve(import.meta.dirname,'..');
const temporary:string[]=[];
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function lineHash(file:string,line:number){
 const text=fs.readFileSync(path.join(projectRoot,file),'utf8').split('\n')[line-1];
 return createHash('sha256').update(text).digest('hex');
}

it('uses original $10k buy rows for the NVDA regime flip, with line provenance',async()=>{
 const result=await readRegime(projectRoot,'NVDA','ondo');
 const before=result.points.find(point=>point.ts.startsWith('2026-09-20T16:45:'));
 const after=result.points.find(point=>point.ts.startsWith('2026-09-20T17:00:'));
 expect(before?.pct).toBeCloseTo(133.71011728320528,8);
 expect(before?.broken).toBe(true);
 expect(after?.pct).toBeCloseTo(-0.04628144680093316,8);
 expect(after?.broken).toBe(false);
 expect(before?.source).toEqual({file:'data/cost-2026-09-20.jsonl',line:4323,sha256:lineHash('data/cost-2026-09-20.jsonl',4323)});
 expect(after?.source).toEqual({file:'data/cost-2026-09-20.jsonl',line:4503,sha256:lineHash('data/cost-2026-09-20.jsonl',4503)});
 expect(result.flips).toContainEqual({ts:after!.ts,from:'broken',to:'healthy'});
 expect(result.observedCount).toBe(result.points.filter(point=>point.pct!==null).length);
 expect(result.brokenPercent).toBeCloseTo(100*result.brokenCount/result.observedCount,8);
},120000);

it('keeps AMZN sweep evidence separate from the $10k series and does not invent recovery',async()=>{
 const result=await readRegime(projectRoot,'AMZN','ondo');
 expect(result.availableTokens).toContainEqual({token:'AMZN',platform:'ondo'});
 expect(result.points).toEqual([]);
 expect(result.observedCount).toBe(0);
 expect(result.brokenPercent).toBeNull();
 expect(result.flips).toEqual([]);
 expect(result.sweepObservations).toEqual([{ts:'2026-09-21T13:31:05.132Z',pct:299.4746854901014,venueCount:10,
  source:{file:'data/sweep-all-2026-09-21T13-28.jsonl',line:152,sha256:lineHash('data/sweep-all-2026-09-21T13-28.jsonl',152)},broken:true}]);
},120000);

it('distinguishes full Ondo pauses from a missing Ondo snapshot',async()=>{
 const result=await readRegime(projectRoot,'NVDA','ondo');
 expect(result.outages.find(window=>window.ts==='2026-09-21T08:00:00.000Z')).toMatchObject({openCount:46,totalCount:488});
 expect(result.outages.find(window=>window.ts==='2026-09-21T13:30:00.000Z')).toMatchObject({openCount:46,totalCount:488});
 expect(result.outages.some(window=>window.ts==='2026-09-21T09:15:00.000Z')).toBe(false);
 expect(result.coverageGaps.find(window=>window.ts==='2026-09-21T09:15:00.000Z')).toMatchObject({openCount:46,totalCount:46,source:{file:'data/universe-2026-09-21.jsonl'}});
});

it('does not label an unobserved interval as a threshold crossing',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mandate-regime-gaps-'));
 temporary.push(root);
 fs.mkdirSync(path.join(root,'data'));
 const rows=[
  {ts:'2026-09-20T11:00:00Z',pct:2},
  {ts:'2026-09-20T11:15:00Z',err:40367},
  {ts:'2026-09-20T11:30:00Z',pct:0.2},
  {ts:'2026-09-20T13:00:00Z',pct:2},
  {ts:'2026-09-20T13:15:00Z',pct:0.2},
 ].map(row=>JSON.stringify({...row,tk:'NVDA',plat:'ondo',side:'buy',usd:10000}));
 fs.writeFileSync(path.join(root,'data','cost-2026-09-20.jsonl'),rows.join('\n')+'\n');
 const result=await readRegime(root,'NVDA','ondo');
 expect(result.flips).toEqual([{ts:'2026-09-20T13:15:00Z',from:'broken',to:'healthy'}]);
});

it('rejects unsupported query shapes and unknown instruments on the public historical endpoint',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mandate-regime-'));
 temporary.push(root);
 fs.mkdirSync(path.join(root,'data'));
 fs.writeFileSync(path.join(root,'data','cost-2026-09-20.jsonl'),JSON.stringify({ts:'2026-09-20T11:00:00Z',tk:'NVDA',plat:'ondo',side:'buy',usd:10000,pct:1.5,route:'A|B'})+'\n');
 const app=createApp(root,{recurringTickMs:null});
 try{
  expect((await app.inject('/v1/regime?token=NVDA&platform=ondo')).json()).toMatchObject({token:'NVDA',platform:'ondo',brokenCount:1,observedCount:1,brokenPercent:100,points:[{venueCount:2,broken:true}]});
  expect((await app.inject('/v1/regime?token=../../x&platform=ondo')).statusCode).toBe(400);
  expect((await app.inject('/v1/regime?token=AMZN&platform=ondo')).statusCode).toBe(400);
  expect((await app.inject('/v1/regime?token=NVDA&platform=ondo&extra=1')).statusCode).toBe(400);
 }finally{await app.close();}
},120000);
