import {describe,expect,it} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {DirectAttemptStore,Ledger,PlanBoundDirectStore,embeddedDatabase} from '@mandate/store';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {buildDirectSwap,PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';

const signer=privateKeyToAccount('0x'+'42'.repeat(32) as `0x${string}`);
const wallet=signer.address.toLowerCase(),accountId=capitalAccountId(wallet),unit=10n**18n;

describe('plan-bound direct API reconciliation',()=>{
 it('uses the verified settlement and refreshed wallet checkpoint to close the hold once',async()=>{
  const ledger=new Ledger(embeddedDatabase());await ledger.migrate();
  const checkpoint={accountId,wallet,asset:{chainId:56,contract:PANCAKE_V3.usdt.toLowerCase(),decimals:18},balanceAtomic:(3n*unit).toString(),blockNumber:'100',blockHash:'0x'+'5'.repeat(64),observedAt:new Date().toISOString(),positions:passportDefinitions().map(p=>({contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1' as const,state:'OBSERVED' as const})),evidenceMode:'observed' as const};
  await ledger.applyCapitalCheckpoint(checkpoint);
  await ledger.saveCapitalPolicy(accountId,{reserveFloor:'1',operatingBudget:'0',obligations:[]},(await ledger.capitalState(accountId))!.revision);
  const mandate=await ledger.saveInvestmentMandate(accountId,{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:100,allowLeveraged:false,representationAllowlist:[PANCAKE_V3.spyOn.toLowerCase()],exposureScope:'tracked-holdings-pending-proposed'},0);
  const origin='http://127.0.0.1:3110',blockHash='0x'+'7'.repeat(64),hash='0x'+'6'.repeat(64);
  let received='0';
  const app=createApp(process.cwd(),{ledger,recurringTickMs:null,marketReader:async()=>({observedAt:new Date().toISOString(),items:[],source:'fixture'}),capitalReader:async()=>({...checkpoint,balanceAtomic:(2n*unit).toString(),blockNumber:'101',blockHash,observedAt:new Date().toISOString(),positions:checkpoint.positions.map(p=>p.contract.toLowerCase()===PANCAKE_V3.spyOn.toLowerCase()?{...p,rawAtomic:received}:p)}),directSettlementReader:async()=>({status:'success',blockNumber:'101',blockHash,confirmations:'12',observedAt:new Date().toISOString(),spentAtomic:unit.toString(),receivedAtomic:received,gasCostWei:'100'})});
  try{
   const challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:signer.address,chainId:56}})).json();
   const signature=await signer.signMessage({message:challenge.message});
   const verified=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature}});
   const headers={origin,cookie:String(verified.headers['set-cookie']).split(';')[0]};
   const state=(await ledger.capitalState(accountId))!,transaction=buildDirectSwap({direction:'BUY',recipient:wallet as `0x${string}`,amountIn:unit,quotedOut:1290000000000000n,nowMs:Date.now()});
   received=transaction.amountOutMinimum.toString();
   const store=new PlanBoundDirectStore(ledger.db);
   const {attempt,reservation}=await store.prepare({accountId,wallet,expectedAccountRevision:state.revision,mandateId:mandate.id,mandateRevision:mandate.revision,cashPolicyRevision:state.policyRevision,checkpointId:state.checkpointId,amountAtomic:unit.toString(),minimumOutAtomic:received,referencePriceUsd:'780',referenceUpdatedAt:new Date().toISOString(),routeCheckedAt:new Date().toISOString(),router:transaction.to,data:transaction.data,deadline:transaction.deadline.toString(),expiresAt:new Date(Date.now()+15000).toISOString()});
   await store.begin(wallet,attempt.id);
   await new DirectAttemptStore(ledger.db).recordHash(wallet,attempt.id,hash);
   const result=await app.inject({method:'POST',url:'/v1/routes/SPYon/reconcile',headers,payload:{attemptId:attempt.id}});
   expect(result.statusCode).toBe(200);
   expect(result.json().attempt).toMatchObject({id:attempt.id,state:'confirmed',transactionHash:hash});
   expect((await ledger.snapshot(accountId)).balanceAtomic).toBe((2n*unit).toString());
   expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
   expect((await ledger.db.query<{state:string}>('SELECT state FROM reservations WHERE id=$1',[reservation.id])).rows[0].state).toBe('consumed');
   const replay=await app.inject({method:'POST',url:'/v1/routes/SPYon/reconcile',headers,payload:{attemptId:attempt.id}});
   expect(replay.statusCode).toBe(200);
   expect((await ledger.db.query<{count:string}>('SELECT COUNT(*)::text AS count FROM receipts WHERE reservation_id=$1',[reservation.id])).rows[0].count).toBe('1');
  }finally{await app.close();await ledger.close();}
 },60000);
});
