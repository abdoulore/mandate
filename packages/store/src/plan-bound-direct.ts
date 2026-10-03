import {createHash,randomUUID} from 'node:crypto';
import {atomicSchema,planRevisionRecordSchema,receiptRecordSchema,type AccountRecord,type CapitalCheckpoint,type PlanRevisionRecord,type ReservationRecord,type SavedInvestmentMandate} from '@mandate/domain';
import {parseUnits} from '@mandate/core';
import type {Database,Queryable} from './database.ts';
import type {DirectAttempt} from './direct-attempt.ts';

const USDT='0x55d398326f99059ff775485246999027b3197955';
const SPYON='0x6a708ead771238919d85930b5a0f10454e1c331a';
const ROUTER='0x1b81d678ffb9c0263b24a97847620c99d213eb14';
const unit=10n**18n;
const address=/^0x[0-9a-fA-F]{40}$/;
const transactionHash=/^0x[0-9a-fA-F]{64}$/;
const atomic=(value:string)=>atomicSchema.safeParse(value).success;
const payloadHash=(attempt:Pick<DirectAttempt,'wallet'|'chainId'|'to'|'data'|'valueAtomic'|'tokenIn'|'tokenOut'|'amountInAtomic'|'minimumOutAtomic'|'deadline'|'expiresAt'>)=>createHash('sha256').update(JSON.stringify([attempt.wallet,attempt.chainId,attempt.to,attempt.data,attempt.valueAtomic,attempt.tokenIn,attempt.tokenOut,attempt.amountInAtomic,attempt.minimumOutAtomic,attempt.deadline,attempt.expiresAt])).digest('hex');
export class PlanBoundDirectError extends Error{constructor(public code:string){super(code);}}
const fail=(code:string):never=>{throw new PlanBoundDirectError(code);};

export type PlanDirectPreparation={accountId:string;wallet:string;expectedAccountRevision:number;mandateId:string;mandateRevision:number;cashPolicyRevision:number;checkpointId:string;amountAtomic:string;minimumOutAtomic:string;referencePriceUsd:string;referenceUpdatedAt:string;routeCheckedAt:string;router:string;data:string;deadline:string;expiresAt:string};

function checkedPayload(input:PlanDirectPreparation){
 if(!address.test(input.wallet)||!address.test(input.router)||input.router.toLowerCase()!==ROUTER||!atomic(input.amountAtomic)||!atomic(input.minimumOutAtomic)||!atomic(input.deadline))fail('INVALID_PLAN_DIRECT_PAYLOAD');
 const amount=BigInt(input.amountAtomic),minimum=BigInt(input.minimumOutAtomic),deadline=BigInt(input.deadline);
 if(amount<=0n||amount>10n*unit||minimum<=0n||!/^0x[0-9a-fA-F]+$/.test(input.data)||input.data.length!==522||input.data.slice(0,10).toLowerCase()!=='0x414bf389')fail('INVALID_PLAN_DIRECT_PAYLOAD');
 const words=Array.from({length:8},(_,i)=>input.data.slice(10+i*64,10+(i+1)*64).toLowerCase());
 const wordAddress=(word:string)=>word.startsWith('0'.repeat(24))?'0x'+word.slice(24):null;
 if(wordAddress(words[0])!==USDT||wordAddress(words[1])!==SPYON||BigInt('0x'+words[2])!==2500n||wordAddress(words[3])!==input.wallet.toLowerCase()||BigInt('0x'+words[4])!==deadline||BigInt('0x'+words[5])!==amount||BigInt('0x'+words[6])!==minimum||BigInt('0x'+words[7])!==0n)fail('PLAN_DIRECT_CALLDATA_MISMATCH');
 const now=Date.now(),routeAge=now-Date.parse(input.routeCheckedAt),referenceAge=now-Date.parse(input.referenceUpdatedAt),expiry=Date.parse(input.expiresAt);
 if(!Number.isFinite(routeAge)||routeAge<0||routeAge>10000||!Number.isFinite(referenceAge)||referenceAge< -10000||referenceAge>300000||!Number.isFinite(expiry)||expiry<=now||expiry>now+20000||deadline*1000n<BigInt(Math.ceil(expiry)))fail('PLAN_DIRECT_EVIDENCE_STALE');
 let price=0n;try{price=parseUnits(input.referencePriceUsd,18);}catch{fail('PLAN_DIRECT_REFERENCE_INVALID');}
 const fairCash=minimum*price/unit;if(price<=0n||fairCash<=0n)fail('PLAN_DIRECT_REFERENCE_INVALID');
 const costBps=amount>fairCash?((amount-fairCash)*10000n+fairCash-1n)/fairCash:0n;
 return {amount,minimum,costBps,expiry};
}

async function event(tx:Queryable,accountId:string,kind:string,payload:Record<string,unknown>){
 const id=randomUUID(),envelope={schemaVersion:'1.0.0',id,accountId,kind,payload,createdAt:new Date().toISOString()};
 await tx.query('INSERT INTO journal(id,account_id,kind,payload) VALUES($1,$2,$3,$4)',[id,accountId,kind,JSON.stringify(envelope)]);
 await tx.query('INSERT INTO outbox(id,payload) VALUES($1,$2)',[id,JSON.stringify(envelope)]);
}

// Internal staging boundary. No HTTP route calls this yet: receipt and
// observed-capital reconciliation must be joined before wallet dispatch.
export class PlanBoundDirectStore{
 constructor(private readonly db:Database){}
 async prepare(input:PlanDirectPreparation){
  const {amount,costBps}=checkedPayload(input);
  return this.db.transaction(async tx=>{
   const account=(await tx.query<{record:AccountRecord;balance:string;protected:string;revision:number}>('SELECT record,balance::text,protected::text,revision FROM accounts WHERE id=$1 FOR UPDATE',[input.accountId])).rows[0];
   if(!account||account.record.wallet.toLowerCase()!==input.wallet.toLowerCase()||account.record.evidenceMode!=='observed'||account.record.asset.chainId!==56||account.record.asset.contract.toLowerCase()!==USDT||account.record.asset.decimals!==18)fail('PLAN_DIRECT_ACCOUNT_MISMATCH');
   if(account.revision!==input.expectedAccountRevision)fail('STALE_PLAN_DIRECT_ACCOUNT');
   const head=(await tx.query<{checkpoint_id:string;state:string;record:CapitalCheckpoint}>("SELECT h.checkpoint_id,health.state,c.record FROM capital_heads h JOIN capital_checkpoints c ON c.id=h.checkpoint_id LEFT JOIN capital_health health ON health.account_id=h.account_id WHERE h.account_id=$1",[input.accountId])).rows[0];
   if(!head||head.checkpoint_id!==input.checkpointId||head.state!=='OBSERVED'||Date.now()-Date.parse(head.record.observedAt)>60000||Date.now()-Date.parse(head.record.observedAt)<0)fail('PLAN_DIRECT_CAPITAL_STALE');
   // The first dispatch adapter is deliberately restricted to an empty tracked
   // portfolio; multi-leg allocation requires a separate certified policy path.
   if(head.record.positions.length!==14||head.record.positions.some(p=>p.state!=='OBSERVED'||p.rawAtomic!=='0'))fail('PLAN_DIRECT_PORTFOLIO_UNRESOLVED');
   const mandate=(await tx.query<{record:SavedInvestmentMandate}>('SELECT record FROM investment_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[input.accountId])).rows[0]?.record;
   const policy=(await tx.query<{revision:number}>('SELECT revision FROM capital_policies WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[input.accountId])).rows[0];
   if(!mandate||mandate.id!==input.mandateId||mandate.revision!==input.mandateRevision||!policy||policy.revision!==input.cashPolicyRevision)fail('STALE_PLAN_DIRECT_POLICY');
   if(!mandate.policy.representationAllowlist.includes(SPYON)||mandate.policy.allocations.length!==1||mandate.policy.allocations[0]?.underlying!=='SPY'||mandate.policy.allocations[0]?.weightBps!==10000||mandate.policy.maxIssuerBps!==10000||costBps>BigInt(mandate.policy.maxCostBps))fail('PLAN_DIRECT_POLICY_BLOCKED');
   const held=(await tx.query<{amount:string}>("SELECT COALESCE(SUM(amount),0)::text AS amount FROM reservations WHERE account_id=$1 AND state='held'",[input.accountId])).rows[0].amount;
   if(amount+BigInt(account.protected)+BigInt(held)>BigInt(account.balance))fail('PLAN_DIRECT_CASH_BLOCKED');
   const active=(await tx.query<{id:string}>("SELECT id FROM direct_attempts WHERE wallet=$1 AND state IN ('prepared','submission_unknown','submitted') FOR UPDATE",[input.wallet.toLowerCase()])).rows[0];
   if(active)fail('DIRECT_ATTEMPT_PENDING');
   const createdAt=new Date().toISOString(),planId=randomUUID(),reservationId=randomUUID(),attemptId=randomUUID();
   const inputHash=createHash('sha256').update(JSON.stringify([input.accountId,input.wallet.toLowerCase(),input.mandateId,input.mandateRevision,input.cashPolicyRevision,input.checkpointId,input.amountAtomic,input.minimumOutAtomic,input.referencePriceUsd,input.referenceUpdatedAt,input.router.toLowerCase(),input.data.toLowerCase(),input.deadline,input.expiresAt])).digest('hex');
   const plan:PlanRevisionRecord=planRevisionRecordSchema.parse({schemaVersion:'1.0.0',id:planId,accountId:input.accountId,revision:1,accountRevision:account.revision,createdAt,decisionId:'direct-spyon-'+inputHash.slice(0,32),inputHash,maximumDebit:{asset:account.record.asset,atomic:input.amountAtomic},evidenceMode:'live',expiresAt:input.expiresAt,exposureModel:{currency:'USD-nominal-USDT-parity',legs:[{instrumentId:SPYON,issuer:'ondo',underlying:'SPY',valueAtomic:input.amountAtomic}]}});
   const reservation:ReservationRecord={schemaVersion:'1.0.0',id:reservationId,accountId:input.accountId,planRevisionId:planId,idempotencyKey:attemptId,amountAtomic:input.amountAtomic,createdAt,state:'held'};
   const attempt:DirectAttempt={id:attemptId,wallet:input.wallet.toLowerCase(),kind:'swap',direction:'BUY',chainId:56,to:ROUTER,data:input.data.toLowerCase(),valueAtomic:'0',tokenIn:USDT,tokenOut:SPYON,amountInAtomic:input.amountAtomic,minimumOutAtomic:input.minimumOutAtomic,deadline:input.deadline,preparedAt:createdAt,expiresAt:input.expiresAt,state:'prepared',transactionHash:null,settlement:null,planBinding:{accountId:input.accountId,planId,reservationId,mandateId:mandate.id,mandateRevision:mandate.revision,cashPolicyRevision:policy.revision,checkpointId:input.checkpointId,inputHash,payloadHash:''}};
   attempt.planBinding!.payloadHash=payloadHash(attempt);
   await tx.query('INSERT INTO plans(id,account_id,record) VALUES($1,$2,$3)',[planId,input.accountId,JSON.stringify(plan)]);
   await tx.query("INSERT INTO plan_controls(plan_id,account_id,status,revision) VALUES($1,$2,'active',1)",[planId,input.accountId]);
   await tx.query('INSERT INTO reservations(id,account_id,plan_id,idempotency_key,amount,state,record) VALUES($1,$2,$3,$4,$5,$6,$7)',[reservationId,input.accountId,planId,attemptId,input.amountAtomic,'held',JSON.stringify(reservation)]);
   await tx.query('INSERT INTO direct_attempts(id,wallet,kind,direction,state,record) VALUES($1,$2,$3,$4,$5,$6)',[attemptId,attempt.wallet,'swap','BUY','prepared',JSON.stringify(attempt)]);
   await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[input.accountId]);
   await event(tx,input.accountId,'direct.plan.prepared',{planId,reservationId,attemptId,inputHash,mandateRevision:mandate.revision,cashPolicyRevision:policy.revision,amountAtomic:input.amountAtomic,costBps:costBps.toString()});
   return {plan,reservation,attempt};
  });
 }
 async begin(wallet:string,attemptId:string){
  return this.db.transaction(async tx=>{
   const pointer=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2',[wallet.toLowerCase(),attemptId])).rows[0]?.record;
   const binding=pointer?.planBinding;if(!binding)throw new PlanBoundDirectError('PLAN_DIRECT_ATTEMPT_NOT_FOUND');
   const account=(await tx.query<{revision:number}>('SELECT revision FROM accounts WHERE id=$1 FOR UPDATE',[binding.accountId])).rows[0];
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),attemptId])).rows[0]?.record;
   if(!row?.planBinding||row.planBinding.reservationId!==binding.reservationId||row.state!=='prepared')throw new PlanBoundDirectError('PLAN_DIRECT_ATTEMPT_NOT_PREPARED');
   if(row.planBinding.payloadHash!==payloadHash(row)||row.planBinding.inputHash!==binding.inputHash)fail('PLAN_DIRECT_PAYLOAD_CHANGED');
   if(Date.parse(row.expiresAt)<=Date.now())fail('PLAN_DIRECT_ATTEMPT_EXPIRED');
   const plan=(await tx.query<{record:PlanRevisionRecord}>('SELECT record FROM plans WHERE id=$1 AND account_id=$2',[binding.planId,binding.accountId])).rows[0]?.record;
   const reservation=(await tx.query<{state:string;plan_id:string}>('SELECT state,plan_id FROM reservations WHERE id=$1 AND account_id=$2',[binding.reservationId,binding.accountId])).rows[0];
   const control=(await tx.query<{status:string}>('SELECT status FROM plan_controls WHERE plan_id=$1',[binding.planId])).rows[0];
   const head=(await tx.query<{checkpoint_id:string;state:string;record:CapitalCheckpoint}>("SELECT h.checkpoint_id,health.state,c.record FROM capital_heads h JOIN capital_checkpoints c ON c.id=h.checkpoint_id LEFT JOIN capital_health health ON health.account_id=h.account_id WHERE h.account_id=$1",[binding.accountId])).rows[0];
   if(!account||!plan||plan.inputHash!==binding.inputHash||account.revision!==plan.accountRevision+1||!reservation||reservation.state!=='held'||reservation.plan_id!==plan.id||control?.status!=='active'||!head||head.checkpoint_id!==binding.checkpointId||head.state!=='OBSERVED'||Date.now()-Date.parse(head.record.observedAt)>60000)fail('PLAN_DIRECT_DISPATCH_BLOCKED');
   await tx.query('INSERT INTO submission_barriers(reservation_id,request_id) VALUES($1,$2)',[binding.reservationId,attemptId]);
   const begun={...row,state:'submission_unknown' as const};
   await tx.query("UPDATE direct_attempts SET state='submission_unknown',record=$2,updated_at=clock_timestamp() WHERE id=$1",[attemptId,JSON.stringify(begun)]);
   await event(tx,binding.accountId,'direct.plan.submission_started',{planId:binding.planId,reservationId:binding.reservationId,attemptId,inputHash:binding.inputHash});
   return begun;
  });
 }
 async abandon(wallet:string,attemptId:string){
  return this.db.transaction(async tx=>{
   const pointer=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2',[wallet.toLowerCase(),attemptId])).rows[0]?.record;
   const binding=pointer?.planBinding;if(!binding)throw new PlanBoundDirectError('PLAN_DIRECT_ATTEMPT_NOT_FOUND');
   await tx.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[binding.accountId]);
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),attemptId])).rows[0]?.record;
   if(!row?.planBinding||row.state!=='prepared')fail('PLAN_DIRECT_ATTEMPT_ALREADY_BEGUN');
   if((await tx.query('SELECT reservation_id FROM submission_barriers WHERE reservation_id=$1',[binding.reservationId])).rows.length)fail('PLAN_DIRECT_SUBMISSION_STARTED');
   const reservation=(await tx.query<{record:ReservationRecord}>('SELECT record FROM reservations WHERE id=$1 AND account_id=$2 FOR UPDATE',[binding.reservationId,binding.accountId])).rows[0]?.record;
   if(!reservation||reservation.planRevisionId!==binding.planId||!['held','released'].includes(reservation.state))fail('PLAN_DIRECT_RESERVATION_CONFLICT');
   const abandoned={...row,state:'abandoned' as const};
   await tx.query("UPDATE direct_attempts SET state='abandoned',record=$2,updated_at=clock_timestamp() WHERE id=$1",[attemptId,JSON.stringify(abandoned)]);
   if(reservation.state==='held'){
    const released={...reservation,state:'released' as const};
    await tx.query("UPDATE reservations SET state='released',record=$2 WHERE id=$1",[reservation.id,JSON.stringify(released)]);
    await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[binding.accountId]);
   }
   await tx.query("UPDATE plan_controls SET status='revoked',revision=revision+1,updated_at=clock_timestamp() WHERE plan_id=$1 AND status='active'",[binding.planId]);
   await event(tx,binding.accountId,'direct.plan.abandoned',{planId:binding.planId,reservationId:binding.reservationId,attemptId});
   return abandoned;
  });
 }
 // Caller must verify the canonical chain receipt and token transfers before
 // supplying settlement. The subsequent checkpoint is independent evidence of
 // the resulting wallet balance and position; neither alone closes the hold.
 async settle(wallet:string,attemptId:string,settlement:NonNullable<DirectAttempt['settlement']>){
  if(!atomic(settlement.blockNumber)||!transactionHash.test(settlement.blockHash)||!atomic(settlement.confirmations)||BigInt(settlement.confirmations)<12n||!Number.isFinite(Date.parse(settlement.observedAt))||settlement.gasCostWei!==undefined&&!atomic(settlement.gasCostWei))fail('INVALID_PLAN_DIRECT_SETTLEMENT');
  if(settlement.status==='success'&&(!settlement.spentAtomic||!atomic(settlement.spentAtomic)||!settlement.receivedAtomic||!atomic(settlement.receivedAtomic)))fail('INVALID_PLAN_DIRECT_SETTLEMENT');
  if(settlement.status==='reverted'&&(settlement.spentAtomic!==undefined||settlement.receivedAtomic!==undefined))fail('INVALID_PLAN_DIRECT_SETTLEMENT');
  return this.db.transaction(async tx=>{
   const pointer=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2',[wallet.toLowerCase(),attemptId])).rows[0]?.record;
   const binding=pointer?.planBinding;if(!binding)throw new PlanBoundDirectError('PLAN_DIRECT_ATTEMPT_NOT_FOUND');
   const account=(await tx.query<{balance:string}>('SELECT balance::text FROM accounts WHERE id=$1 FOR UPDATE',[binding.accountId])).rows[0];
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),attemptId])).rows[0]?.record;
   if(!row?.planBinding||row.planBinding.reservationId!==binding.reservationId)throw new PlanBoundDirectError('PLAN_DIRECT_ATTEMPT_NOT_FOUND');
   if(row.state==='confirmed'||row.state==='reverted'){
    const prior=row.settlement;
    if(!prior||JSON.stringify([prior.status,prior.blockNumber,prior.blockHash,prior.spentAtomic,prior.receivedAtomic,prior.gasCostWei])!==JSON.stringify([settlement.status,settlement.blockNumber,settlement.blockHash,settlement.spentAtomic,settlement.receivedAtomic,settlement.gasCostWei]))fail('PLAN_DIRECT_SETTLEMENT_CONFLICT');
    return row;
   }
   if(row.state!=='submitted'||!row.transactionHash||row.planBinding.payloadHash!==payloadHash(row))fail('PLAN_DIRECT_NOT_SUBMITTED');
   if(!(await tx.query('SELECT reservation_id FROM submission_barriers WHERE reservation_id=$1 AND request_id=$2',[binding.reservationId,attemptId])).rows.length)fail('PLAN_DIRECT_SUBMISSION_MISSING');
   const reservation=(await tx.query<{record:ReservationRecord}>('SELECT record FROM reservations WHERE id=$1 AND account_id=$2 FOR UPDATE',[binding.reservationId,binding.accountId])).rows[0]?.record;
   if(!reservation||reservation.state!=='held'||reservation.planRevisionId!==binding.planId)fail('PLAN_DIRECT_RESERVATION_CONFLICT');
   const head=(await tx.query<{record:CapitalCheckpoint}>("SELECT c.record FROM capital_heads h JOIN capital_checkpoints c ON c.id=h.checkpoint_id JOIN capital_health health ON health.account_id=h.account_id WHERE h.account_id=$1 AND health.state='OBSERVED'",[binding.accountId])).rows[0]?.record;
   if(!account||!head||BigInt(head.blockNumber)<BigInt(settlement.blockNumber)||BigInt(head.balanceAtomic)!==BigInt(account.balance)||BigInt(head.blockNumber)===BigInt(settlement.blockNumber)&&head.blockHash.toLowerCase()!==settlement.blockHash.toLowerCase())fail('PLAN_DIRECT_POST_TRADE_CHECKPOINT_REQUIRED');
   if(settlement.status==='success'){
    const previous=(await tx.query<{record:CapitalCheckpoint}>('SELECT record FROM capital_checkpoints WHERE id=$1 AND account_id=$2',[binding.checkpointId,binding.accountId])).rows[0]?.record;
    const received=head.positions.find(p=>p.contract.toLowerCase()===SPYON);
    if(!previous||BigInt(settlement.spentAtomic!)!==BigInt(row.amountInAtomic)||BigInt(settlement.receivedAtomic!)<BigInt(row.minimumOutAtomic)||BigInt(head.balanceAtomic)>BigInt(previous.balanceAtomic)-BigInt(settlement.spentAtomic!)||!received||received.state!=='OBSERVED'||received.rawAtomic===null||BigInt(received.rawAtomic)<BigInt(settlement.receivedAtomic!))fail('PLAN_DIRECT_TOKEN_FLOW_MISMATCH');
    const receipt=receiptRecordSchema.parse({schemaVersion:'1.0.0',id:randomUUID(),createdAt:new Date().toISOString(),reservationId:reservation.id,transactionHash:row.transactionHash,blockNumber:settlement.blockNumber,debitedAtomic:settlement.spentAtomic,observedAt:settlement.observedAt,evidenceMode:'confirmed'});
    await tx.query('INSERT INTO receipts(id,reservation_id,account_id,transaction_hash,record) VALUES($1,$2,$3,$4,$5)',[receipt.id,reservation.id,binding.accountId,row.transactionHash,JSON.stringify(receipt)]);
   }
   const state=settlement.status==='success'?'consumed':'released';
   await tx.query('UPDATE reservations SET state=$2,record=$3 WHERE id=$1',[reservation.id,state,JSON.stringify({...reservation,state})]);
   await tx.query("UPDATE plan_controls SET status='revoked',revision=revision+1,updated_at=clock_timestamp() WHERE plan_id=$1 AND status IN ('active','paused','cancellation_requested')",[binding.planId]);
   const settled={...row,state:settlement.status==='success'?'confirmed' as const:'reverted' as const,settlement};
   await tx.query('UPDATE direct_attempts SET state=$2,record=$3,updated_at=clock_timestamp() WHERE id=$1',[attemptId,settled.state,JSON.stringify(settled)]);
   // applyCapitalCheckpoint already wrote the observed balance. Subtracting
   // the receipt debit here would count the same on-chain spend twice.
   await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[binding.accountId]);
   await event(tx,binding.accountId,'direct.plan.settled',{planId:binding.planId,reservationId:reservation.id,attemptId,transactionHash:row.transactionHash,status:settlement.status,checkpointBlock:head.blockNumber});
   return settled;
  });
 }
}
