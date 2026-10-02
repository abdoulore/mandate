import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {getReplayScenario,replayScenarioSchema,replayScenarios} from '../packages/evidence/src/index.ts';

const root=path.resolve(import.meta.dirname,'..');
const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');

it('keeps recorded rows bound to exact frozen source bytes and line numbers',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'research/evidence-manifest.json'),'utf8')) as {files:{file:string;bytes:number;sha256:string;rows:number}[]};
 const byFile=new Map(manifest.files.map(item=>[item.file,item]));
 const recorded=replayScenarios.filter(s=>s.kind==='recorded');
 expect(recorded).toHaveLength(3);
 for(const scenario of recorded){
  expect(scenario.executionEnabled).toBe(false);
  for(const event of scenario.events){
   const file=event.source.file.slice('data/'.length),frozen=byFile.get(file);
   expect(frozen).toBeDefined();
   const prefix=fs.readFileSync(path.join(root,event.source.file)).subarray(0,event.source.fileBytes);
   expect(event.source.fileBytes).toBe(frozen!.bytes);
   expect(event.source.fileSha256).toBe(frozen!.sha256);
   expect(sha256(prefix)).toBe(frozen!.sha256);
   const line=prefix.toString('utf8').split(/\r?\n/)[event.source.line-1];
   expect(event.source.line).toBeLessThanOrEqual(frozen!.rows);
   expect(sha256(line)).toBe(event.source.lineSha256);
   expect(JSON.parse(line)).toEqual(event.storedCollectorRow);
   expect(event.at).toBe(event.storedCollectorRow.ts);
   expect(event.storedCollectorRow).not.toHaveProperty('rawQuote');
  }
 }
});

it('separates synthetic incidents from observed rows and rejects source laundering',()=>{
 expect(new Set(replayScenarios.map(s=>s.id)).size).toBe(replayScenarios.length);
 expect(replayScenarios.filter(s=>s.kind==='synthetic')).toHaveLength(4);
 for(const scenario of replayScenarios){
  expect(replayScenarioSchema.parse(scenario)).toEqual(scenario);
  expect(scenario.executionEnabled).toBe(false);
  expect(scenario.limitations.length).toBeGreaterThan(0);
  expect(getReplayScenario(scenario.id)).toEqual(scenario);
  if(scenario.kind==='synthetic')for(const event of scenario.events){
   expect(event.kind).toBe('synthetic_failure');
   expect(event).not.toHaveProperty('source');
   expect(replayScenarioSchema.safeParse({...scenario,events:[{...event,source:{file:'data/cost-fake.jsonl'}}]}).success).toBe(false);
  }
 }
 expect(getReplayScenario('not-found')).toBeUndefined();
});
