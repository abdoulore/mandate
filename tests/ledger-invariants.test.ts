import {afterEach,describe,it,expect} from 'vitest';
import {Ledger,embeddedDatabase} from '@mandate/store';
import {capitalProtection,formatUnits} from '@mandate/core';
import type {AccountRecord,PlanRevisionRecord,ReceiptRecord,CapitalCheckpoint} from '@mandate/domain';
import {generator,unit} from './fixtures/accounting.ts';

let ledger:Ledger|undefined;
afterEach(async()=>{await ledger?.close();ledger=undefined;});
const asset={chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18};
const stamp=()=>new Date().toISOString();
async function setup(){ledger=new Ledger(embeddedDatabase());await ledger.migrate();return ledger;}
async function account(l:Ledger,id:string,balance:bigint,protectedCash:bigint){
 const record:AccountRecord={schemaVersion:'1.0.0',id,wallet:'0x'+'1'.repeat(40),asset,balanceAtomic:balance.toString(),protectedAtomic:protectedCash.toString(),revision:0,createdAt:stamp(),observedAt:stamp(),evidenceMode:'synthetic'};
 await l.createAccount(record);
}
async function plan(l:Ledger,id:string,accountId:string,amount:bigint){
 const revision=(await l.snapshot(accountId)).revision;
 const record:PlanRevisionRecord={schemaVersion:'1.0.0',id,accountId,revision:1,accountRevision:revision,createdAt:stamp(),decisionId:'invariant',inputHash:'a'.repeat(64),maximumDebit:{asset,atomic:amount.toString()},evidenceMode:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()};
 await l.savePlan(record);return record;
}
describe('COR-10 durable lifecycle invariants',{timeout:60000},()=>{
 it('conserves cash through generated holds, release, partial debit and replay sequences',async()=>{
  const l=await setup(),next=generator(2001);let releases=0,settlements=0;
  for(let n=0;n<24;n++){
   const id='sequence-'+n,initial=BigInt(100+next(100))*unit+BigInt(next(100)),protection=BigInt(next(40))*unit;
   await account(l,id,initial,protection);let expectedBalance=initial,expectedHeld=0n;
   const check=async()=>{const s=await l.snapshot(id);expect(BigInt(s.balanceAtomic)).toBe(expectedBalance);expect(BigInt(s.protectedAtomic)).toBe(protection);expect(BigInt(s.heldAtomic)).toBe(expectedHeld);expect(BigInt(s.availableAtomic)+protection+expectedHeld).toBe(expectedBalance);return s;};
   for(let step=0;step<3;step++){
    const key=id+'-'+step,amount=BigInt(1+next(10))*unit+1n;await plan(l,key,id,amount);
    const request={accountId:id,planRevisionId:key,idempotencyKey:key,amountAtomic:amount.toString()};
    const r=await l.reserve(request);expectedHeld+=amount;const held=await check(),events=await l.pendingEvents();
    expect(await l.reserve(request)).toEqual(r);expect(await l.snapshot(id)).toEqual(held);expect(await l.pendingEvents()).toBe(events);
    await expect(l.reserve({...request,amountAtomic:(amount+1n).toString()})).rejects.toThrow('IDEMPOTENCY_CONFLICT');expect(await l.snapshot(id)).toEqual(held);expect(await l.pendingEvents()).toBe(events);
    if(next(2)===0){
     releases++;await l.releaseUnsubmitted(r.id);expectedHeld-=amount;const released=await check(),count=await l.pendingEvents();await l.releaseUnsubmitted(r.id);expect(await l.snapshot(id)).toEqual(released);expect(await l.pendingEvents()).toBe(count);
    }else{
     settlements++;const fences=await Promise.all([l.beginSubmission(r.id,key),l.beginSubmission(r.id,key)]);expect(fences.sort()).toEqual([false,true]);
     const fenced=await check(),count=await l.pendingEvents();await expect(l.releaseUnsubmitted(r.id)).rejects.toThrow('SUBMISSION_REQUIRES_RECONCILIATION');expect(await l.snapshot(id)).toEqual(fenced);expect(await l.pendingEvents()).toBe(count);
     const debit=amount*BigInt(next(10001))/10000n,receipt:ReceiptRecord={schemaVersion:'1.0.0',id:'receipt-'+key,reservationId:r.id,transactionHash:'0x'+BigInt(n*3+step+1).toString(16).padStart(64,'0'),blockNumber:'1',debitedAtomic:debit.toString(),createdAt:stamp(),observedAt:stamp(),evidenceMode:'synthetic'};
     await expect(l.reconcile({...receipt,debitedAtomic:(amount+1n).toString()})).rejects.toThrow('RESERVATION_EXCEEDED');expect(await l.snapshot(id)).toEqual(fenced);expect(await l.pendingEvents()).toBe(count);
     await l.reconcile(receipt);expectedBalance-=debit;expectedHeld-=amount;const settled=await check(),settledCount=await l.pendingEvents();await l.reconcile(receipt);expect(await l.snapshot(id)).toEqual(settled);expect(await l.pendingEvents()).toBe(settledCount);
    }
   }
  }expect(releases).toBeGreaterThan(0);expect(settlements).toBeGreaterThan(0);
 });
 it('serializes competing plans and policy revisions without losing protections or holds',async()=>{
  const l=await setup(),next=generator(2002);
  for(let n=0;n<16;n++){
   const id='race-'+n,balance=BigInt(100+next(100))*unit,protectedCash=BigInt(20+next(30))*unit;
   await account(l,id,balance,protectedCash);const debit=(balance-protectedCash)*3n/4n;
   await plan(l,id+'-a',id,debit);await plan(l,id+'-b',id,debit);
   const races=await Promise.allSettled(['a','b'].map(k=>l.reserve({accountId:id,planRevisionId:id+'-'+k,idempotencyKey:k,amountAtomic:debit.toString()})));
   expect(races.filter(r=>r.status==='fulfilled')).toHaveLength(1);const held=await l.snapshot(id);expect(held.heldAtomic).toBe(debit.toString());expect(BigInt(held.availableAtomic)+debit+protectedCash).toBe(balance);
   const proposals=await Promise.allSettled([protectedCash-1n,protectedCash-2n].map(amount=>l.setProtected(id,amount.toString(),held.revision)));
   expect(proposals.filter(r=>r.status==='fulfilled')).toHaveLength(1);const after=await l.snapshot(id);expect(after.heldAtomic).toBe(debit.toString());expect(after.balanceAtomic).toBe(balance.toString());expect(after.revision).toBe(held.revision+1);
   expect(BigInt(after.availableAtomic)+BigInt(after.protectedAtomic)+debit).toBe(balance);
  }
 });
 it('retains holds and reports exact deficits after generated external balance drops',async()=>{
  const l=await setup(),next=generator(2003);
  for(let n=0;n<16;n++){
   const id='drop-'+n,cp:CapitalCheckpoint={accountId:id,wallet:'0x'+BigInt(n+1).toString(16).padStart(40,'0'),asset,balanceAtomic:(100n*unit).toString(),blockNumber:'100',blockHash:'0x'+'a'.repeat(64),observedAt:stamp(),evidenceMode:'observed',positions:[]};await l.applyCapitalCheckpoint(cp);
   const policy={reserveFloor:'30',operatingBudget:'2',obligations:[{id:'covered',label:'Covered',amount:'20',coverage:'reserve' as const},{id:'extra',label:'Extra',amount:'5',coverage:'additional' as const}]};await l.saveCapitalPolicy(id,policy,(await l.snapshot(id)).revision);
   const snapshot=await l.snapshot(id),amount=10n*unit;
   const p:PlanRevisionRecord={schemaVersion:'1.0.0',id:id+'-p',accountId:id,revision:1,accountRevision:snapshot.revision,createdAt:stamp(),decisionId:'drop',inputHash:'a'.repeat(64),maximumDebit:{asset,atomic:amount.toString()},evidenceMode:'live',expiresAt:new Date(Date.now()+60000).toISOString()};await l.savePlan(p);const r=await l.reserve({accountId:id,planRevisionId:p.id,idempotencyKey:id,amountAtomic:amount.toString()});
   const observed=BigInt(next(45))*unit+1n;await l.applyCapitalCheckpoint({...cp,balanceAtomic:observed.toString(),blockNumber:'101',blockHash:'0x'+'b'.repeat(64),observedAt:stamp()});
   const s=await l.snapshot(id),protectedCash=BigInt(capitalProtection(policy,18).protectedAtomic);expect(s.heldAtomic).toBe(amount.toString());expect(s.balanceAtomic).toBe(observed.toString());expect(s.protectedAtomic).toBe(protectedCash.toString());
   expect(BigInt(s.shortfallAtomic)).toBe(protectedCash+amount>observed?protectedCash+amount-observed:0n);expect(BigInt(s.availableAtomic)).toBe(observed>protectedCash+amount?observed-protectedCash-amount:0n);
   const policies=await l.capitalPolicyHistory(id);expect(policies[0].record.reserveFloor).toBe(formatUnits(30n*unit,18));
   await expect(l.reserve({accountId:id,planRevisionId:p.id,idempotencyKey:id+'-new',amountAtomic:'1'})).rejects.toThrow('STALE_PLAN');expect(await l.snapshot(id)).toEqual(s);
   await l.releaseUnsubmitted(r.id);const released=await l.snapshot(id);expect(released.balanceAtomic).toBe(s.balanceAtomic);expect(released.heldAtomic).toBe('0');expect(BigInt(released.shortfallAtomic)).toBe(protectedCash>observed?protectedCash-observed:0n);
  }
 });
});
