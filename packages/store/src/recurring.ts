import {randomUUID} from 'node:crypto';
import {recurringScheduleInputSchema,type RecurringScheduleInput,type RecurringSchedule,type RecurringFiring,type RecurringClaim} from '@mandate/domain';
import type {AccountRecord} from '@mandate/domain';
import {Ledger,LedgerError} from './index.ts';
import type {Queryable} from './database.ts';

const fail=(code:string):never=>{throw new LedgerError(code);};
const iso=(value:unknown)=>(value instanceof Date?value:new Date(String(value))).toISOString();
function schedule(row:Record<string,any>):RecurringSchedule{return {id:row.id,accountId:row.account_id,wallet:row.wallet,requestId:row.request_id,status:row.status,revision:row.revision,intervalSeconds:row.interval_seconds,scenario:row.scenario,startsAt:iso(row.starts_at),nextDueAt:iso(row.next_due),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),researchOnly:true,authority:'proposal-only'};}
function firing(row:Record<string,any>):RecurringFiring{return {id:row.id,accountId:row.account_id,scheduleId:row.schedule_id,dueAt:iso(row.due_at),requestId:row.request_id,attempts:row.attempts,state:row.state,proposalId:row.proposal_id,reason:row.reason,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};}
async function event(tx:Queryable,accountId:string,kind:string,payload:Record<string,unknown>){const id=randomUUID(),message={schemaVersion:'1.0.0',id,accountId,kind,payload,createdAt:new Date().toISOString()};await tx.query('INSERT INTO journal(id,account_id,kind,payload) VALUES($1,$2,$3,$4)',[id,accountId,kind,JSON.stringify(message)]);await tx.query('INSERT INTO outbox(id,payload) VALUES($1,$2)',[id,JSON.stringify(message)]);}

export class RecurringStore{
 constructor(private readonly ledger:Ledger){}
 async schedules(accountId:string){return (await this.ledger.db.query("SELECT * FROM recurring_schedules WHERE account_id=$1 ORDER BY CASE WHEN status IN ('active','paused') THEN 0 ELSE 1 END, created_at DESC,id DESC LIMIT 40",[accountId])).rows.map(schedule);}
 async firings(accountId:string){return (await this.ledger.db.query('SELECT * FROM recurring_firings WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30',[accountId])).rows.map(firing);}
 async create(accountId:string,wallet:string,raw:RecurringScheduleInput,now=new Date()){
  const input=recurringScheduleInputSchema.parse(raw),startsAt=input.startsAt?new Date(input.startsAt):now;
  return this.ledger.db.transaction(async tx=>{
   const account=(await tx.query<{record:AccountRecord}>('SELECT record FROM accounts WHERE id=$1 FOR UPDATE',[accountId])).rows[0]?.record;
   if(!account||account.wallet.toLowerCase()!==wallet.toLowerCase())fail('ACCOUNT_NOT_FOUND');
   const prior=(await tx.query('SELECT * FROM recurring_schedules WHERE account_id=$1 AND request_id=$2',[accountId,input.requestId])).rows[0];
   if(prior){if(prior.interval_seconds!==input.intervalSeconds||prior.scenario!==input.scenario||input.startsAt&&iso(prior.starts_at)!==startsAt.toISOString())fail('RECURRING_REQUEST_CONFLICT');return schedule(prior);}
   if(!Number.isFinite(startsAt.getTime())||startsAt.getTime()<now.getTime()-60000||startsAt.getTime()>now.getTime()+365*86400000)fail('INVALID_RECURRING_START');
   const mandate=(await tx.query('SELECT id FROM investment_mandates WHERE account_id=$1 ORDER BY revision DESC LIMIT 1',[accountId])).rows[0];if(!mandate)fail('SAVED_MANDATE_REQUIRED');
   const active=(await tx.query<{count:string}>("SELECT COUNT(*)::text AS count FROM recurring_schedules WHERE account_id=$1 AND status IN ('active','paused')",[accountId])).rows[0];if(Number(active.count)>=20)fail('RECURRING_LIMIT');
   const id=randomUUID(),row=(await tx.query('INSERT INTO recurring_schedules(id,account_id,wallet,request_id,status,revision,interval_seconds,scenario,starts_at,next_due) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$8) RETURNING *',[id,accountId,wallet.toLowerCase(),input.requestId,'active',input.intervalSeconds,input.scenario,startsAt.toISOString()])).rows[0];
   await event(tx,accountId,'recurring.schedule.created',{scheduleId:id,authority:'proposal-only',intervalSeconds:input.intervalSeconds});return schedule(row);
  });
 }
 async change(accountId:string,id:string,expectedRevision:number,action:'pause'|'resume'|'revoke'){
  if(!Number.isInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');
  return this.ledger.db.transaction(async tx=>{
   await tx.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[accountId]);
   const prior=(await tx.query('SELECT * FROM recurring_schedules WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,id])).rows[0];if(!prior)fail('RECURRING_NOT_FOUND');
   if(prior.revision!==expectedRevision)fail('STALE_RECURRING_SCHEDULE');
   if(prior.status==='revoked'||action==='resume'&&prior.status!=='paused'||action==='pause'&&prior.status!=='active')fail('RECURRING_TRANSITION_INVALID');
   const status=action==='resume'?'active':action==='pause'?'paused':'revoked';
   const row=(await tx.query('UPDATE recurring_schedules SET status=$3,revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *',[accountId,id,status])).rows[0];
   if(status!=='active')await tx.query("UPDATE recurring_firings SET state='cancelled',reason=$3,updated_at=clock_timestamp() WHERE account_id=$1 AND schedule_id=$2 AND state IN ('claimed','deferred')",[accountId,id,status.toUpperCase()]);
   await event(tx,accountId,'recurring.schedule.'+status,{scheduleId:id,revision:row.revision});return schedule(row);
  });
 }
 async claim(now=new Date()):Promise<RecurringClaim|null>{
  return this.ledger.db.transaction(async tx=>{
   const row=(await tx.query("SELECT * FROM recurring_schedules WHERE status='active' AND next_due<=$1 AND (lease_until IS NULL OR lease_until<$1) ORDER BY next_due,id FOR UPDATE SKIP LOCKED LIMIT 1",[now.toISOString()])).rows[0];if(!row)return null;
   const due=iso(row.next_due),token=randomUUID(),until=new Date(now.getTime()+120000).toISOString();
   let run=(await tx.query('SELECT * FROM recurring_firings WHERE schedule_id=$1 AND due_at=$2 FOR UPDATE',[row.id,due])).rows[0];
   if(run?.state==='proposed')fail('RECURRING_STATE_CONFLICT');
   if(run)run=(await tx.query("UPDATE recurring_firings SET state='claimed',attempts=attempts+1,reason=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[run.id])).rows[0];
   else run=(await tx.query("INSERT INTO recurring_firings(id,account_id,schedule_id,due_at,request_id,state,attempts) VALUES($1,$2,$3,$4,$5,'claimed',1) RETURNING *",[randomUUID(),row.account_id,row.id,due,randomUUID()])).rows[0];
   await tx.query('UPDATE recurring_schedules SET lease_token=$2,lease_until=$3 WHERE id=$1',[row.id,token,until]);
   return {schedule:schedule(row),firing:firing(run),leaseToken:token};
  });
 }
 async defer(claim:RecurringClaim,reason:string,now=new Date()){
  const safeReason=reason.slice(0,120);
  return this.ledger.db.transaction(async tx=>{
   await tx.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[claim.schedule.accountId]);
   const row=(await tx.query('SELECT * FROM recurring_schedules WHERE id=$1 FOR UPDATE',[claim.schedule.id])).rows[0];
   if(!row||row.status!=='active'||row.revision!==claim.schedule.revision||row.lease_token!==claim.leaseToken)return false;
   const run=(await tx.query('SELECT * FROM recurring_firings WHERE id=$1 FOR UPDATE',[claim.firing.id])).rows[0];if(!run||run.state!=='claimed'||run.request_id!==claim.firing.requestId)return false;
   await tx.query("UPDATE recurring_firings SET state='deferred',reason=$2,updated_at=clock_timestamp() WHERE id=$1",[run.id,safeReason]);
   await tx.query('UPDATE recurring_schedules SET lease_token=NULL,lease_until=$2 WHERE id=$1',[row.id,new Date(now.getTime()+30000).toISOString()]);
   await event(tx,row.account_id,'recurring.firing.deferred',{scheduleId:row.id,firingId:run.id,reason:safeReason});return true;
  });
 }
}
