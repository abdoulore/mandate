import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Ledger,embeddedDatabase} from '@mandate/store';
import type {AccountRecord,PlanRevisionRecord,ReceiptRecord} from '@mandate/domain';

const asset={chainId:56,contract:'0x'+'1'.repeat(40),decimals:18};
const createdAt='2026-09-28T12:00:00.000Z';
const account:AccountRecord={schemaVersion:'1.0.0',id:'controlled',wallet:'0x'+'2'.repeat(40),asset,balanceAtomic:'100',protectedAtomic:'0',revision:0,createdAt,observedAt:createdAt,evidenceMode:'synthetic'};
const plan=(id:string,accountRevision=0):PlanRevisionRecord=>({schemaVersion:'1.0.0',id,accountId:account.id,revision:1,accountRevision,createdAt,decisionId:id,inputHash:'a'.repeat(64),maximumDebit:{asset,atomic:'60'},evidenceMode:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()});
const ledgers:Ledger[]=[];
const directories:string[]=[];

afterEach(async()=>{
 for(const ledger of ledgers.splice(0))await ledger.close();
 for(const directory of directories.splice(0)){
  if(!resolve(directory).startsWith(resolve(tmpdir())+sep+'mandate-plan-control-'))throw new Error('Unexpected cleanup path');
  await rm(directory,{recursive:true,force:true});
 }
});

async function setup(directory?:string){const ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);await ledger.migrate();await ledger.createAccount(account);return ledger;}

describe('durable plan dispatch controls',{timeout:60000},()=>{
 it('pauses before reservation and permits a fresh, still-unreserved plan to resume',async()=>{
  const ledger=await setup();await ledger.savePlan(plan('unreserved'));
  expect(await ledger.getPlanControl(account.id,'unreserved')).toMatchObject({status:'active',revision:1});
  const paused=await ledger.changePlanControl(account.id,'unreserved',1,'pause');
  expect(paused).toMatchObject({status:'paused',revision:2});
  await expect(ledger.reserve({accountId:account.id,planRevisionId:'unreserved',idempotencyKey:'first',amountAtomic:'60'})).rejects.toThrow('PLAN_DISPATCH_BLOCKED');
  await expect(ledger.changePlanControl(account.id,'unreserved',1,'resume')).rejects.toThrow('STALE_PLAN_CONTROL');
  expect(await ledger.changePlanControl(account.id,'unreserved',2,'resume')).toMatchObject({status:'active',revision:3});
  const hold=await ledger.reserve({accountId:account.id,planRevisionId:'unreserved',idempotencyKey:'first',amountAtomic:'60'});
  expect(await ledger.changePlanControl(account.id,'unreserved',3,'pause')).toMatchObject({status:'paused',revision:4});
  await expect(ledger.beginSubmission(hold.id,'attempt')).rejects.toThrow('PLAN_DISPATCH_BLOCKED');
  await expect(ledger.changePlanControl(account.id,'unreserved',4,'resume')).rejects.toThrow('REPLAN_REQUIRED');
  const cancelled=await ledger.changePlanControl(account.id,'unreserved',4,'cancel');
  expect(cancelled.status).toBe('revoked');
  expect((await ledger.releaseUnsubmitted(hold.id)).state).toBe('released');
  expect((await ledger.snapshot(account.id)).heldAtomic).toBe('0');
 });

 it('keeps an outstanding submitted hold after cancellation and resolves it only with a receipt',async()=>{
  const ledger=await setup();await ledger.savePlan(plan('submitted'));
  const hold=await ledger.reserve({accountId:account.id,planRevisionId:'submitted',idempotencyKey:'held',amountAtomic:'60'});
  expect(await ledger.beginSubmission(hold.id,'request')).toBe(true);
  const pending=await ledger.changePlanControl(account.id,'submitted',1,'cancel');
  expect(pending.status).toBe('cancellation_requested');
  expect((await ledger.snapshot(account.id)).heldAtomic).toBe('60');
  await expect(ledger.releaseUnsubmitted(hold.id)).rejects.toThrow('SUBMISSION_REQUIRES_RECONCILIATION');
  expect(await ledger.beginSubmission(hold.id,'request')).toBe(false);
  await expect(ledger.beginSubmission(hold.id,'new-request')).rejects.toThrow('SUBMISSION_ALREADY_STARTED');
  const receipt:ReceiptRecord={schemaVersion:'1.0.0',id:'receipt',reservationId:hold.id,transactionHash:'0x'+'3'.repeat(64),blockNumber:'1',debitedAtomic:'40',createdAt,observedAt:createdAt,evidenceMode:'synthetic'};
  await ledger.reconcile(receipt);
  expect(await ledger.getPlanControl(account.id,'submitted')).toMatchObject({status:'revoked',revision:3});
  expect(await ledger.snapshot(account.id)).toMatchObject({balanceAtomic:'60',heldAtomic:'0',availableAtomic:'60'});
 });

 it('retains paused state after restart and isolates account-scoped changes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mandate-plan-control-'));directories.push(directory);
  let ledger=await setup(directory);await ledger.savePlan(plan('persisted'));
  await ledger.changePlanControl(account.id,'persisted',1,'pause');
  await ledger.close();ledgers.splice(ledgers.indexOf(ledger),1);
  ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);await ledger.migrate();
  expect(await ledger.getPlanControl(account.id,'persisted')).toMatchObject({status:'paused',revision:2});
  await expect(ledger.changePlanControl('other-account','persisted',2,'cancel')).rejects.toThrow();
  expect((await ledger.getPlanControl(account.id,'persisted'))?.status).toBe('paused');
 });

 it('rolls back cancellation and hold release together if journal delivery fails',async()=>{
  const ledger=await setup();await ledger.savePlan(plan('rollback'));
  const hold=await ledger.reserve({accountId:account.id,planRevisionId:'rollback',idempotencyKey:'held',amountAtomic:'60'});
  await ledger.db.query('ALTER TABLE outbox ADD CONSTRAINT inject_plan_control_failure CHECK(false) NOT VALID');
  await expect(ledger.changePlanControl(account.id,'rollback',1,'cancel')).rejects.toThrow();
  expect(await ledger.getPlanControl(account.id,'rollback')).toMatchObject({status:'active',revision:1});
  expect((await ledger.snapshot(account.id)).heldAtomic).toBe('60');
  await ledger.db.query('ALTER TABLE outbox DROP CONSTRAINT inject_plan_control_failure');
  expect((await ledger.changePlanControl(account.id,'rollback',1,'cancel')).status).toBe('revoked');
  expect((await ledger.releaseUnsubmitted(hold.id)).state).toBe('released');
 });
});
