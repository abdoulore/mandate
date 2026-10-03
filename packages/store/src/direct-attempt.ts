import {randomUUID} from 'node:crypto';
import type {Database} from './database.ts';

export const directAttemptMigration = [
 `CREATE TABLE direct_attempts(
   id text PRIMARY KEY,
   wallet text NOT NULL,
   kind text NOT NULL CHECK(kind IN ('approval','swap')),
   direction text NOT NULL CHECK(direction IN ('BUY','SELL')),
   state text NOT NULL CHECK(state IN ('prepared','submission_unknown','submitted','confirmed','reverted','abandoned')),
   transaction_hash text UNIQUE,
   record jsonb NOT NULL,
   created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
 `CREATE UNIQUE INDEX direct_attempt_one_active_per_wallet ON direct_attempts(wallet)
   WHERE state IN ('prepared','submission_unknown','submitted')`,
 'INSERT INTO mandate_schema(version) VALUES(9)',
];

export type DirectAttemptState='prepared'|'submission_unknown'|'submitted'|'confirmed'|'reverted'|'abandoned';
export type DirectAttempt={
 id:string;wallet:string;kind:'approval'|'swap';direction:'BUY'|'SELL';chainId:56;
 to:string;data:string;valueAtomic:'0';tokenIn:string;tokenOut:string;
 amountInAtomic:string;minimumOutAtomic:string;deadline:string;
 preparedAt:string;expiresAt:string;state:DirectAttemptState;
 transactionHash:string|null;settlement:null|{status:'success'|'reverted';blockNumber:string;blockHash:string;confirmations:string;observedAt:string;spentAtomic?:string;receivedAtomic?:string;gasCostWei?:string};
 recovery?:{reason:'expired_without_observed_token_spend';checkedAt:string;fromBlock:string;throughBlock:string;throughBlockHash:string;throughTimestamp:string};
};
type PrepareInput=Omit<DirectAttempt,'id'|'preparedAt'|'state'|'transactionHash'|'settlement'>;
const address=/^0x[0-9a-fA-F]{40}$/;
const hash=/^0x[0-9a-fA-F]{64}$/;
const quantity=/^(0|[1-9]\d*)$/;
export class DirectAttemptError extends Error {constructor(public code:string){super(code);}}
const fail=(code:string):never=>{throw new DirectAttemptError(code);};

// The barrier is committed before calldata is handed to a wallet. Once begun,
// an unknown wallet result can only be reconciled; it is never made retryable.
export class DirectAttemptStore {
 constructor(private readonly db:Database){}
 async history(wallet:string){
  if(!address.test(wallet))fail('INVALID_WALLET');
  return (await this.db.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[wallet.toLowerCase()])).rows.map(row=>row.record);
 }
 async get(wallet:string,id:string){
  if(!address.test(wallet))fail('INVALID_WALLET');
  return (await this.db.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2',[wallet.toLowerCase(),id])).rows[0]?.record??null;
 }
 async trialSellAmount(wallet:string,buyHash:string){
  if(!address.test(wallet)||!hash.test(buyHash))return null;
  const buy=(await this.db.query<{record:DirectAttempt}>("SELECT record FROM direct_attempts WHERE wallet=$1 AND transaction_hash=$2 AND kind='swap' AND direction='BUY' AND state='confirmed'",[wallet.toLowerCase(),buyHash.toLowerCase()])).rows[0]?.record;
  const received=buy?.settlement?.receivedAtomic;
  if(buy?.settlement?.status!=='success'||buy.settlement.spentAtomic!=='1000000000000000000'||!received||!quantity.test(received)||BigInt(received)<=0n||BigInt(received)>2n*10n**16n)return null;
  const sold=(await this.db.query("SELECT id FROM direct_attempts WHERE wallet=$1 AND kind='swap' AND direction='SELL' AND state='confirmed' LIMIT 1",[wallet.toLowerCase()])).rows.length>0;
  return sold?null:received;
 }
 async prepare(input:PrepareInput){
  const now=Date.now(),expiry=Date.parse(input.expiresAt);
  if(!address.test(input.wallet)||!address.test(input.to)||!address.test(input.tokenIn)||!address.test(input.tokenOut)||!/^0x[0-9a-fA-F]{8,}$/.test(input.data)||input.data.length%2||input.chainId!==56||input.valueAtomic!=='0'||!quantity.test(input.amountInAtomic)||!quantity.test(input.minimumOutAtomic)||!quantity.test(input.deadline)||!Number.isFinite(expiry)||expiry<=now||expiry>now+120000||!['approval','swap'].includes(input.kind)||!['BUY','SELL'].includes(input.direction))fail('INVALID_DIRECT_ATTEMPT');
  if(BigInt(input.amountInAtomic)<=0n||BigInt(input.deadline)*1000n<BigInt(Math.ceil(expiry)))fail('INVALID_DIRECT_ATTEMPT');
  const record:DirectAttempt={...input,wallet:input.wallet.toLowerCase(),to:input.to.toLowerCase(),tokenIn:input.tokenIn.toLowerCase(),tokenOut:input.tokenOut.toLowerCase(),id:randomUUID(),preparedAt:new Date(now).toISOString(),state:'prepared',transactionHash:null,settlement:null};
  return this.db.transaction(async tx=>{
   await tx.query("UPDATE direct_attempts SET state='abandoned',record=jsonb_set(record,'{state}','\"abandoned\"'::jsonb),updated_at=clock_timestamp() WHERE wallet=$1 AND state='prepared' AND (record->>'expiresAt')::timestamptz<=clock_timestamp()",[record.wallet]);
   const active=(await tx.query<{state:DirectAttemptState}>('SELECT state FROM direct_attempts WHERE wallet=$1 AND state IN (\'prepared\',\'submission_unknown\',\'submitted\') FOR UPDATE',[record.wallet])).rows[0];
   if(active)fail('DIRECT_ATTEMPT_PENDING');
   try{await tx.query('INSERT INTO direct_attempts(id,wallet,kind,direction,state,record) VALUES($1,$2,$3,$4,$5,$6)',[record.id,record.wallet,record.kind,record.direction,record.state,JSON.stringify(record)]);}catch(error){if((error as {code?:string}).code==='23505')fail('DIRECT_ATTEMPT_PENDING');throw error;}
   return record;
  });
 }
 async begin(wallet:string,id:string){
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),id])).rows[0];
   if(!row)fail('DIRECT_ATTEMPT_NOT_FOUND');
   if(row.record.state!=='prepared')fail('DIRECT_ATTEMPT_ALREADY_BEGUN');
   if(Date.parse(row.record.expiresAt)<=Date.now())fail('DIRECT_ATTEMPT_EXPIRED');
   const record={...row.record,state:'submission_unknown' as const};
   await tx.query('UPDATE direct_attempts SET state=$2,record=$3,updated_at=clock_timestamp() WHERE id=$1',[id,record.state,JSON.stringify(record)]);
   return record;
  });
 }
 async abandon(wallet:string,id:string){
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),id])).rows[0];
   if(!row)fail('DIRECT_ATTEMPT_NOT_FOUND');
   if(row.record.state!=='prepared')fail('DIRECT_ATTEMPT_ALREADY_BEGUN');
   const record={...row.record,state:'abandoned' as const};
   await tx.query('UPDATE direct_attempts SET state=$2,record=$3,updated_at=clock_timestamp() WHERE id=$1',[id,record.state,JSON.stringify(record)]);
   return record;
  });
 }
 async releaseExpiredSwap(wallet:string,id:string,recovery:NonNullable<DirectAttempt['recovery']>){
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),id])).rows[0];
   if(!row)fail('DIRECT_ATTEMPT_NOT_FOUND');
   const prior=row.record;
   if(prior.kind!=='swap'||prior.state!=='submission_unknown'||prior.transactionHash!==null)fail('DIRECT_ATTEMPT_NOT_RECOVERABLE');
   if(recovery.reason!=='expired_without_observed_token_spend'||!Number.isFinite(Date.parse(recovery.checkedAt))||!quantity.test(recovery.fromBlock)||!quantity.test(recovery.throughBlock)||!hash.test(recovery.throughBlockHash)||!quantity.test(recovery.throughTimestamp)||BigInt(recovery.throughTimestamp)<BigInt(prior.deadline)+60n||BigInt(recovery.throughBlock)<BigInt(recovery.fromBlock))fail('INVALID_DIRECT_RECOVERY');
   const record={...prior,state:'abandoned' as const,recovery};
   await tx.query('UPDATE direct_attempts SET state=$2,record=$3,updated_at=clock_timestamp() WHERE id=$1',[id,record.state,JSON.stringify(record)]);
   return record;
  });
 }
 async recordHash(wallet:string,id:string,transactionHash:string){
  if(!hash.test(transactionHash))fail('INVALID_TRANSACTION_HASH');
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),id])).rows[0];
   if(!row)fail('DIRECT_ATTEMPT_NOT_FOUND');
   if(row.record.transactionHash?.toLowerCase()===transactionHash.toLowerCase())return row.record;
   if(row.record.state!=='submission_unknown'||row.record.transactionHash)fail('DIRECT_ATTEMPT_HASH_CONFLICT');
   const record={...row.record,state:'submitted' as const,transactionHash:transactionHash.toLowerCase()};
   try{await tx.query('UPDATE direct_attempts SET state=$2,transaction_hash=$3,record=$4,updated_at=clock_timestamp() WHERE id=$1',[id,record.state,record.transactionHash,JSON.stringify(record)]);}catch(error){if((error as {code?:string}).code==='23505')fail('DIRECT_ATTEMPT_HASH_CONFLICT');throw error;}
   return record;
  });
 }
 async settle(wallet:string,id:string,settlement:NonNullable<DirectAttempt['settlement']>){
  if(!quantity.test(settlement.blockNumber)||!hash.test(settlement.blockHash)||!quantity.test(settlement.confirmations)||BigInt(settlement.confirmations)<12n||!Number.isFinite(Date.parse(settlement.observedAt))||settlement.spentAtomic!==undefined&&!quantity.test(settlement.spentAtomic)||settlement.receivedAtomic!==undefined&&!quantity.test(settlement.receivedAtomic)||settlement.gasCostWei!==undefined&&!quantity.test(settlement.gasCostWei)||((settlement.spentAtomic===undefined)!==(settlement.receivedAtomic===undefined)))fail('INVALID_SETTLEMENT');
  return this.db.transaction(async tx=>{
   const row=(await tx.query<{record:DirectAttempt}>('SELECT record FROM direct_attempts WHERE wallet=$1 AND id=$2 FOR UPDATE',[wallet.toLowerCase(),id])).rows[0];
   if(!row)fail('DIRECT_ATTEMPT_NOT_FOUND');
   if(row.record.state==='confirmed'||row.record.state==='reverted'){
    const prior=row.record.settlement;
    if(!prior)throw new DirectAttemptError('DIRECT_SETTLEMENT_CONFLICT');
    if(prior.status!==settlement.status||prior.blockNumber!==settlement.blockNumber||prior.blockHash!==settlement.blockHash)fail('DIRECT_SETTLEMENT_CONFLICT');
    if(prior.spentAtomic!==undefined||settlement.spentAtomic===undefined)return row.record;
    const record={...row.record,settlement};
    await tx.query('UPDATE direct_attempts SET record=$2,updated_at=clock_timestamp() WHERE id=$1',[id,JSON.stringify(record)]);
    return record;
   }
   if(row.record.state!=='submitted'||!row.record.transactionHash)fail('DIRECT_ATTEMPT_NOT_SUBMITTED');
   const record={...row.record,state:settlement.status==='success'?'confirmed' as const:'reverted' as const,settlement};
   await tx.query('UPDATE direct_attempts SET state=$2,record=$3,updated_at=clock_timestamp() WHERE id=$1',[id,record.state,JSON.stringify(record)]);
   return record;
  });
 }
}
