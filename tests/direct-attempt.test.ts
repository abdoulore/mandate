import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DirectAttemptStore,Ledger,embeddedDatabase} from '@mandate/store';

const wallet='0x1111111111111111111111111111111111111111';
const target='0x2222222222222222222222222222222222222222';
const token='0x3333333333333333333333333333333333333333';
const stock='0x4444444444444444444444444444444444444444';
const transactionHash='0x'+'5'.repeat(64);
const blockHash='0x'+'6'.repeat(64);
const directories:string[]=[];
const ledgers:Ledger[]=[];
afterEach(async()=>{for(const ledger of ledgers.splice(0))await ledger.close();for(const directory of directories.splice(0))await fs.rm(directory,{recursive:true,force:true});});
async function open(directory?:string){const ledger=new Ledger(embeddedDatabase(directory));ledgers.push(ledger);await ledger.migrate();return {ledger,store:new DirectAttemptStore(ledger.db)};}
function draft(){return {wallet,kind:'swap' as const,direction:'BUY' as const,chainId:56 as const,to:target,data:'0x414bf38900000000',valueAtomic:'0' as const,tokenIn:token,tokenOut:stock,amountInAtomic:'10000000000000000000',minimumOutAtomic:'1',deadline:String(Math.floor(Date.now()/1000)+120),expiresAt:new Date(Date.now()+30000).toISOString()};}

describe('durable direct wallet attempts',()=>{
 it('commits a one-shot submission barrier before a wallet can be asked to send',async()=>{
  const {store}=await open();const attempt=await store.prepare(draft());
  await expect(store.prepare(draft())).rejects.toThrow('DIRECT_ATTEMPT_PENDING');
  const begun=await store.begin(wallet,attempt.id);expect(begun.state).toBe('submission_unknown');
  await expect(store.begin(wallet,attempt.id)).rejects.toThrow('DIRECT_ATTEMPT_ALREADY_BEGUN');
  await expect(store.abandon(wallet,attempt.id)).rejects.toThrow('DIRECT_ATTEMPT_ALREADY_BEGUN');
  await expect(store.prepare(draft())).rejects.toThrow('DIRECT_ATTEMPT_PENDING');
 },20000);
 it('keeps unknown submissions blocked after restart, then records one hash and settlement',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mandate-direct-'));directories.push(directory);
  let {ledger,store}=await open(directory);const attempt=await store.prepare(draft());await store.begin(wallet,attempt.id);
  await ledger.close();ledgers.splice(ledgers.indexOf(ledger),1);
  ({ledger,store}=await open(directory));await expect(store.prepare(draft())).rejects.toThrow('DIRECT_ATTEMPT_PENDING');
  expect((await store.get(wallet,attempt.id))?.state).toBe('submission_unknown');
  await store.recordHash(wallet,attempt.id,transactionHash);
  expect((await store.recordHash(wallet,attempt.id,transactionHash)).transactionHash).toBe(transactionHash);
  await expect(store.recordHash(wallet,attempt.id,'0x'+'7'.repeat(64))).rejects.toThrow('DIRECT_ATTEMPT_HASH_CONFLICT');
  await expect(store.prepare(draft())).rejects.toThrow('DIRECT_ATTEMPT_PENDING');
  const record=await store.settle(wallet,attempt.id,{status:'success',blockNumber:'123',blockHash,confirmations:'12',observedAt:new Date().toISOString()});
  expect(record.state).toBe('confirmed');expect((await store.history(wallet))[0]?.settlement?.blockHash).toBe(blockHash);
  expect((await store.prepare(draft())).state).toBe('prepared');
 },20000);
 it('does not allow an unsubmitted or weakly confirmed receipt to clear the barrier',async()=>{
  const {store}=await open();const attempt=await store.prepare(draft());
  await expect(store.settle(wallet,attempt.id,{status:'success',blockNumber:'123',blockHash,confirmations:'12',observedAt:new Date().toISOString()})).rejects.toThrow('DIRECT_ATTEMPT_NOT_SUBMITTED');
  await store.begin(wallet,attempt.id);await store.recordHash(wallet,attempt.id,transactionHash);
  await expect(store.settle(wallet,attempt.id,{status:'success',blockNumber:'123',blockHash,confirmations:'11',observedAt:new Date().toISOString()})).rejects.toThrow('INVALID_SETTLEMENT');
  await expect(store.prepare(draft())).rejects.toThrow('DIRECT_ATTEMPT_PENDING');
 },20000);
 it('abandons only expired, never-begun reviews',async()=>{
  const {ledger,store}=await open();const first=await store.prepare(draft());
  await ledger.db.query("UPDATE direct_attempts SET record=jsonb_set(record,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1",[first.id,new Date(Date.now()-1000).toISOString()]);
  const next=await store.prepare(draft());expect(next.id).not.toBe(first.id);
  expect((await store.get(wallet,first.id))?.state).toBe('abandoned');
 },20000);
});
