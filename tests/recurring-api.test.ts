import {afterEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {Ledger,RecurringStore,embeddedDatabase} from '@mandate/store';
import type {CapitalCheckpoint} from '@mandate/domain';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';

const origin='http://127.0.0.1:3110',defs=passportDefinitions();
const ledgers:Ledger[]=[],apps:ReturnType<typeof createApp>[]=[],dirs:string[]=[];
afterEach(async()=>{for(const a of apps.splice(0))await a.close();for(const l of ledgers.splice(0))await l.close();for(const d of dirs.splice(0)){if(!resolve(d).startsWith(resolve(tmpdir())+sep+'mandate-recurring-'))throw new Error('Unexpected cleanup path');await rm(d,{recursive:true,force:true});}});
async function setup(directory?:string){
 const ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);await ledger.migrate();const signer=privateKeyToAccount(generatePrivateKey()),wallet=signer.address.toLowerCase(),id=capitalAccountId(wallet),state={block:100,cash:100,fail:false,readerCalls:0,gate:null as null|{entered:()=>void;wait:Promise<void>}};
 const checkpoint=():CapitalCheckpoint=>({accountId:id,wallet,asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:(BigInt(state.cash)*10n**18n).toString(),blockNumber:String(state.block),blockHash:'0x'+BigInt(state.block).toString(16).padStart(64,'0'),observedAt:new Date().toISOString(),evidenceMode:'observed',positions:defs.map(d=>({contract:d.contract,symbol:d.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1',state:'OBSERVED'}))});
 await ledger.applyCapitalCheckpoint(checkpoint());await ledger.saveCapitalPolicy(id,{reserveFloor:'20',operatingBudget:'0',obligations:[]},1);await ledger.saveInvestmentMandate(id,{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:30,allowLeveraged:false,representationAllowlist:defs.map(d=>d.contract),exposureScope:'tracked-holdings-pending-proposed'},0);
 const makeApp=(current:Ledger)=>{const app=createApp(process.cwd(),{ledger:current,recurringTickMs:null,capitalReader:async()=>{state.readerCalls++;if(state.gate){state.gate.entered();await state.gate.wait;}if(state.fail)throw new Error('RPC failed');state.block++;return checkpoint();},marketReader:async()=>({source:'synthetic recurring fixture',observedAt:new Date().toISOString(),items:[]})});apps.push(app);return app;};
 const app=makeApp(ledger),challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:signer.address,chainId:56}})).json(),verification=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature:await signer.signMessage({message:challenge.message})}}),headers={origin,cookie:String(verification.headers['set-cookie']).split(';')[0]};
 const create=(requestId=randomUUID(),intervalSeconds=60)=>app.inject({method:'POST',url:'/v1/capital/recurring',headers,payload:{requestId,intervalSeconds,scenario:'normal'}});
 const change=(action:'pause'|'resume'|'revoke',scheduleId:string,expectedRevision:number)=>app.inject({method:'POST',url:'/v1/capital/recurring/'+action,headers,payload:{scheduleId,expectedRevision}});
 return {ledger,app,makeApp,headers,id,wallet,state,create,change};
}
describe('AGT-03 proposal-only recurring schedules',{timeout:90000},()=>{
 it('creates one fresh research proposal per due firing, replays creation and never reserves cash',async()=>{
  const {ledger,app,headers,id,state,create}=await setup(),key=randomUUID();const first=await create(key);expect(first.statusCode).toBe(200);const schedule=first.json().schedule;
  expect(schedule).toMatchObject({status:'active',authority:'proposal-only',revision:1,intervalSeconds:60});expect((await create(key)).json().schedule).toEqual(schedule);expect((await create(key,120)).statusCode).toBe(409);
  const tick=await app.runRecurringDue();expect(tick).toEqual({claimed:1,proposed:1,deferred:0});expect(state.readerCalls).toBe(1);
  const history=(await app.inject({url:'/v1/capital/recurring',headers})).json();expect(history.firings).toHaveLength(1);expect(history.firings[0]).toMatchObject({state:'proposed',attempts:1,reason:null});
  const proposal=(await ledger.researchHistory(id))[0];expect(proposal.recurring).toEqual({scheduleId:schedule.id,firingId:history.firings[0].id,dueAt:history.firings[0].dueAt});expect(proposal.requestId).toBe(history.firings[0].requestId);expect(proposal.inputs.checkpoint.blockNumber).toBe('101');expect(proposal.researchOnly).toBe(true);expect(proposal.result.executable).toBe(false);expect((await ledger.snapshot(id)).heldAtomic).toBe('0');
  expect(await app.runRecurringDue()).toEqual({claimed:0,proposed:0,deferred:0});
 });
 it('defers unavailable evidence, then retries the same firing and request ID',async()=>{
  const {ledger,app,id,state,create}=await setup();await create();state.fail=true;expect(await app.runRecurringDue()).toEqual({claimed:1,proposed:0,deferred:1});expect(await ledger.researchHistory(id)).toHaveLength(0);
  const store=new RecurringStore(ledger),before=(await store.firings(id))[0];expect(before).toMatchObject({state:'deferred',attempts:1,reason:'CAPITAL_READ_UNAVAILABLE'});
  state.fail=false;await ledger.db.query("UPDATE recurring_schedules SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[before.scheduleId]);
  expect(await app.runRecurringDue()).toEqual({claimed:1,proposed:1,deferred:0});const after=(await store.firings(id))[0];expect(after.id).toBe(before.id);expect(after.requestId).toBe(before.requestId);expect(after.attempts).toBe(2);expect((await ledger.researchHistory(id))[0].requestId).toBe(before.requestId);
 });
 it('rebuilds from the latest balance and saved mandate on the next firing',async()=>{
  const {ledger,app,id,state,create}=await setup();const schedule=(await create()).json().schedule;
  expect(await app.runRecurringDue()).toEqual({claimed:1,proposed:1,deferred:0});const first=(await ledger.researchHistory(id))[0];expect(first.inputs.funding.balanceAtomic).toBe((100n*10n**18n).toString());expect(first.mandateRevision).toBe(1);
  state.cash=55;await ledger.saveCapitalPolicy(id,{reserveFloor:'30',operatingBudget:'0',obligations:[]},(await ledger.snapshot(id)).revision);
  await ledger.saveInvestmentMandate(id,{allocations:[{underlying:'SPY',weightBps:5000},{underlying:'NVDA',weightBps:5000}],maxIssuerBps:10000,maxCostBps:30,allowLeveraged:false,representationAllowlist:defs.map(d=>d.contract),exposureScope:'tracked-holdings-pending-proposed'},1);
  await ledger.db.query("UPDATE recurring_schedules SET next_due=clock_timestamp()-interval '1 second' WHERE id=$1",[schedule.id]);
  expect(await app.runRecurringDue()).toEqual({claimed:1,proposed:1,deferred:0});const history=await ledger.researchHistory(id),second=history[0];expect(history).toHaveLength(2);expect(second.id).not.toBe(first.id);expect(second.inputs.funding.balanceAtomic).toBe((55n*10n**18n).toString());expect(second.inputs.funding.protectedAtomic).toBe((30n*10n**18n).toString());expect(second.mandateRevision).toBe(2);expect(second.inputs.mandate.allocations).toHaveLength(2);expect(second.inputs.checkpoint.blockNumber).toBe('102');expect(second.result.executable).toBe(false);expect((await ledger.snapshot(id)).heldAtomic).toBe('0');
 });
 it('blocks an in-flight save after pause and permits only a new claim after resume',async()=>{
  const {ledger,app,id,state,create,change}=await setup(),schedule=(await create()).json().schedule;
  let signal!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{signal=r;}),wait=new Promise<void>(r=>{release=r;});state.gate={entered:signal,wait};
  const tick=app.runRecurringDue();await entered;const paused=await change('pause',schedule.id,1);expect(paused.statusCode).toBe(200);expect(paused.json().schedule.status).toBe('paused');release();expect(await tick).toEqual({claimed:1,proposed:0,deferred:1});expect(await ledger.researchHistory(id)).toHaveLength(0);expect(await app.runRecurringDue()).toEqual({claimed:0,proposed:0,deferred:0});
  state.gate=null;const resumed=await change('resume',schedule.id,2);expect(resumed.statusCode).toBe(200);expect(await app.runRecurringDue()).toEqual({claimed:1,proposed:1,deferred:0});expect((await ledger.researchHistory(id))[0].recurring?.scheduleId).toBe(schedule.id);
  const revoked=await change('revoke',schedule.id,4);expect(revoked.statusCode).toBe(200);await ledger.db.query("UPDATE recurring_schedules SET next_due=clock_timestamp()-interval '1 second' WHERE id=$1",[schedule.id]);expect(await app.runRecurringDue()).toEqual({claimed:0,proposed:0,deferred:0});expect((await change('resume',schedule.id,5)).statusCode).toBe(409);
 });
 it('recovers an expired claim after persistent database restart without a duplicate proposal',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mandate-recurring-'));dirs.push(directory);let {ledger,app,makeApp,id,create}=await setup(directory);const schedule=(await create()).json().schedule,store=new RecurringStore(ledger),first=await store.claim();expect(first?.firing.attempts).toBe(1);
  await app.close();apps.splice(apps.indexOf(app),1);await ledger.close();ledgers.splice(ledgers.indexOf(ledger),1);
  ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);await ledger.migrate();app=makeApp(ledger);await ledger.db.query("UPDATE recurring_schedules SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[schedule.id]);
  expect(await app.runRecurringDue()).toEqual({claimed:1,proposed:1,deferred:0});const after=(await new RecurringStore(ledger).firings(id))[0];expect(after.id).toBe(first?.firing.id);expect(after.requestId).toBe(first?.firing.requestId);expect(after.attempts).toBe(2);expect(await ledger.researchHistory(id)).toHaveLength(1);expect((await ledger.snapshot(id)).heldAtomic).toBe('0');
 });
 it('keeps schedules private and rejects caller-supplied wallet or extra authority',async()=>{
  const {app,headers,create}=await setup();expect((await app.inject({url:'/v1/capital/recurring'})).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/v1/capital/recurring',payload:{requestId:randomUUID(),intervalSeconds:60,scenario:'normal'}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/v1/capital/recurring',headers:{...headers,origin:'https://wrong.example'},payload:{requestId:randomUUID(),intervalSeconds:60,scenario:'normal'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/v1/capital/recurring',headers,payload:{requestId:randomUUID(),intervalSeconds:60,scenario:'normal',wallet:'0x'+'1'.repeat(40)}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:'/v1/capital/recurring',headers,payload:{requestId:randomUUID(),intervalSeconds:60,scenario:'normal',executionEnabled:true}})).statusCode).toBe(400);
  expect((await create()).statusCode).toBe(200);
 });
});
