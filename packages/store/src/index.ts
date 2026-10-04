import {randomUUID,createHash} from 'node:crypto';
import {accountRecordSchema,planRevisionRecordSchema,receiptRecordSchema,atomicSchema,type AccountRecord,type PlanRevisionRecord,type PlanControl,type ReservationRecord,type ReceiptRecord} from '@mandate/domain';
import {migration,type Database,type Queryable} from './database.ts';
import {capitalCheckpointSchema,capitalPolicySchema,type CapitalCheckpoint,type CapitalPolicy} from '@mandate/domain';
import {capitalProtection,compareResearchProposals,previewRebalance,previewCashRaising,classifyInflow,previewInvestment} from '@mandate/core';
import {capitalMigration} from './capital-migration.ts';
import type {PendingExposure} from '@mandate/domain';
import {investmentPolicySchema,type InvestmentPolicy,type SavedInvestmentMandate,type ResearchProposal,type ResearchRebalance,type ResearchCashRaising,type InflowProof,type InflowReview,type InflowRecord} from '@mandate/domain';
import {researchMigration} from './research-migration.ts';
import {rebalanceMigration} from './rebalance-migration.ts';
import {cashRaisingMigration} from './cash-raising-migration.ts';
import {inflowMigration} from './inflow-migration.ts';
import {recurringMigration} from './recurring-migration.ts';
import {planControlMigration} from './plan-control-migration.ts';
import {directAttemptMigration} from './direct-attempt.ts';
import {directTrialMandateMigration} from './direct-trial-mandate-migration.ts';
export {RecurringStore} from './recurring.ts';
export {DirectAttemptStore,DirectAttemptError,type DirectAttempt} from './direct-attempt.ts';
export {PlanBoundDirectStore,PlanBoundDirectError,type PlanDirectPreparation} from './plan-bound-direct.ts';
export {embeddedDatabase,postgresDatabase,type Database} from './database.ts';

export class LedgerError extends Error {constructor(public code:string){super(code);}}
const fail=(code:string):never=>{throw new LedgerError(code);};
const canonical=(a:unknown):string=>JSON.stringify(a,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const same=(a:unknown,b:unknown):boolean=>canonical(a)===canonical(b);
const positive=(value:string)=>{atomicSchema.parse(value);if(BigInt(value)<=0n)fail('INVALID_AMOUNT');return value;};
const iso=()=>new Date().toISOString();
const planControl=(row:{plan_id:string;account_id:string;status:PlanControl['status'];revision:number;created_at:string;updated_at:string}):PlanControl=>({planId:row.plan_id,accountId:row.account_id,status:row.status,revision:row.revision,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});

export class Ledger {
 constructor(readonly db:Database){}
 async migrate(){await this.db.transaction(async tx=>{for(const sql of migration.split(';').filter(s=>s.trim()))await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=2')).rows.length){
  const constraints=(await tx.query<{conname:string;definition:string}>("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='accounts'::regclass AND contype='c'")).rows;
  for(const c of constraints)if(c.definition.includes('protected')&&c.definition.includes('balance')){if(!/^[a-z_]+$/.test(c.conname))fail('UNEXPECTED_CONSTRAINT');await tx.query(`ALTER TABLE accounts DROP CONSTRAINT ${c.conname}`);}
  for(const sql of capitalMigration)await tx.query(sql);
  }if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=3')).rows.length)for(const sql of researchMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=4')).rows.length)for(const sql of rebalanceMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=5')).rows.length)for(const sql of cashRaisingMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=6')).rows.length)for(const sql of inflowMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=7')).rows.length)for(const sql of recurringMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=8')).rows.length)for(const sql of planControlMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=9')).rows.length)for(const sql of directAttemptMigration)await tx.query(sql);if(!(await tx.query('SELECT version FROM mandate_schema WHERE version=10')).rows.length)for(const sql of directTrialMandateMigration)await tx.query(sql);});}
 async close(){await this.db.close();}
 async investmentMandates(accountId:string){return (await this.db.query<{record:SavedInvestmentMandate}>('SELECT record FROM investment_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 20',[accountId])).rows.map(r=>r.record);}
 async directTrialMandates(accountId:string){return (await this.db.query<{record:SavedInvestmentMandate}>('SELECT record FROM direct_trial_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 20',[accountId])).rows.map(r=>r.record);}
 async saveDirectTrialMandate(accountId:string,maxCostBps:number,expectedRevision:number){
  if(!Number.isInteger(maxCostBps)||maxCostBps<0||maxCostBps>200||!Number.isInteger(expectedRevision)||expectedRevision<0)fail('INVALID_DIRECT_TRIAL_MANDATE');
  const policy=investmentPolicySchema.parse({allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps,allowLeveraged:false,representationAllowlist:['0x6a708ead771238919d85930b5a0f10454e1c331a'],exposureScope:'tracked-holdings-pending-proposed'});
  return this.db.transaction(async tx=>{await this.lockedAccount(tx,accountId);const previous=(await tx.query<{record:SavedInvestmentMandate}>('SELECT record FROM direct_trial_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[accountId])).rows[0]?.record;
   if((previous?.revision??0)!==expectedRevision)fail('STALE_DIRECT_TRIAL_MANDATE');if(previous&&same(previous.policy,policy))return previous;
   const account=(await tx.query<{record:AccountRecord}>('SELECT record FROM accounts WHERE id=$1',[accountId])).rows[0]?.record;
   const active=(await tx.query<{id:string}>("SELECT id FROM direct_attempts WHERE wallet=$1 AND state IN ('prepared','submission_unknown','submitted') LIMIT 1",[account?.wallet.toLowerCase()??''])).rows[0];
   if(active)fail('DIRECT_ATTEMPT_PENDING');
   const record:SavedInvestmentMandate={id:randomUUID(),accountId,revision:expectedRevision+1,createdAt:iso(),policy,researchOnly:true};
   await tx.query('INSERT INTO direct_trial_mandates(account_id,revision,id,record) VALUES($1,$2,$3,$4)',[accountId,record.revision,record.id,JSON.stringify(record)]);
   await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[accountId]);await this.event(tx,accountId,'direct.trial_mandate.saved',{mandateId:record.id,mandateRevision:record.revision,maxCostBps});return record;
  });
 }
 async saveInvestmentMandate(accountId:string,value:InvestmentPolicy,expectedRevision:number){
  const policy=investmentPolicySchema.parse(value);policy.representationAllowlist.sort();
  if(!Number.isInteger(expectedRevision)||expectedRevision<0)fail('INVALID_REVISION');
  return this.db.transaction(async tx=>{await this.lockedAccount(tx,accountId);const previous=(await tx.query<{record:SavedInvestmentMandate}>('SELECT record FROM investment_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[accountId])).rows[0]?.record;
   if((previous?.revision??0)!==expectedRevision)fail('STALE_MANDATE');if(previous&&same(previous.policy,policy))return previous;
   const record:SavedInvestmentMandate={id:randomUUID(),accountId,revision:expectedRevision+1,createdAt:iso(),policy,researchOnly:true};
   await tx.query('INSERT INTO investment_mandates(account_id,revision,id,record) VALUES($1,$2,$3,$4)',[accountId,record.revision,record.id,JSON.stringify(record)]);
   await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[accountId]);await this.event(tx,accountId,'investment.mandate.saved',{mandateId:record.id,mandateRevision:record.revision});return record;
  });
 }
 async researchProposal(accountId:string,requestId:string){return (await this.db.query<{record:ResearchProposal}>('SELECT record FROM research_proposals WHERE account_id=$1 AND request_id=$2',[accountId,requestId])).rows[0]?.record??null;}
 async researchProposalById(accountId:string,id:string){return (await this.db.query<{record:ResearchProposal}>('SELECT record FROM research_proposals WHERE account_id=$1 AND id=$2',[accountId,id])).rows[0]?.record??null;}
 async researchHistory(accountId:string){return (await this.db.query<{record:ResearchProposal}>('SELECT record FROM research_proposals WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[accountId])).rows.map(r=>r.record);}
 async saveResearchProposal(proposal:ResearchProposal,recurring?:{scheduleId:string;firingId:string;leaseToken:string;revision:number}){
  return this.db.transaction(async tx=>{
   const account=await this.lockedAccount(tx,proposal.accountId);
   if(Boolean(proposal.recurring)!==Boolean(recurring)||recurring&&(proposal.inflow||proposal.revalidation))fail('INVALID_RECURRING_PROPOSAL');
   let recurringRow:{id:string;account_id:string;status:string;revision:number;scenario:string;lease_token:string|null;lease_until:string;interval_seconds:number;next_due:string}|undefined;
   let firingRow:{id:string;account_id:string;request_id:string;state:string;due_at:string}|undefined;
   if(recurring){
    recurringRow=(await tx.query<typeof recurringRow & {}>('SELECT * FROM recurring_schedules WHERE id=$1 AND account_id=$2 FOR UPDATE',[recurring.scheduleId,proposal.accountId])).rows[0];
    firingRow=(await tx.query<typeof firingRow & {}>('SELECT * FROM recurring_firings WHERE id=$1 AND schedule_id=$2 AND account_id=$3 FOR UPDATE',[recurring.firingId,recurring.scheduleId,proposal.accountId])).rows[0];
    if(!recurringRow||!firingRow||recurringRow.status!=='active'||recurringRow.revision!==recurring.revision)fail('RECURRING_SCHEDULE_STALE');
    const leaseUntil=new Date(recurringRow.lease_until).getTime();
    if(recurringRow.lease_token!==recurring.leaseToken||!Number.isFinite(leaseUntil)||leaseUntil<=Date.now())fail('RECURRING_LEASE_STALE');
    if(firingRow.state!=='claimed'||firingRow.request_id!==proposal.requestId||proposal.scenario!==recurringRow.scenario)fail('RECURRING_FIRING_STALE');
    if(new Date(recurringRow.next_due).toISOString()!==new Date(firingRow.due_at).toISOString())fail('RECURRING_SLOT_CHANGED');
    if(proposal.recurring?.scheduleId!==recurringRow.id||proposal.recurring.firingId!==firingRow.id||proposal.recurring.dueAt!==new Date(firingRow.due_at).toISOString())fail('RECURRING_SOURCE_LINK_INVALID');
   }
   const existing=(await tx.query<{record:ResearchProposal}>('SELECT record FROM research_proposals WHERE account_id=$1 AND request_id=$2',[proposal.accountId,proposal.requestId])).rows[0]?.record;
   if(existing){if(recurring)fail('RECURRING_REQUEST_CONFLICT');if(existing.mandateRevision!==proposal.mandateRevision||existing.scenario!==proposal.scenario||existing.revalidation?.parentProposalId!==proposal.revalidation?.parentProposalId||existing.inflow?.transactionHash!==proposal.inflow?.transactionHash)fail('PROPOSAL_REQUEST_CONFLICT');return existing;}
   if(proposal.revalidation){const parent=(await tx.query<{record:ResearchProposal}>('SELECT record FROM research_proposals WHERE account_id=$1 AND id=$2',[proposal.accountId,proposal.revalidation.parentProposalId])).rows[0]?.record;if(!parent||parent.id===proposal.id)fail('PROPOSAL_NOT_FOUND');if(parent.inflow&&(!proposal.inflow||proposal.inflow.transactionHash!==parent.inflow.transactionHash||proposal.inflow.budgetCapAtomic!==parent.inflow.budgetCapAtomic))fail('INVALID_INFLOW_REVISION');if(!same(proposal.revalidation,compareResearchProposals(parent,proposal)))fail('INVALID_PROPOSAL_COMPARISON');}
   await this.verifyResearchInputs(tx,proposal);
   if(proposal.researchOnly!==true||proposal.result.executable!==false||proposal.inputs.funding.accountId!==proposal.accountId||proposal.inputs.checkpoint.accountId!==proposal.accountId||!same(proposal.result.capitalBasis,proposal.inputs.funding))fail('INVALID_RESEARCH_PROPOSAL');
   if(proposal.inflow){const event=(await tx.query<{record:InflowRecord}>('SELECT record FROM inflow_reviews WHERE account_id=$1 AND transaction_hash=$2 ORDER BY revision DESC LIMIT 1',[proposal.accountId,proposal.inflow.transactionHash])).rows[0]?.record;
    const knownSettlement=!!(await tx.query('SELECT id FROM receipts WHERE account_id=$1 AND lower(transaction_hash)=$2',[proposal.accountId,proposal.inflow.transactionHash])).rows.length;
    if(!event||event.id!==proposal.inflow.eventId||event.revision!==proposal.inflow.reviewRevision||!same(proposal.inputs.inflowProof,event.proof)||!classifyInflow(event.proof,event.review,Date.now(),knownSettlement).eligibleForProposal||!same(event.classification,classifyInflow(event.proof,event.review,Date.now(),knownSettlement))||BigInt(proposal.inputs.checkpoint.blockNumber)<BigInt(event.proof.blockNumber)||proposal.inputs.allocationBudgetCapAtomic!==proposal.inflow.budgetCapAtomic||BigInt(proposal.inflow.budgetCapAtomic)>BigInt(event.classification.netAtomic))fail('INELIGIBLE_INFLOW');
    if(!same(proposal.result,previewInvestment(proposal.inputs.mandate,proposal.inputs.candidates,proposal.inputs.quotes,new Date(proposal.result.createdAt),proposal.inputs.funding,proposal.inputs.portfolio,proposal.inflow.budgetCapAtomic)))fail('INVALID_RESEARCH_PROPOSAL');
    const link=(await tx.query<{proposal_id:string}>('SELECT proposal_id FROM inflow_proposal_links WHERE account_id=$1 AND transaction_hash=$2',[proposal.accountId,proposal.inflow.transactionHash])).rows[0];
    if(proposal.revalidation){const parent=(await tx.query<{record:ResearchProposal}>('SELECT record FROM research_proposals WHERE account_id=$1 AND id=$2',[proposal.accountId,proposal.revalidation.parentProposalId])).rows[0]?.record;if(!link||!parent?.inflow||parent.inflow.transactionHash!==proposal.inflow.transactionHash||parent.inflow.budgetCapAtomic!==proposal.inflow.budgetCapAtomic)fail('INVALID_INFLOW_REVISION');}
    else if(link)fail('INFLOW_ALREADY_PROPOSED');
   }else if(proposal.inputs.allocationBudgetCapAtomic!==undefined)fail('INVALID_RESEARCH_PROPOSAL');
   await tx.query('INSERT INTO research_proposals(id,account_id,request_id,mandate_revision,record) VALUES($1,$2,$3,$4,$5)',[proposal.id,proposal.accountId,proposal.requestId,proposal.mandateRevision,JSON.stringify(proposal)]);
   if(recurring&&recurringRow&&firingRow){
    const nextDue=new Date(Math.max(new Date(recurringRow.next_due).getTime()+recurringRow.interval_seconds*1000,Date.now()+recurringRow.interval_seconds*1000)).toISOString();
    await tx.query("UPDATE recurring_firings SET state='proposed',proposal_id=$2,reason=NULL,updated_at=clock_timestamp() WHERE id=$1",[firingRow.id,proposal.id]);
    await tx.query('UPDATE recurring_schedules SET next_due=$2,revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1',[recurringRow.id,nextDue]);
   }
   if(proposal.inflow&&!proposal.revalidation)await tx.query('INSERT INTO inflow_proposal_links(account_id,transaction_hash,proposal_id,event_id) VALUES($1,$2,$3,$4)',[proposal.accountId,proposal.inflow.transactionHash,proposal.id,proposal.inflow.eventId]);
   await this.event(tx,proposal.accountId,'research.proposal.saved',{proposalId:proposal.id,mandateRevision:proposal.mandateRevision,decisionId:proposal.result.decisionId});return proposal;
  });
 }
 private async verifyResearchInputs(tx:Queryable,proposal:Pick<ResearchProposal,'accountId'|'mandateId'|'mandateRevision'|'inputs'>){
   const account=await this.lockedAccount(tx,proposal.accountId);
   await this.requireCapitalFresh(tx,account.record);
   const latest=(await tx.query<{record:SavedInvestmentMandate}>('SELECT record FROM investment_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[proposal.accountId])).rows[0]?.record;
   const head=(await tx.query<{checkpoint_id:string}>('SELECT checkpoint_id FROM capital_heads WHERE account_id=$1',[proposal.accountId])).rows[0];
   const policy=investmentPolicySchema.parse({...Object.fromEntries(['allocations','maxIssuerBps','maxCostBps','allowLeveraged','representationAllowlist'].map(k=>[k,(proposal.inputs.mandate as any)[k]])),exposureScope:'tracked-holdings-pending-proposed'});
   if(!latest||latest.id!==proposal.mandateId||latest.revision!==proposal.mandateRevision||!same(latest.policy,policy))fail('STALE_MANDATE');
   if(account.revision!==proposal.inputs.funding.accountRevision||head?.checkpoint_id!==proposal.inputs.funding.checkpointId)fail('STALE_PROPOSAL_INPUTS');
   const pending=(await tx.query<PendingExposure>(`SELECT r.id AS "reservationId",r.plan_id AS "planId",r.amount::text AS "amountAtomic",p.record->'exposureModel' AS model,EXISTS(SELECT 1 FROM submission_barriers b WHERE b.reservation_id=r.id) AS "submissionStarted" FROM reservations r JOIN plans p ON p.id=r.plan_id WHERE r.account_id=$1 AND r.state='held' ORDER BY r.id`,[proposal.accountId])).rows;
   if(!same(pending,proposal.inputs.pending))fail('STALE_PROPOSAL_INPUTS');
 }
 async researchRebalance(accountId:string,requestId:string){return (await this.db.query<{record:ResearchRebalance}>('SELECT record FROM research_rebalances WHERE account_id=$1 AND request_id=$2',[accountId,requestId])).rows[0]?.record??null;}
 async rebalanceHistory(accountId:string){return (await this.db.query<{record:ResearchRebalance}>('SELECT record FROM research_rebalances WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[accountId])).rows.map(r=>r.record);}
 async saveResearchRebalance(record:ResearchRebalance){return this.db.transaction(async tx=>{
  await this.lockedAccount(tx,record.accountId);
  const existing=(await tx.query<{record:ResearchRebalance}>('SELECT record FROM research_rebalances WHERE account_id=$1 AND request_id=$2',[record.accountId,record.requestId])).rows[0]?.record;
  if(existing){if(existing.mandateRevision!==record.mandateRevision||existing.scenario!==record.scenario||existing.useAvailableCash!==record.useAvailableCash)fail('REBALANCE_REQUEST_CONFLICT');return existing;}
  await this.verifyResearchInputs(tx,record);
  if(record.researchOnly!==true||record.result.executable!==false||record.inputs.funding.accountId!==record.accountId||record.inputs.checkpoint.accountId!==record.accountId||!same(record.result,previewRebalance(record.inputs,record.useAvailableCash,new Date(record.result.createdAt))))fail('INVALID_RESEARCH_REBALANCE');
  await tx.query('INSERT INTO research_rebalances(id,account_id,request_id,mandate_revision,record) VALUES($1,$2,$3,$4,$5)',[record.id,record.accountId,record.requestId,record.mandateRevision,JSON.stringify(record)]);
  await this.event(tx,record.accountId,'research.rebalance.saved',{rebalanceId:record.id,mandateRevision:record.mandateRevision,decisionId:record.result.decisionId});return record;
 });}
 async researchCashRaising(accountId:string,requestId:string){return (await this.db.query<{record:ResearchCashRaising}>('SELECT record FROM research_cash_raising WHERE account_id=$1 AND request_id=$2',[accountId,requestId])).rows[0]?.record??null;}
 async cashRaisingHistory(accountId:string){return (await this.db.query<{record:ResearchCashRaising}>('SELECT record FROM research_cash_raising WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[accountId])).rows.map(r=>r.record);}
 async saveResearchCashRaising(record:ResearchCashRaising){return this.db.transaction(async tx=>{
  await this.lockedAccount(tx,record.accountId);
  const existing=(await tx.query<{record:ResearchCashRaising}>('SELECT record FROM research_cash_raising WHERE account_id=$1 AND request_id=$2',[record.accountId,record.requestId])).rows[0]?.record;
  if(existing){if(existing.mandateRevision!==record.mandateRevision||existing.scenario!==record.scenario||existing.target!==record.target)fail('CASH_RAISING_REQUEST_CONFLICT');return existing;}
  await this.verifyResearchInputs(tx,record);
  if(record.researchOnly!==true||record.result.executable!==false||record.inputs.funding.accountId!==record.accountId||record.inputs.checkpoint.accountId!==record.accountId||!same(record.result,previewCashRaising(record.inputs,record.target,new Date(record.result.createdAt))))fail('INVALID_RESEARCH_CASH_RAISING');
  await tx.query('INSERT INTO research_cash_raising(id,account_id,request_id,mandate_revision,record) VALUES($1,$2,$3,$4,$5)',[record.id,record.accountId,record.requestId,record.mandateRevision,JSON.stringify(record)]);
  await this.event(tx,record.accountId,'research.cash_raising.saved',{cashRaisingId:record.id,mandateRevision:record.mandateRevision,decisionId:record.result.decisionId});return record;
 });}
 async inflowRecord(accountId:string,transactionHash:string){return (await this.db.query<{record:InflowRecord}>('SELECT record FROM inflow_reviews WHERE account_id=$1 AND transaction_hash=$2 ORDER BY revision DESC LIMIT 1',[accountId,transactionHash])).rows[0]?.record??null;}
 async inflowHistory(accountId:string){return (await this.db.query<{record:InflowRecord;proposalId:string|null}>(`SELECT v.record,l.proposal_id AS "proposalId" FROM (SELECT DISTINCT ON(transaction_hash) transaction_hash,record,created_at,id FROM inflow_reviews WHERE account_id=$1 ORDER BY transaction_hash,revision DESC) v LEFT JOIN inflow_proposal_links l ON l.account_id=$1 AND l.transaction_hash=v.transaction_hash ORDER BY v.created_at DESC,v.id DESC LIMIT 20`,[accountId])).rows;}
 async inflowLinkedProposal(accountId:string,transactionHash:string){return (await this.db.query<{record:ResearchProposal}>('SELECT p.record FROM inflow_proposal_links l JOIN research_proposals p ON p.id=l.proposal_id WHERE l.account_id=$1 AND l.transaction_hash=$2',[accountId,transactionHash])).rows[0]?.record??null;}
 async saveInflowReview(accountId:string,proof:InflowProof,review:InflowReview,expectedRevision:number){return this.db.transaction(async tx=>{
  const account=await this.lockedAccount(tx,accountId);if(account.record.wallet.toLowerCase()!==proof.wallet)fail('INFLOW_ACCOUNT_MISMATCH');
  const knownSettlement=!!(await tx.query('SELECT id FROM receipts WHERE account_id=$1 AND lower(transaction_hash)=$2',[accountId,proof.transactionHash])).rows.length,classification=classifyInflow(proof,review,Date.now(),knownSettlement),previous=(await tx.query<{record:InflowRecord}>('SELECT record FROM inflow_reviews WHERE account_id=$1 AND transaction_hash=$2 ORDER BY revision DESC LIMIT 1',[accountId,proof.transactionHash])).rows[0]?.record;
  if(!Number.isInteger(expectedRevision)||expectedRevision<0||(previous?.revision??0)!==expectedRevision)fail('STALE_INFLOW_REVIEW');
  const facts=(p:InflowProof)=>{const {headNumber,headHash,observedAt,...f}=p;return f;};if(previous&&!same(facts(previous.proof),facts(proof)))fail('INFLOW_PROOF_CONFLICT');
  if(previous&&previous.review===review&&previous.knownSettlement===knownSettlement&&same(previous.proof,proof))return previous;
  const record:InflowRecord={id:randomUUID(),accountId,revision:expectedRevision+1,createdAt:iso(),review,knownSettlement,proof,classification,researchOnly:true};
  await tx.query('INSERT INTO inflow_reviews(id,account_id,transaction_hash,revision,record) VALUES($1,$2,$3,$4,$5)',[record.id,accountId,proof.transactionHash,record.revision,JSON.stringify(record)]);
  await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[accountId]);await this.event(tx,accountId,'inflow.reviewed',{eventId:record.id,transactionHash:proof.transactionHash,classification:classification.kind,netAtomic:classification.netAtomic});return record;
 });}
 private async event(tx:Queryable,accountId:string,kind:string,payload:Record<string,unknown>){
  const id=randomUUID();const envelope={schemaVersion:'1.0.0',id,accountId,kind,payload,createdAt:iso()};
  await tx.query('INSERT INTO journal(id,account_id,kind,payload) VALUES($1,$2,$3,$4)',[id,accountId,kind,JSON.stringify(envelope)]);
  await tx.query('INSERT INTO outbox(id,payload) VALUES($1,$2)',[id,JSON.stringify(envelope)]);
 }
 private async lockedAccount(tx:Queryable,id:string){
  const row=(await tx.query<{record:AccountRecord;balance:string;protected:string;revision:number}>('SELECT record,balance::text,protected::text,revision FROM accounts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)fail('ACCOUNT_NOT_FOUND');return row;
 }
 private async held(tx:Queryable,id:string){return BigInt((await tx.query<{held:string}>("SELECT COALESCE(SUM(amount),0)::text AS held FROM reservations WHERE account_id=$1 AND state='held'",[id])).rows[0].held);}
 private async requireCapitalFresh(tx:Queryable,account:AccountRecord){if(account.evidenceMode!=='observed')return;const head=(await tx.query<{state:string;record:CapitalCheckpoint}>('SELECT health.state,c.record FROM capital_heads h JOIN capital_checkpoints c ON c.id=h.checkpoint_id LEFT JOIN capital_health health ON health.account_id=h.account_id WHERE h.account_id=$1',[account.id])).rows[0];if(!head||head.state!=='OBSERVED')fail('CAPITAL_UNKNOWN');const age=Date.now()-Date.parse(head.record.observedAt);if(!Number.isFinite(age)||age<0||age>60000)fail('CAPITAL_STALE');}
 async createAccount(value:AccountRecord){
  const account=accountRecordSchema.parse(value);
  if(account.revision!==0||BigInt(account.protectedAtomic)>BigInt(account.balanceAtomic))fail('INVALID_ACCOUNT');
  await this.db.transaction(async tx=>{
   await tx.query('INSERT INTO accounts(id,record,balance,protected) VALUES($1,$2,$3,$4)',[account.id,JSON.stringify(account),account.balanceAtomic,account.protectedAtomic]);
   await this.event(tx,account.id,'account.created',{account});
  });return account;
 }
 async snapshot(accountId:string){
  // A single SQL snapshot prevents mixed balance/reservation revisions during concurrent commits.
  const row=(await this.db.query<{record:AccountRecord;balance:string;protected:string;revision:number;held:string}>(`SELECT a.record,a.balance::text,a.protected::text,a.revision,
   COALESCE((SELECT SUM(r.amount) FROM reservations r WHERE r.account_id=a.id AND r.state='held'),0)::text AS held FROM accounts a WHERE a.id=$1`,[accountId])).rows[0];
  if(!row)fail('ACCOUNT_NOT_FOUND');
  const available=BigInt(row.balance)-BigInt(row.protected)-BigInt(row.held);
  return {...row.record,balanceAtomic:row.balance,protectedAtomic:row.protected,revision:row.revision,heldAtomic:row.held,availableAtomic:(available>0n?available:0n).toString(),shortfallAtomic:(available<0n?-available:0n).toString()};
 }
 async applyCapitalCheckpoint(value:CapitalCheckpoint){
  const checkpoint=capitalCheckpointSchema.parse(value),id=createHash('sha256').update(checkpoint.accountId+':'+checkpoint.blockHash).digest('hex');
  for(const p of checkpoint.positions){if(p.accountingVersion==='unknown'){if(p.state!=='UNKNOWN'||p.adjustedAtomic!==null||p.multiplierAtomic!==null)fail('INVALID_POSITION_ACCOUNTING');}else if(p.accountingVersion==='raw-token-v1'){if(p.rawAtomic===null||p.multiplierAtomic!==null||p.adjustedAtomic!==null||p.state!=='OBSERVED')fail('INVALID_POSITION_ACCOUNTING');}else if(p.rawAtomic===null||p.multiplierAtomic===null||p.adjustedAtomic===null||BigInt(p.multiplierAtomic)<=0n||BigInt(p.adjustedAtomic)!==BigInt(p.rawAtomic)*BigInt(p.multiplierAtomic)/10n**18n)fail('INVALID_POSITION_ACCOUNTING');}
  if(new Set(checkpoint.positions.map(p=>p.contract)).size!==checkpoint.positions.length)fail('DUPLICATE_POSITION');
  await this.db.transaction(async tx=>{
   const initial:AccountRecord={schemaVersion:'1.0.0',id:checkpoint.accountId,createdAt:checkpoint.observedAt,wallet:checkpoint.wallet,asset:checkpoint.asset,balanceAtomic:checkpoint.balanceAtomic,protectedAtomic:'0',revision:0,observedAt:checkpoint.observedAt,evidenceMode:'observed'};
   const created=await tx.query('INSERT INTO accounts(id,record,balance,protected) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING RETURNING id',[initial.id,JSON.stringify(initial),initial.balanceAtomic]);
   const account=await this.lockedAccount(tx,checkpoint.accountId);
   if(account.record.wallet.toLowerCase()!==checkpoint.wallet||!same(account.record.asset,checkpoint.asset)||account.record.evidenceMode!=='observed')fail('CHECKPOINT_ACCOUNT_MISMATCH');
   const previous=(await tx.query<{id:string;record:CapitalCheckpoint}>('SELECT c.id,c.record FROM capital_heads h JOIN capital_checkpoints c ON c.id=h.checkpoint_id WHERE h.account_id=$1',[checkpoint.accountId])).rows[0];
   const existing=(await tx.query<{record:CapitalCheckpoint}>('SELECT record FROM capital_checkpoints WHERE id=$1',[id])).rows[0];
   if(existing){const {observedAt:a,...before}=existing.record,{observedAt:b,...after}=checkpoint;if(!same(before,after))fail('CHECKPOINT_CONFLICT');if(previous?.id===id)await tx.query("UPDATE capital_health SET state='OBSERVED' WHERE account_id=$1",[checkpoint.accountId]);return;}
   if(previous&&BigInt(previous.record.blockNumber)>=BigInt(checkpoint.blockNumber))fail('CHECKPOINT_NON_FORWARD');
   if(created.rows.length)await this.event(tx,checkpoint.accountId,'account.created',{account:initial});
   await tx.query('INSERT INTO capital_checkpoints(id,account_id,block_number,block_hash,record) VALUES($1,$2,$3,$4,$5)',[id,checkpoint.accountId,checkpoint.blockNumber,checkpoint.blockHash,JSON.stringify(checkpoint)]);
   await tx.query('INSERT INTO capital_heads(account_id,checkpoint_id) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET checkpoint_id=EXCLUDED.checkpoint_id',[checkpoint.accountId,id]);
   await tx.query("INSERT INTO capital_health(account_id,state) VALUES($1,'OBSERVED') ON CONFLICT(account_id) DO UPDATE SET state='OBSERVED'",[checkpoint.accountId]);
   const updated={...account.record,balanceAtomic:checkpoint.balanceAtomic,observedAt:checkpoint.observedAt};
   await tx.query('UPDATE accounts SET record=$2,balance=$3,revision=revision+1 WHERE id=$1',[checkpoint.accountId,JSON.stringify(updated),checkpoint.balanceAtomic]);
   await this.event(tx,checkpoint.accountId,'capital.checkpointed',{checkpointId:id,blockNumber:checkpoint.blockNumber,previousRevision:account.revision});
  });return id;
 }
 async capitalState(accountId:string){
  // One statement reads the head, policy and reservations from the same database snapshot.
  const row=(await this.db.query<{record:AccountRecord;balance:string;protected:string;revision:number;held:string;checkpoint_id:string;checkpoint:CapitalCheckpoint;health:string;policy:CapitalPolicy|null;policy_revision:number|null;pending:PendingExposure[]}>(`SELECT a.record,a.balance::text,a.protected::text,a.revision,h.checkpoint_id,c.record AS checkpoint,health.state AS health,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('reservationId',r.id,'planId',r.plan_id,'amountAtomic',r.amount::text,'model',p.record->'exposureModel','submissionStarted',EXISTS(SELECT 1 FROM submission_barriers b WHERE b.reservation_id=r.id)) ORDER BY r.id) FROM reservations r JOIN plans p ON p.id=r.plan_id WHERE r.account_id=a.id AND r.state='held'),'[]'::jsonb) AS pending,
   COALESCE((SELECT SUM(r.amount) FROM reservations r WHERE r.account_id=a.id AND r.state='held'),0)::text AS held,
   (SELECT p.record FROM capital_policies p WHERE p.account_id=a.id ORDER BY p.revision DESC LIMIT 1) AS policy,
   (SELECT p.revision FROM capital_policies p WHERE p.account_id=a.id ORDER BY p.revision DESC LIMIT 1) AS policy_revision
   FROM accounts a JOIN capital_heads h ON h.account_id=a.id JOIN capital_checkpoints c ON c.id=h.checkpoint_id LEFT JOIN capital_health health ON health.account_id=a.id WHERE a.id=$1`,[accountId])).rows[0];
  if(!row)return null;const available=BigInt(row.balance)-BigInt(row.protected)-BigInt(row.held);
  return {accountId,revision:row.revision,decimals:row.record.asset.decimals,balanceAtomic:row.balance,protectedAtomic:row.protected,heldAtomic:row.held,availableAtomic:(available>0n?available:0n).toString(),shortfallAtomic:(available<0n?-available:0n).toString(),checkpointId:row.checkpoint_id,checkpoint:row.checkpoint,health:row.health,pending:row.pending,policy:row.policy??{reserveFloor:'0',operatingBudget:'0',obligations:[]},policyRevision:row.policy_revision??0};
 }
 async invalidateCapital(accountId:string){await this.db.query("INSERT INTO capital_health(account_id,state) SELECT id,'UNKNOWN' FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO UPDATE SET state='UNKNOWN'",[accountId]);}
 async saveCapitalPolicy(accountId:string,value:CapitalPolicy,expectedRevision:number){
  const policy=capitalPolicySchema.parse(value);if(!Number.isInteger(expectedRevision)||expectedRevision<0)fail('INVALID_REVISION');
  return this.db.transaction(async tx=>{
   const account=await this.lockedAccount(tx,accountId);if(account.revision!==expectedRevision)fail('STALE_ACCOUNT');
   const previous=(await tx.query<{record:CapitalPolicy;revision:number}>('SELECT record,revision FROM capital_policies WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[accountId])).rows[0];
   if(previous&&same(previous.record,policy))return previous.revision;
   const revision=(previous?.revision??0)+1,protection=capitalProtection(policy,account.record.asset.decimals);
   await tx.query('INSERT INTO capital_policies(account_id,revision,record) VALUES($1,$2,$3)',[accountId,revision,JSON.stringify(policy)]);
   await tx.query('UPDATE accounts SET protected=$2,revision=revision+1 WHERE id=$1',[accountId,protection.protectedAtomic]);
   await this.event(tx,accountId,'capital.policy.changed',{policyRevision:revision,protection,previousRevision:expectedRevision});return revision;
  });
 }
 async capitalHistory(accountId:string){return (await this.db.query<{id:string;record:CapitalCheckpoint}>('SELECT id,record FROM capital_checkpoints WHERE account_id=$1 ORDER BY block_number DESC LIMIT 20',[accountId])).rows;}
 async capitalPolicyHistory(accountId:string){return (await this.db.query<{revision:number;record:CapitalPolicy;created_at:string}>('SELECT revision,record,created_at::text FROM capital_policies WHERE account_id=$1 ORDER BY revision DESC LIMIT 20',[accountId])).rows;}
 async savePlan(value:PlanRevisionRecord){
  const plan=planRevisionRecordSchema.parse(value);
  if(plan.exposureModel&&(plan.maximumDebit.asset.decimals!==18||plan.exposureModel.legs.reduce((n,l)=>n+BigInt(l.valueAtomic),0n)>BigInt(plan.maximumDebit.atomic)))fail('INVALID_EXPOSURE_MODEL');
  return this.db.transaction(async tx=>{
   const account=await this.lockedAccount(tx,plan.accountId);
   await this.requireCapitalFresh(tx,account.record);
   const previous=(await tx.query<{record:PlanRevisionRecord}>('SELECT record FROM plans WHERE id=$1',[plan.id])).rows[0];
   if(previous){if(!same(previous.record,plan))fail('PLAN_CONFLICT');return previous.record;}
   if(account.revision!==plan.accountRevision)fail('STALE_PLAN');
   if(!same(account.record.asset,plan.maximumDebit.asset))fail('ASSET_MISMATCH');
   if((account.record.evidenceMode==='synthetic')!==(plan.evidenceMode==='synthetic'))fail('EVIDENCE_MODE_MISMATCH');
   if(Date.parse(plan.expiresAt)<=Date.now())fail('PLAN_EXPIRED');
   await tx.query('INSERT INTO plans(id,account_id,record) VALUES($1,$2,$3)',[plan.id,plan.accountId,JSON.stringify(plan)]);
   await tx.query("INSERT INTO plan_controls(plan_id,account_id,status,revision) VALUES($1,$2,'active',1)",[plan.id,plan.accountId]);
   await this.event(tx,plan.accountId,'plan.saved',{plan});return plan;
  });
 }
 async getPlanControl(accountId:string,planId:string):Promise<PlanControl|null>{
  const row=(await this.db.query<{plan_id:string;account_id:string;status:PlanControl['status'];revision:number;created_at:string;updated_at:string}>('SELECT * FROM plan_controls WHERE plan_id=$1 AND account_id=$2',[planId,accountId])).rows[0];
  return row?planControl(row):null;
 }
 async changePlanControl(accountId:string,planId:string,expectedRevision:number,action:'pause'|'resume'|'cancel'):Promise<PlanControl>{
  if(!Number.isInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');
  return this.db.transaction(async tx=>{
   const account=await this.lockedAccount(tx,accountId);
   const row=(await tx.query<{plan_id:string;account_id:string;status:PlanControl['status'];revision:number;created_at:string;updated_at:string}>('SELECT * FROM plan_controls WHERE plan_id=$1 AND account_id=$2 FOR UPDATE',[planId,accountId])).rows[0];
   if(!row)fail('PLAN_NOT_FOUND');
   if(row.revision!==expectedRevision)fail('STALE_PLAN_CONTROL');
   if(action==='pause'&&row.status!=='active'||action==='resume'&&row.status!=='paused'||action==='cancel'&&!['active','paused'].includes(row.status))fail('PLAN_CONTROL_TRANSITION_INVALID');
   let status:PlanControl['status'];
   if(action==='resume'){
    const reserved=(await tx.query('SELECT id FROM reservations WHERE plan_id=$1',[planId])).rows.length;
    const plan=(await tx.query<{record:PlanRevisionRecord}>('SELECT record FROM plans WHERE id=$1',[planId])).rows[0]?.record;
    if(!plan||reserved||plan.accountRevision!==account.revision)fail('REPLAN_REQUIRED');
    await this.requireCapitalFresh(tx,account.record);
    if(Date.parse(plan.expiresAt)<=Date.now())fail('PLAN_EXPIRED');
    status='active';
   }else if(action==='cancel'){
    const submitted=(await tx.query('SELECT 1 FROM submission_barriers b JOIN reservations r ON r.id=b.reservation_id WHERE r.plan_id=$1',[planId])).rows.length>0;
    status=submitted?'cancellation_requested':'revoked';
    if(!submitted){
     const reservation=(await tx.query<{record:ReservationRecord}>('SELECT record FROM reservations WHERE plan_id=$1 FOR UPDATE',[planId])).rows[0]?.record;
     if(reservation?.state==='held'){
      const released={...reservation,state:'released' as const};
      await tx.query("UPDATE reservations SET state='released',record=$2 WHERE id=$1",[reservation.id,JSON.stringify(released)]);
      await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[accountId]);
      await this.event(tx,accountId,'reservation.released',{reservation:released,reason:'plan_cancelled_before_submission'});
     }
    }
   }else status='paused';
   const updated=(await tx.query<typeof row>("UPDATE plan_controls SET status=$2,revision=revision+1,updated_at=clock_timestamp() WHERE plan_id=$1 RETURNING *",[planId,status])).rows[0];
   await this.event(tx,accountId,'plan.control.changed',{planId,action,status,revision:updated.revision});
   return planControl(updated);
  });
 }
 async setProtected(accountId:string,amountAtomic:string,expectedRevision:number){
  atomicSchema.parse(amountAtomic);
  await this.db.transaction(async tx=>{
   const account=await this.lockedAccount(tx,accountId);
   if(account.revision!==expectedRevision)fail('STALE_ACCOUNT');
   if(BigInt(amountAtomic)+await this.held(tx,accountId)>BigInt(account.balance))fail('INSUFFICIENT_AVAILABLE');
   await tx.query('UPDATE accounts SET protected=$2,revision=revision+1 WHERE id=$1',[accountId,amountAtomic]);
   await this.event(tx,accountId,'protection.changed',{amountAtomic,previousRevision:expectedRevision});
  });
 }
 async reserve(input:{accountId:string;planRevisionId:string;idempotencyKey:string;amountAtomic:string}){
  positive(input.amountAtomic);
  if(!input.idempotencyKey||input.idempotencyKey.length>120)fail('INVALID_IDEMPOTENCY_KEY');
  return this.db.transaction(async tx=>{
   const account=await this.lockedAccount(tx,input.accountId);
   const existing=(await tx.query<{record:ReservationRecord}>('SELECT record FROM reservations WHERE account_id=$1 AND idempotency_key=$2',[input.accountId,input.idempotencyKey])).rows[0];
   if(existing){if(existing.record.planRevisionId!==input.planRevisionId||existing.record.amountAtomic!==input.amountAtomic)fail('IDEMPOTENCY_CONFLICT');return existing.record;}
   await this.requireCapitalFresh(tx,account.record);
   const plan=(await tx.query<{record:PlanRevisionRecord}>('SELECT record FROM plans WHERE id=$1 AND account_id=$2',[input.planRevisionId,input.accountId])).rows[0]?.record;
   if(!plan)fail('PLAN_NOT_FOUND');
   const control=(await tx.query<{status:PlanControl['status']}>('SELECT status FROM plan_controls WHERE plan_id=$1',[plan.id])).rows[0];
   if(!control||control.status!=='active')fail('PLAN_DISPATCH_BLOCKED');
   if(Date.parse(plan.expiresAt)<=Date.now())fail('PLAN_EXPIRED');
   if(plan.accountRevision!==account.revision)fail('STALE_PLAN');
   if(BigInt(input.amountAtomic)>BigInt(plan.maximumDebit.atomic))fail('PLAN_BUDGET_EXCEEDED');
   if(plan.exposureModel&&input.amountAtomic!==plan.maximumDebit.atomic)fail('EXPOSURE_RESERVATION_MUST_COVER_PLAN');
   if(BigInt(input.amountAtomic)+BigInt(account.protected)+await this.held(tx,input.accountId)>BigInt(account.balance))fail('INSUFFICIENT_AVAILABLE');
   const reservation:ReservationRecord={schemaVersion:'1.0.0',id:randomUUID(),createdAt:iso(),...input,state:'held'};
   await tx.query('INSERT INTO reservations(id,account_id,plan_id,idempotency_key,amount,state,record) VALUES($1,$2,$3,$4,$5,$6,$7)',[reservation.id,input.accountId,input.planRevisionId,input.idempotencyKey,input.amountAtomic,'held',JSON.stringify(reservation)]);
   await tx.query('UPDATE accounts SET revision=revision+1 WHERE id=$1',[input.accountId]);
   await this.event(tx,input.accountId,'reservation.held',{reservation});return reservation;
  });
 }
 // Commit this fence BEFORE any external submission. Retrying the request returns
 // false, requiring reconciliation rather than another economic action.
 async beginSubmission(reservationId:string,requestId:string){
  if(!requestId||requestId.length>120)fail('INVALID_REQUEST_ID');
  return this.db.transaction(async tx=>{
   const pointer=(await tx.query<{account_id:string}>('SELECT account_id FROM reservations WHERE id=$1',[reservationId])).rows[0];
   if(!pointer)fail('RESERVATION_NOT_FOUND');
   await this.lockedAccount(tx,pointer.account_id);
   const previous=(await tx.query<{request_id:string}>('SELECT request_id FROM submission_barriers WHERE reservation_id=$1',[reservationId])).rows[0];
   if(previous){if(previous.request_id!==requestId)fail('SUBMISSION_ALREADY_STARTED');return false;}
   const row=(await tx.query<{state:string;plan_id:string}>('SELECT state,plan_id FROM reservations WHERE id=$1',[reservationId])).rows[0];
   if(row.state!=='held')fail('RESERVATION_FINAL');
   const control=(await tx.query<{status:PlanControl['status']}>('SELECT status FROM plan_controls WHERE plan_id=$1',[row.plan_id])).rows[0];
   if(!control||control.status!=='active')fail('PLAN_DISPATCH_BLOCKED');
   await tx.query('INSERT INTO submission_barriers(reservation_id,request_id) VALUES($1,$2)',[reservationId,requestId]);
   await this.event(tx,pointer.account_id,'submission.started',{reservationId,requestId});return true;
  });
 }
 // No timeout or outbox expiry automatically releases money. Once submission
 // may have started, only verified reconciliation can resolve the hold.
 async releaseUnsubmitted(reservationId:string){return this.finish(reservationId,null);}
 // Internal only: authentication and chain receipt verification precede this boundary in a future executor.
 async reconcile(value:ReceiptRecord){const receipt=receiptRecordSchema.parse(value);return this.finish(receipt.reservationId,receipt);}
 private async finish(id:string,receipt:ReceiptRecord|null){
  return this.db.transaction(async tx=>{
   const pointer=(await tx.query<{account_id:string}>('SELECT account_id FROM reservations WHERE id=$1',[id])).rows[0];
   if(!pointer)fail('RESERVATION_NOT_FOUND');
   const account=await this.lockedAccount(tx,pointer.account_id);
   const row=(await tx.query<{record:ReservationRecord}>('SELECT record FROM reservations WHERE id=$1 FOR UPDATE',[id])).rows[0].record;
   if((await tx.query("SELECT id FROM direct_attempts WHERE record->'planBinding'->>'reservationId'=$1 LIMIT 1",[id])).rows.length)fail('PLAN_BOUND_ATTEMPT_REQUIRES_LEDGER');
   const target=receipt?'consumed':'released';
   if(row.state===target){
    if(receipt){const previous=(await tx.query<{record:ReceiptRecord}>('SELECT record FROM receipts WHERE reservation_id=$1',[id])).rows[0]?.record;if(!same(previous,receipt))fail('RECEIPT_CONFLICT');}
    return row;
   }
   if(row.state!=='held')fail('RESERVATION_FINAL');
   if(!receipt&&(await tx.query('SELECT reservation_id FROM submission_barriers WHERE reservation_id=$1',[id])).rows.length)fail('SUBMISSION_REQUIRES_RECONCILIATION');
   if(receipt){
    if(receipt.evidenceMode!==account.record.evidenceMode)fail('EVIDENCE_MODE_MISMATCH');
    if(BigInt(receipt.debitedAtomic)>BigInt(row.amountAtomic))fail('RESERVATION_EXCEEDED');
    if(!(await tx.query('SELECT reservation_id FROM submission_barriers WHERE reservation_id=$1',[id])).rows.length)fail('SUBMISSION_NOT_STARTED');
    if((await tx.query('SELECT id FROM receipts WHERE account_id=$1 AND transaction_hash=$2',[row.accountId,receipt.transactionHash.toLowerCase()])).rows.length)fail('RECEIPT_ALREADY_APPLIED');
    await tx.query('INSERT INTO receipts(id,reservation_id,account_id,transaction_hash,record) VALUES($1,$2,$3,$4,$5)',[receipt.id,id,row.accountId,receipt.transactionHash.toLowerCase(),JSON.stringify(receipt)]);
   }
   const updated={...row,state:target};
   await tx.query('UPDATE reservations SET state=$2,record=$3 WHERE id=$1',[id,target,JSON.stringify(updated)]);
   if(receipt){const closed=(await tx.query<{revision:number}>("UPDATE plan_controls SET status='revoked',revision=revision+1,updated_at=clock_timestamp() WHERE plan_id=$1 AND status='cancellation_requested' RETURNING revision",[row.planRevisionId])).rows[0];if(closed)await this.event(tx,row.accountId,'plan.control.resolved',{planId:row.planRevisionId,status:'revoked',revision:closed.revision});}
   await tx.query('UPDATE accounts SET balance=balance-$2::numeric,revision=revision+1 WHERE id=$1',[row.accountId,receipt?.debitedAtomic??'0']);
   await this.event(tx,row.accountId,`reservation.${target}`,{reservation:updated,receipt});return updated;
  });
 }
 async claimEvent(leaseSeconds=30){
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<1||leaseSeconds>300)fail('INVALID_LEASE');
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{id:string;payload:Record<string,unknown>}>(`SELECT id,payload FROM outbox WHERE NOT done AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
   if(!row)return null;const token=randomUUID();
   await tx.query("UPDATE outbox SET lease_token=$2,lease_until=clock_timestamp()+($3 * interval '1 second'),attempts=attempts+1 WHERE id=$1",[row.id,token,leaseSeconds]);
   return {...row,token};
  });
 }
 async acknowledgeEvent(id:string,token:string){
  const result=await this.db.query("UPDATE outbox SET done=true,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND NOT done AND lease_until>clock_timestamp() RETURNING id",[id,token]);
  if(!result.rows.length)fail('LEASE_LOST');
 }
 async pendingEvents(){return (await this.db.query<{count:string}>('SELECT COUNT(*)::text AS count FROM outbox WHERE NOT done')).rows[0].count;}
}
