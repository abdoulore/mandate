import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Ledger,embeddedDatabase} from '@mandate/store';
import type {AccountRecord,PlanRevisionRecord,ReceiptRecord} from '@mandate/domain';

const unit=10n**18n;
const amount=(n:number)=>(BigInt(n)*unit).toString();
const asset={chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18};
const createdAt='2026-09-28T12:00:00.000Z';
const account:AccountRecord={schemaVersion:'1.0.0',id:'timeout-account',wallet:'0x'+'1'.repeat(40),asset,balanceAtomic:amount(100),protectedAtomic:amount(30),revision:0,createdAt,observedAt:createdAt,evidenceMode:'synthetic'};
const plan=(id:string,revision:number,maximum:number):PlanRevisionRecord=>({schemaVersion:'1.0.0',id,accountId:account.id,revision:1,accountRevision:revision,createdAt:new Date().toISOString(),decisionId:id,inputHash:'a'.repeat(64),maximumDebit:{asset,atomic:amount(maximum)},evidenceMode:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()});
const ledgers:Ledger[]=[];
const directories:string[]=[];

afterEach(async()=>{
 for(const ledger of ledgers.splice(0))await ledger.close();
 for(const directory of directories.splice(0)){
  if(!resolve(directory).startsWith(resolve(tmpdir())+sep+'mandate-uncertain-'))throw new Error('Unexpected cleanup path');
  await rm(directory,{recursive:true,force:true});
 }
});

describe('uncertain submission adversarial journey',{timeout:60000},()=>{
 it('holds money through worker restart and lease timeout, then releases only unused funds after a partial receipt',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mandate-uncertain-'));directories.push(directory);
  let ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);
  await ledger.migrate();await ledger.createAccount(account);await ledger.savePlan(plan('first',0,60));
  const reservation=await ledger.reserve({accountId:account.id,planRevisionId:'first',idempotencyKey:'first-action',amountAtomic:amount(60)});
  expect(await ledger.beginSubmission(reservation.id,'external-request')).toBe(true);
  expect((await ledger.snapshot(account.id)).availableAtomic).toBe(amount(10));

  // The external request may have succeeded even if the worker never saw its reply.
  await ledger.close();ledgers.splice(ledgers.indexOf(ledger),1);
  ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);await ledger.migrate();
  const before=await ledger.snapshot(account.id);
  expect(before).toMatchObject({balanceAtomic:amount(100),protectedAtomic:amount(30),heldAtomic:amount(60),availableAtomic:amount(10)});
  expect(await ledger.beginSubmission(reservation.id,'external-request')).toBe(false);
  await expect(ledger.beginSubmission(reservation.id,'different-request')).rejects.toThrow('SUBMISSION_ALREADY_STARTED');
  await expect(ledger.releaseUnsubmitted(reservation.id)).rejects.toThrow('SUBMISSION_REQUIRES_RECONCILIATION');

  const event=(await ledger.claimEvent())!;
  await ledger.db.query("UPDATE outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[event.id]);
  const reclaimed=(await ledger.claimEvent())!;
  expect(reclaimed.id).toBe(event.id);
  await expect(ledger.acknowledgeEvent(event.id,event.token)).rejects.toThrow('LEASE_LOST');
  expect(await ledger.snapshot(account.id)).toEqual(before);

  await ledger.savePlan(plan('competing',before.revision,20));
  await expect(ledger.reserve({accountId:account.id,planRevisionId:'competing',idempotencyKey:'competing-action',amountAtomic:amount(20)})).rejects.toThrow('INSUFFICIENT_AVAILABLE');
  expect(await ledger.snapshot(account.id)).toEqual(before);

  // A synthetic receipt is supplied only after the supposed external outcome is known.
  const receipt:ReceiptRecord={schemaVersion:'1.0.0',id:'partial-receipt',reservationId:reservation.id,transactionHash:'0x'+'2'.repeat(64),blockNumber:'123',debitedAtomic:amount(40),createdAt,observedAt:createdAt,evidenceMode:'synthetic'};
  await ledger.reconcile(receipt);
  const settled=await ledger.snapshot(account.id);
  expect(settled).toMatchObject({balanceAtomic:amount(60),protectedAtomic:amount(30),heldAtomic:'0',availableAtomic:amount(30)});
  await ledger.reconcile(receipt);
  expect(await ledger.snapshot(account.id)).toEqual(settled);
  await expect(ledger.reconcile({...receipt,debitedAtomic:amount(41)})).rejects.toThrow('RECEIPT_CONFLICT');
  await ledger.savePlan(plan('after-receipt',settled.revision,20));
  await ledger.reserve({accountId:account.id,planRevisionId:'after-receipt',idempotencyKey:'after-receipt',amountAtomic:amount(20)});
  expect((await ledger.snapshot(account.id)).availableAtomic).toBe(amount(10));
 });
});
