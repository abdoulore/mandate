import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildDirectSwap,PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {DirectAttemptStore,Ledger,PlanBoundDirectStore,embeddedDatabase} from '@mandate/store';

const wallet='0x'+'4'.repeat(40),accountId=capitalAccountId(wallet),amount=10n**18n;
const ledgers:Ledger[]=[];
afterEach(async()=>{for(const ledger of ledgers.splice(0))await ledger.close();});

async function setup(){
 const ledger=new Ledger(embeddedDatabase());ledgers.push(ledger);await ledger.migrate();
 const checkpoint={accountId,wallet,asset:{chainId:56,contract:PANCAKE_V3.usdt.toLowerCase(),decimals:18},balanceAtomic:(3n*amount).toString(),blockNumber:'100',blockHash:'0x'+'5'.repeat(64),observedAt:new Date().toISOString(),positions:passportDefinitions().map(p=>({contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1' as const,state:'OBSERVED' as const})),evidenceMode:'observed' as const};
 await ledger.applyCapitalCheckpoint(checkpoint);
 await ledger.saveCapitalPolicy(accountId,{reserveFloor:'1',operatingBudget:'0',obligations:[]},(await ledger.capitalState(accountId))!.revision);
 const mandate=await ledger.saveInvestmentMandate(accountId,{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:100,allowLeveraged:false,representationAllowlist:[PANCAKE_V3.spyOn.toLowerCase()],exposureScope:'tracked-holdings-pending-proposed'},0);
 const state=await ledger.capitalState(accountId),transaction=buildDirectSwap({direction:'BUY',recipient:wallet as `0x${string}`,amountIn:amount,quotedOut:1290000000000000n,nowMs:Date.now()});
 const input={accountId,wallet,expectedAccountRevision:state!.revision,mandateId:mandate.id,mandateRevision:mandate.revision,cashPolicyRevision:state!.policyRevision,checkpointId:state!.checkpointId,amountAtomic:amount.toString(),minimumOutAtomic:transaction.amountOutMinimum.toString(),referencePriceUsd:'780',referenceUpdatedAt:new Date().toISOString(),routeCheckedAt:new Date().toISOString(),router:transaction.to,data:transaction.data,deadline:transaction.deadline.toString(),expiresAt:new Date(Date.now()+15000).toISOString()};
 return {ledger,store:new PlanBoundDirectStore(ledger.db),input};
}

describe('atomic plan-bound direct staging',{timeout:60000},()=>{
 it('creates a plan, cash hold and exact attempt together, then fences calldata before any wallet send',async()=>{
  const {ledger,store,input}=await setup();
  const {plan,reservation,attempt}=await store.prepare(input);
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
  expect(plan.inputHash).toBe(attempt.planBinding?.inputHash);
  expect(reservation.planRevisionId).toBe(plan.id);
  expect(attempt.planBinding?.reservationId).toBe(reservation.id);
  await expect(new DirectAttemptStore(ledger.db).begin(wallet,attempt.id)).rejects.toThrow('PLAN_BOUND_ATTEMPT_REQUIRES_LEDGER');
  const begun=await store.begin(wallet,attempt.id);
  expect(begun.state).toBe('submission_unknown');
  const barrier=(await ledger.db.query<{request_id:string}>('SELECT request_id FROM submission_barriers WHERE reservation_id=$1',[reservation.id])).rows[0];
  expect(barrier.request_id).toBe(attempt.id);
  await expect(store.begin(wallet,attempt.id)).rejects.toThrow('PLAN_DIRECT_ATTEMPT_NOT_PREPARED');
  await expect(store.abandon(wallet,attempt.id)).rejects.toThrow('PLAN_DIRECT_ATTEMPT_ALREADY_BEGUN');
  await expect(ledger.releaseUnsubmitted(reservation.id)).rejects.toThrow('PLAN_BOUND_ATTEMPT_REQUIRES_LEDGER');
  await expect(new DirectAttemptStore(ledger.db).settle(wallet,attempt.id,{status:'success',blockNumber:'100',blockHash:'0x'+'5'.repeat(64),confirmations:'12',observedAt:new Date().toISOString()})).rejects.toThrow('PLAN_BOUND_ATTEMPT_REQUIRES_LEDGER');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
 });
 it('releases an unsubmitted hold with its attempt and rejects stale policy or altered calldata',async()=>{
  const {ledger,store,input}=await setup();
  await expect(store.prepare({...input,data:input.data.slice(0,-1)+'f'})).rejects.toThrow('PLAN_DIRECT_CALLDATA_MISMATCH');
  await expect(store.prepare({...input,referencePriceUsd:'700'})).rejects.toThrow('PLAN_DIRECT_POLICY_BLOCKED');
  await expect(store.prepare({...input,cashPolicyRevision:0})).rejects.toThrow('STALE_PLAN_DIRECT_POLICY');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
  const {attempt,reservation}=await store.prepare(input);
  expect((await store.abandon(wallet,attempt.id)).state).toBe('abandoned');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
  expect((await ledger.db.query<{state:string}>('SELECT state FROM reservations WHERE id=$1',[reservation.id])).rows[0].state).toBe('released');
 });
 it('holds no money when cash protections consume the available balance',async()=>{
  const {ledger,store,input}=await setup();
  await ledger.saveCapitalPolicy(accountId,{reserveFloor:'3',operatingBudget:'0',obligations:[]},input.expectedAccountRevision);
  const state=await ledger.capitalState(accountId);
  await expect(store.prepare({...input,expectedAccountRevision:state!.revision,cashPolicyRevision:state!.policyRevision})).rejects.toThrow('PLAN_DIRECT_CASH_BLOCKED');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
  expect(await new DirectAttemptStore(ledger.db).history(wallet)).toEqual([]);
 });
 it('releases an unknown submission only with fresh post-deadline no-spend evidence',async()=>{
  const {ledger,store,input}=await setup();
  const {attempt,reservation,plan}=await store.prepare(input);
  await store.begin(wallet,attempt.id);
  const future=Number(attempt.deadline)*1000+65000,clock=vi.spyOn(Date,'now').mockReturnValue(future);
  const evidence={reason:'expired_without_observed_token_spend' as const,checkedAt:new Date(future).toISOString(),fromBlock:'100',throughBlock:'101',throughBlockHash:'0x'+'a'.repeat(64),throughTimestamp:(BigInt(attempt.deadline)+61n).toString()};
  try{
   await expect(store.releaseExpiredSwap(wallet,attempt.id,{...evidence,throughTimestamp:attempt.deadline})).rejects.toThrow('PLAN_DIRECT_RECOVERY_EVIDENCE_INVALID');
   expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
   await ledger.db.query('ALTER TABLE outbox ADD CONSTRAINT inject_direct_recovery_failure CHECK(false) NOT VALID');
   await expect(store.releaseExpiredSwap(wallet,attempt.id,evidence)).rejects.toThrow();
   expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
   await ledger.db.query('ALTER TABLE outbox DROP CONSTRAINT inject_direct_recovery_failure');
   const released=await store.releaseExpiredSwap(wallet,attempt.id,evidence);
   expect(released).toMatchObject({state:'abandoned',recovery:evidence});
   expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
   expect((await ledger.db.query<{state:string}>('SELECT state FROM reservations WHERE id=$1',[reservation.id])).rows[0].state).toBe('released');
   expect((await ledger.db.query<{status:string}>('SELECT status FROM plan_controls WHERE plan_id=$1',[plan.id])).rows[0].status).toBe('revoked');
   expect((await ledger.db.query<{request_id:string}>('SELECT request_id FROM submission_barriers WHERE reservation_id=$1',[reservation.id])).rows[0].request_id).toBe(attempt.id);
   await expect(store.releaseExpiredSwap(wallet,attempt.id,evidence)).rejects.toThrow('PLAN_DIRECT_RECOVERY_NOT_AVAILABLE');
  }finally{clock.mockRestore();}
 });
 it('keeps the plan hold when the wallet returned a transaction hash',async()=>{
  const {ledger,store,input}=await setup();
  const {attempt}=await store.prepare(input);
  await store.begin(wallet,attempt.id);
  await new DirectAttemptStore(ledger.db).recordHash(wallet,attempt.id,'0x'+'b'.repeat(64));
  const evidence={reason:'expired_without_observed_token_spend' as const,checkedAt:new Date().toISOString(),fromBlock:'100',throughBlock:'101',throughBlockHash:'0x'+'a'.repeat(64),throughTimestamp:(BigInt(attempt.deadline)+61n).toString()};
  await expect(store.releaseExpiredSwap(wallet,attempt.id,evidence)).rejects.toThrow('PLAN_DIRECT_RECOVERY_NOT_AVAILABLE');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
 });
 it('rolls back all three records when the audit event cannot commit',async()=>{
  const {ledger,store,input}=await setup();
  await ledger.db.query('ALTER TABLE outbox ADD CONSTRAINT inject_direct_plan_failure CHECK(false) NOT VALID');
  await expect(store.prepare(input)).rejects.toThrow();
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
  expect((await ledger.db.query<{count:string}>("SELECT COUNT(*)::text AS count FROM plans WHERE account_id=$1",[accountId])).rows[0].count).toBe('0');
  expect(await new DirectAttemptStore(ledger.db).history(wallet)).toEqual([]);
  await ledger.db.query('ALTER TABLE outbox DROP CONSTRAINT inject_direct_plan_failure');
 });
 it('keeps the hold and withholds calldata if the prepared payload changes',async()=>{
  const {ledger,store,input}=await setup();
  const {attempt,reservation}=await store.prepare(input);
  const altered={...attempt,data:attempt.data.slice(0,-1)+(attempt.data.endsWith('0')?'1':'0')};
  await ledger.db.query('UPDATE direct_attempts SET record=$2 WHERE id=$1',[attempt.id,JSON.stringify(altered)]);
  await expect(store.begin(wallet,attempt.id)).rejects.toThrow('PLAN_DIRECT_PAYLOAD_CHANGED');
  expect((await ledger.db.query('SELECT reservation_id FROM submission_barriers WHERE reservation_id=$1',[reservation.id])).rows).toEqual([]);
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
 });
 it('honors a plan pause before the submission fence',async()=>{
  const {ledger,store,input}=await setup();
  const {plan,attempt,reservation}=await store.prepare(input);
  await ledger.changePlanControl(accountId,plan.id,1,'pause');
  await expect(store.begin(wallet,attempt.id)).rejects.toThrow('PLAN_DIRECT_DISPATCH_BLOCKED');
  expect((await ledger.db.query('SELECT reservation_id FROM submission_barriers WHERE reservation_id=$1',[reservation.id])).rows).toEqual([]);
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
  await store.abandon(wallet,attempt.id);
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
 });
 it('reconciles a confirmed swap against a later observed checkpoint without a second debit',async()=>{
  const {ledger,store,input}=await setup();
  const {attempt,reservation}=await store.prepare(input);
  await store.begin(wallet,attempt.id);
  const hash='0x'+'6'.repeat(64),blockHash='0x'+'7'.repeat(64);
  await new DirectAttemptStore(ledger.db).recordHash(wallet,attempt.id,hash);
  const settlement={status:'success' as const,blockNumber:'101',blockHash,confirmations:'12',observedAt:new Date().toISOString(),spentAtomic:amount.toString(),receivedAtomic:input.minimumOutAtomic,gasCostWei:'100'};
  await expect(store.settle(wallet,attempt.id,settlement)).rejects.toThrow('PLAN_DIRECT_POST_TRADE_CHECKPOINT_REQUIRED');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe(amount.toString());
  const prior=(await ledger.capitalState(accountId))!.checkpoint!;
  await ledger.applyCapitalCheckpoint({...prior,blockNumber:'101',blockHash,balanceAtomic:(2n*amount).toString(),observedAt:new Date().toISOString(),positions:prior.positions.map(p=>p.contract.toLowerCase()===PANCAKE_V3.spyOn.toLowerCase()?{...p,rawAtomic:input.minimumOutAtomic}:p)});
  expect((await store.settle(wallet,attempt.id,settlement)).state).toBe('confirmed');
  expect((await store.settle(wallet,attempt.id,settlement)).state).toBe('confirmed');
  await expect(store.settle(wallet,attempt.id,{...settlement,receivedAtomic:'1'})).rejects.toThrow('PLAN_DIRECT_SETTLEMENT_CONFLICT');
  const state=await ledger.snapshot(accountId);
  expect(state.balanceAtomic).toBe((2n*amount).toString());
  expect(state.heldAtomic).toBe('0');
  expect((await ledger.db.query<{state:string}>('SELECT state FROM reservations WHERE id=$1',[reservation.id])).rows[0].state).toBe('consumed');
  expect((await ledger.db.query<{count:string}>('SELECT COUNT(*)::text AS count FROM receipts WHERE reservation_id=$1',[reservation.id])).rows[0].count).toBe('1');
 });
 it('releases the hold for a confirmed revert after a later wallet checkpoint',async()=>{
  const {ledger,store,input}=await setup();
  const {attempt,reservation}=await store.prepare(input);
  await store.begin(wallet,attempt.id);
  await new DirectAttemptStore(ledger.db).recordHash(wallet,attempt.id,'0x'+'8'.repeat(64));
  const prior=(await ledger.capitalState(accountId))!.checkpoint!,blockHash='0x'+'9'.repeat(64);
  await ledger.applyCapitalCheckpoint({...prior,blockNumber:'101',blockHash,observedAt:new Date().toISOString()});
  expect((await store.settle(wallet,attempt.id,{status:'reverted',blockNumber:'101',blockHash,confirmations:'12',observedAt:new Date().toISOString()})).state).toBe('reverted');
  expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
  expect((await ledger.db.query<{state:string}>('SELECT state FROM reservations WHERE id=$1',[reservation.id])).rows[0].state).toBe('released');
  expect((await ledger.db.query('SELECT id FROM receipts WHERE reservation_id=$1',[reservation.id])).rows).toEqual([]);
 });
});
