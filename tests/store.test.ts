import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Ledger,embeddedDatabase,postgresDatabase} from '@mandate/store';
import {accountRecordSchema,positionRecordSchema,authorizationRecordSchema,obligationRecordSchema,journalRecordSchema,durableAttemptRecordSchema,type AccountRecord,type PlanRevisionRecord,type ReceiptRecord} from '@mandate/domain';

const asset={chainId:56,contract:'0x'+'1'.repeat(40),decimals:18};
const base={schemaVersion:'1.0.0' as const,createdAt:'2026-09-22T12:00:00.000Z'};
const account=(id='account'):AccountRecord=>({...base,id,wallet:'0x'+'2'.repeat(40),asset,balanceAtomic:'4000000000000000000000',protectedAtomic:'1220000000000000000000',revision:0,observedAt:base.createdAt,evidenceMode:'synthetic'});
const plan=(id='plan',accountId='account',accountRevision=0):PlanRevisionRecord=>({...base,id,accountId,revision:1,accountRevision,decisionId:'decision',inputHash:'a'.repeat(64),maximumDebit:{asset,atomic:'2780000000000000000000'},evidenceMode:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()});
const reserve=(planRevisionId='plan',idempotencyKey='request',amountAtomic='2000000000000000000000')=>({accountId:'account',planRevisionId,idempotencyKey,amountAtomic});
const receipt=(reservationId:string):ReceiptRecord=>({...base,id:'receipt',reservationId,transactionHash:'0x'+'3'.repeat(64),blockNumber:'1',debitedAtomic:'1900000000000000000000',observedAt:base.createdAt,evidenceMode:'synthetic'});
let ledgers:Ledger[]=[];let dirs:string[]=[];
afterEach(async()=>{for(const ledger of ledgers)await ledger.close();ledgers=[];for(const dir of dirs){if(!resolve(dir).startsWith(resolve(tmpdir())+sep+'mandate-'))throw new Error('Unexpected cleanup path');await rm(dir,{recursive:true,force:true});}dirs=[];});
async function setup(path?:string){const ledger=new Ledger(embeddedDatabase(path));ledgers.push(ledger);await ledger.migrate();await ledger.createAccount(account());await ledger.savePlan(plan());return ledger;}

describe('durable accounting', {timeout:60000},()=>{
 it('preserves 18-decimal integer units and schema validation',()=>{
  expect(accountRecordSchema.parse(account()).balanceAtomic).toBe('4000000000000000000000');
  expect(()=>accountRecordSchema.parse({...account(),balanceAtomic:4e21})).toThrow();
  expect(()=>accountRecordSchema.parse({...account(),balanceAtomic:'1.2'})).toThrow();
  expect(()=>accountRecordSchema.parse({...account(),asset:{...asset,decimals:37}})).toThrow();
  positionRecordSchema.parse({...base,id:'position',accountId:'account',instrumentId:'stock',quantity:{asset,atomic:'1'},observedAt:base.createdAt,blockNumber:'1',evidenceMode:'synthetic'});
  obligationRecordSchema.parse({...base,id:'bill',accountId:'account',label:'Rent',amount:{asset,atomic:'1'},dueAt:null,status:'active'});
  authorizationRecordSchema.parse({...base,id:'auth',accountId:'account',planRevisionId:'plan',wallet:account().wallet,maximumDebit:{asset,atomic:'1'},expiresAt:base.createdAt,scope:'exact_plan_revision',revokedAt:null});
  journalRecordSchema.parse({...base,id:'event',accountId:'account',kind:'example',payload:{}});
  durableAttemptRecordSchema.parse({...base,id:'attempt',reservationId:'reserve',planRevisionId:'plan',wallet:account().wallet,chainId:56,state:'unknown',requestId:randomUUID(),aggregatorQuoteId:null,rfqOrderId:null,platformOrderId:null,transactionHash:null,expiresAt:null});
 });
 it('retries idempotently and rejects changed payloads',async()=>{
  const ledger=await setup();const first=await ledger.reserve(reserve());
  expect(await ledger.reserve(reserve())).toEqual(first);
  await expect(ledger.reserve(reserve('plan','request','1'))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  expect((await ledger.snapshot('account')).availableAtomic).toBe('780000000000000000000');
  expect(await ledger.pendingEvents()).toBe('3');
 });
 it('serializes competing plans and prevents overspending',async()=>{
  const ledger=await setup();await ledger.savePlan(plan('second'));
  const results=await Promise.allSettled([ledger.reserve(reserve()),ledger.reserve(reserve('second','second'))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await ledger.snapshot('account')).heldAtomic).toBe('2000000000000000000000');
  const revision=(await ledger.snapshot('account')).revision;
  await ledger.savePlan(plan('third','account',revision));
  await expect(ledger.reserve(reserve('third','third'))).rejects.toThrow('INSUFFICIENT_AVAILABLE');
 });
 it('rolls back financial writes if event delivery cannot be recorded',async()=>{
  const ledger=await setup();await ledger.db.query('ALTER TABLE outbox ADD CONSTRAINT inject_failure CHECK(false) NOT VALID');
  await expect(ledger.reserve(reserve())).rejects.toThrow();
  expect((await ledger.snapshot('account')).heldAtomic).toBe('0');
  expect((await ledger.snapshot('account')).revision).toBe(0);
  expect((await ledger.db.query('SELECT * FROM journal')).rows).toHaveLength(2);
  await ledger.db.query('ALTER TABLE outbox DROP CONSTRAINT inject_failure');
  await ledger.reserve(reserve());
 });
 it('rejects stale protection edits, wrong assets, expired plans and excess budgets',async()=>{
  const ledger=await setup();
  await expect(ledger.savePlan({...plan('wrong'),maximumDebit:{asset:{...asset,decimals:6},atomic:'1'}})).rejects.toThrow('ASSET_MISMATCH');
  await expect(ledger.savePlan({...plan('old'),expiresAt:base.createdAt})).rejects.toThrow('PLAN_EXPIRED');
  await expect(ledger.reserve(reserve('plan','big','3000000000000000000000'))).rejects.toThrow('PLAN_BUDGET_EXCEEDED');
  await ledger.reserve(reserve());
  await expect(ledger.setProtected('account','1',0)).rejects.toThrow('STALE_ACCOUNT');
  await expect(ledger.setProtected('account','3000000000000000000000',1)).rejects.toThrow('INSUFFICIENT_AVAILABLE');
 });
 it('holds uncertain submissions across restart and fences replay',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mandate-pg-'));dirs.push(dir);
  let ledger=await setup(dir);const reservation=await ledger.reserve(reserve());
  expect(await ledger.beginSubmission(reservation.id,'external-request')).toBe(true);
  await ledger.close();ledgers=[];
  ledger=new Ledger(embeddedDatabase(dir));ledgers.push(ledger);await ledger.migrate();
  expect((await ledger.snapshot('account')).heldAtomic).toBe(reservation.amountAtomic);
  expect(await ledger.beginSubmission(reservation.id,'external-request')).toBe(false);
  await expect(ledger.beginSubmission(reservation.id,'new-request')).rejects.toThrow('SUBMISSION_ALREADY_STARTED');
  await expect(ledger.releaseUnsubmitted(reservation.id)).rejects.toThrow('SUBMISSION_REQUIRES_RECONCILIATION');
  expect(await ledger.pendingEvents()).toBe('4');
 });
 it('reconciles once, returns unused hold and rejects conflicting receipts',async()=>{
  const ledger=await setup();const reservation=await ledger.reserve(reserve());const proof=receipt(reservation.id);
  await ledger.beginSubmission(reservation.id,'external-request');
  await expect(ledger.reconcile({...proof,debitedAtomic:'2100000000000000000000'})).rejects.toThrow('RESERVATION_EXCEEDED');
  await ledger.reconcile(proof);await ledger.reconcile(proof);
  const state=await ledger.snapshot('account');
  expect(state.balanceAtomic).toBe('2100000000000000000000');expect(state.heldAtomic).toBe('0');expect(state.availableAtomic).toBe('880000000000000000000');
  await expect(ledger.reconcile({...proof,debitedAtomic:'1'})).rejects.toThrow('RECEIPT_CONFLICT');
  await expect(ledger.releaseUnsubmitted(reservation.id)).rejects.toThrow('RESERVATION_FINAL');
 });
 it('recovers committed reservations after an abrupt process termination',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mandate-crash-'));dirs.push(dir);
  const original=await setup(dir);await original.close();ledgers=[];
  const child=fork(fileURLToPath(new URL('./fixtures/crash-writer.ts',import.meta.url)),[dir],{execArgv:['--experimental-transform-types'],stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr?.on('data',chunk=>{errors+=chunk.toString();});
  let reservationId:string;
  try {reservationId=await new Promise<string>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Crash writer timeout: '+errors)),45000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error('Crash writer exited '+code+': '+errors));});
   child.once('message',(message:any)=>{clearTimeout(timer);resolve(message.reservationId);});
  });} finally {if(child.exitCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGKILL');});}
  const recovered=new Ledger(embeddedDatabase(dir));ledgers.push(recovered);await recovered.migrate();
  expect((await recovered.snapshot('account')).heldAtomic).toBe('2000000000000000000000');
  expect(await recovered.beginSubmission(reservationId!,'crash-submission')).toBe(false);
  await expect(recovered.releaseUnsubmitted(reservationId!)).rejects.toThrow('SUBMISSION_REQUIRES_RECONCILIATION');
  expect(await recovered.pendingEvents()).toBe('4');
 });
 it('releases only unsubmitted reservations and cannot restart them',async()=>{
  const ledger=await setup();const reservation=await ledger.reserve(reserve());
  await ledger.releaseUnsubmitted(reservation.id);await ledger.releaseUnsubmitted(reservation.id);
  expect((await ledger.reserve(reserve())).state).toBe('released');
  expect((await ledger.snapshot('account')).availableAtomic).toBe('2780000000000000000000');
  await expect(ledger.beginSubmission(reservation.id,'request')).rejects.toThrow('RESERVATION_FINAL');
 });
 it('prevents one transaction receipt from debiting two reservations',async()=>{
  const ledger=await setup();const first=await ledger.reserve(reserve());
  await expect(ledger.reconcile(receipt(first.id))).rejects.toThrow('SUBMISSION_NOT_STARTED');
  await ledger.beginSubmission(first.id,'first');await ledger.reconcile(receipt(first.id));
  await ledger.savePlan(plan('second','account',(await ledger.snapshot('account')).revision));
  const second=await ledger.reserve(reserve('second','second','100000000000000000000'));
  await ledger.beginSubmission(second.id,'second');
  await expect(ledger.reconcile({...receipt(second.id),id:'another',debitedAtomic:'1'})).rejects.toThrow('RECEIPT_ALREADY_APPLIED');
  expect((await ledger.snapshot('account')).balanceAtomic).toBe('2100000000000000000000');
  expect((await ledger.snapshot('account')).heldAtomic).toBe('100000000000000000000');
 });
 it('reclaims abandoned outbox work and fences the old worker',async()=>{
  const ledger=await setup();const first=(await ledger.claimEvent())!;
  await ledger.db.query("UPDATE outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id]);
  const second=(await ledger.claimEvent())!;expect(second.id).toBe(first.id);expect(second.token).not.toBe(first.token);
  await expect(ledger.acknowledgeEvent(first.id,first.token)).rejects.toThrow('LEASE_LOST');
  await ledger.acknowledgeEvent(second.id,second.token);
  const next=(await ledger.claimEvent())!;expect(next.id).not.toBe(first.id);await ledger.acknowledgeEvent(next.id,next.token);
  expect(await ledger.claimEvent()).toBeNull();
 });
 it('gives concurrent workers different claims',async()=>{
  const ledger=await setup();const claims=await Promise.all([ledger.claimEvent(),ledger.claimEvent()]);expect(claims[0]!.id).not.toBe(claims[1]!.id);
 });
});

// Dedicated test database only. This verifies server row locks using separate pooled connections.
it.skipIf(!process.env.MANDATE_TEST_DATABASE_URL)('PostgreSQL server concurrent reservation gate',async()=>{
 const ledger=new Ledger(postgresDatabase(process.env.MANDATE_TEST_DATABASE_URL!));ledgers.push(ledger);await ledger.migrate();
 const id=randomUUID();await ledger.createAccount(account(id));const p1=plan(randomUUID(),id),p2=plan(randomUUID(),id);await ledger.savePlan(p1);await ledger.savePlan(p2);
 const results=await Promise.allSettled([ledger.reserve({...reserve(p1.id),accountId:id}),ledger.reserve({...reserve(p2.id,'other'),accountId:id})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
