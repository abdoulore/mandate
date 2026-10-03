import {describe,it,expect} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import type {CapitalView,SavedInvestmentMandate} from '@mandate/domain';
import {Ledger,DirectAttemptStore,embeddedDatabase} from '@mandate/store';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {reviewDirectMandate} from '../apps/api/src/direct-mandate-review.ts';
import {PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';
import type {readDirectPreflight} from '../apps/api/src/direct-preflight.ts';

const amount='1000000000000000000';
const now=Date.now();
const mandate:SavedInvestmentMandate={id:'mandate-1',accountId:'account-1',revision:2,createdAt:new Date(now).toISOString(),researchOnly:true,policy:{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:100,allowLeveraged:false,representationAllowlist:[PANCAKE_V3.spyOn.toLowerCase()],exposureScope:'tracked-holdings-pending-proposed'}};
const capital:CapitalView={state:'OBSERVED',executionAllowed:false,accountId:'account-1',revision:3,decimals:18,balanceAtomic:'3000000000000000000',protectedAtomic:'1000000000000000000',heldAtomic:'0',availableAtomic:'2000000000000000000',shortfallAtomic:'0',checkpointId:'checkpoint-1',checkpoint:{accountId:'account-1',wallet:'0x'+'1'.repeat(40),asset:{chainId:56,contract:PANCAKE_V3.usdt.toLowerCase(),decimals:18},balanceAtomic:'3000000000000000000',blockNumber:'123',blockHash:'0x'+'2'.repeat(64),observedAt:new Date(now).toISOString(),positions:[],evidenceMode:'observed'},policy:{reserveFloor:'1',operatingBudget:'0',obligations:[]},policyRevision:1,portfolio:{state:'KNOWN',decimals:18,currency:'USD-nominal-USDT-parity',checkedAt:new Date(now).toISOString(),scope:'tracked',reasons:[],positions:[],existing:[],pending:[],pendingCount:0,byIssuer:[],byUnderlying:[]}};
const route={state:'READ_ONLY_CHECK',executionEnabled:false,checkedAt:new Date(now).toISOString(),blockNumber:'123',blockHash:'0x'+'2'.repeat(64),direction:'BUY',assetIn:PANCAKE_V3.usdt,assetOut:PANCAKE_V3.spyOn,amountInAtomic:amount,quotedOutAtomic:'1286000000000000',minimumOutAtomic:'1280000000000000',pool:'0x'+'3'.repeat(40),router:PANCAKE_V3.router,selector:'0x414bf389',wallet:{balanceAtomic:amount,allowanceAtomic:amount,bnbAtomic:amount},gates:{poolIdentity:'CHECKED',calldataMeaning:'CHECKED',referenceCost:'CHECKED',funds:'CHECKED',spendingPermission:'CHECKED',simulation:'PASSED',gas:'CHECKED',authorization:'NOT_REQUESTED',settlement:'NOT_RUN'},reference:{price:'780',updatedAt:new Date(now).toISOString(),deviationBps:'10',reason:'WITHIN_LIMIT',maximumAdverseBps:200},gasBudgetAtomic:'1000',note:'test'} as Awaited<ReturnType<typeof readDirectPreflight>>;

describe('saved mandate and direct route boundary',()=>{
 it('recognizes a bounded route but never grants execution or wallet authorization',()=>{
  const review=reviewDirectMandate(mandate,capital,route,amount,now);
  expect(review).toMatchObject({state:'POLICY_CHECKED',executionAllowed:false,authorizationRequested:false,mandateRevision:2,cashPolicyRevision:1,routeBlockNumber:'123',reasons:[]});
 });
 it('blocks unapproved representation, protected cash and unknown exposure even with a good quote',()=>{
  const unauthorized={...mandate,policy:{...mandate.policy,representationAllowlist:[]}};
  const stale={...capital,availableAtomic:'0',portfolio:{...capital.portfolio!,state:'UNKNOWN' as const,reasons:['unpriced position']}};
  const review=reviewDirectMandate(unauthorized,stale,route,amount,now);
  expect(review.reasons).toEqual(expect.arrayContaining(['REPRESENTATION_NOT_ALLOWED','PROTECTED_CASH_INSUFFICIENT','PORTFOLIO_EXPOSURE_UNKNOWN']));
  expect(review.state).toBe('BLOCKED');
 });
 it('checks worst-case output against the saved cost limit and does not reuse an expired quote',()=>{
  const strict={...mandate,policy:{...mandate.policy,maxCostBps:10}};
  const review=reviewDirectMandate(strict,capital,route,amount,now+11000);
  expect(review.reasons).toEqual(expect.arrayContaining(['MANDATE_COST_LIMIT','ROUTE_CHECK_STALE']));
 });
 it('rejects a malformed output limit even if other route checks claim success',()=>{
  const inconsistent={...route,minimumOutAtomic:(BigInt(route.quotedOutAtomic)+1n).toString()};
  expect(reviewDirectMandate(mandate,capital,inconsistent,amount,now).reasons).toContain('ROUTE_OUTPUT_INVALID');
 });
 it('blocks a single-asset buy that would exceed a multi-asset target or issuer cap',()=>{
  const split={...mandate,policy:{...mandate.policy,allocations:[{underlying:'SPY',weightBps:5000},{underlying:'QQQ',weightBps:5000}],maxIssuerBps:5000}};
  const review=reviewDirectMandate(split,capital,route,amount,now);
  expect(review.reasons).toEqual(expect.arrayContaining(['ALLOCATION_LIMIT','ISSUER_LIMIT']));
 });
 it('reviews saved wallet rules through the API without creating an execution attempt',async()=>{
  const ledger=new Ledger(embeddedDatabase());await ledger.migrate();
  const signer=privateKeyToAccount('0x'+'37'.repeat(32) as `0x${string}`),wallet=signer.address.toLowerCase(),accountId=capitalAccountId(wallet);
  const checkpoint={...capital.checkpoint!,accountId,wallet,positions:passportDefinitions().map(p=>({contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1' as const,state:'OBSERVED' as const}))};
  await ledger.applyCapitalCheckpoint(checkpoint);
  const state=await ledger.capitalState(accountId);
  await ledger.saveCapitalPolicy(accountId,capital.policy,state!.revision);
  await ledger.saveInvestmentMandate(accountId,mandate.policy,0);
  const app=createApp(process.cwd(),{ledger,recurringTickMs:null,capitalReader:async()=>({...checkpoint,blockNumber:String(124+Math.floor(Date.now()/1000)%1000000),blockHash:'0x'+'4'.repeat(64),observedAt:new Date().toISOString()}),directReader:async()=>({...route,checkedAt:new Date().toISOString(),reference:{...route.reference,updatedAt:new Date().toISOString()}})});
  try{
   const origin='http://127.0.0.1:3110',challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:signer.address,chainId:56}})).json();
   const signature=await signer.signMessage({message:challenge.message});
   const verified=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature}});
   const headers={origin,cookie:String(verified.headers['set-cookie']).split(';')[0]};
   const result=await app.inject({method:'POST',url:'/v1/routes/SPYon/mandate-review',headers,payload:{buyAmountAtomic:amount}});
   expect(result.statusCode).toBe(200);
   expect(result.json()).toMatchObject({state:'POLICY_CHECKED',executionAllowed:false,authorizationRequested:false,mandateRevision:1});
   expect(await new DirectAttemptStore(ledger.db).history(wallet)).toEqual([]);
  }finally{await app.close();await ledger.close();}
 },30000);
});
