import {describe,expect,it,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {Ledger,embeddedDatabase} from '@mandate/store';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {buildDirectSwap,PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';

const signer=privateKeyToAccount('0x'+'43'.repeat(32) as `0x${string}`);
const wallet=signer.address.toLowerCase(),accountId=capitalAccountId(wallet),unit=10n**18n;

describe('gated plan-bound buy preparation',()=>{
 it('requires the explicit flag, caps the amount, stages a hold, and fences calldata before wallet review',async()=>{
  const prior={wallets:process.env.MANDATE_DIRECT_PILOT_WALLETS,plan:process.env.MANDATE_PLAN_DIRECT_ENABLED,full:process.env.MANDATE_DIRECT_EXECUTION_ENABLED,approval:process.env.MANDATE_DIRECT_APPROVAL_ENABLED};
  const ledger=new Ledger(embeddedDatabase());await ledger.migrate();
  const checkpoint={accountId,wallet,asset:{chainId:56,contract:PANCAKE_V3.usdt.toLowerCase(),decimals:18},balanceAtomic:(3n*unit).toString(),blockNumber:'100',blockHash:'0x'+'5'.repeat(64),observedAt:new Date().toISOString(),positions:passportDefinitions().map(p=>({contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1' as const,state:'OBSERVED' as const})),evidenceMode:'observed' as const};
  await ledger.applyCapitalCheckpoint(checkpoint);
  await ledger.saveCapitalPolicy(accountId,{reserveFloor:'1',operatingBudget:'0',obligations:[]},(await ledger.capitalState(accountId))!.revision);
  await ledger.saveInvestmentMandate(accountId,{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:100,allowLeveraged:false,representationAllowlist:[PANCAKE_V3.spyOn.toLowerCase()],exposureScope:'tracked-holdings-pending-proposed'},0);
  const app=createApp(process.cwd(),{ledger,recurringTickMs:null,marketReader:async()=>({observedAt:new Date().toISOString(),items:[],source:'fixture'}),capitalReader:async()=>({...checkpoint,blockNumber:'101',blockHash:'0x'+'6'.repeat(64),observedAt:new Date().toISOString()}),directRecoveryReader:async attempt=>({reason:'expired_without_observed_token_spend',checkedAt:new Date(Date.now()).toISOString(),fromBlock:'100',throughBlock:'101',throughBlockHash:'0x'+'a'.repeat(64),throughTimestamp:(BigInt(attempt.deadline)+61n).toString()}),directPreparer:async owner=>{
   const transaction=buildDirectSwap({direction:'BUY',recipient:owner as `0x${string}`,amountIn:unit,quotedOut:1290000000000000n,nowMs:Date.now()});
   const view={state:'READ_ONLY_CHECK' as const,executionEnabled:false,checkedAt:new Date().toISOString(),blockNumber:'101',blockHash:'0x'+'6'.repeat(64) as `0x${string}`,direction:'BUY' as const,assetIn:transaction.tokenIn,assetOut:transaction.tokenOut,amountInAtomic:unit.toString(),quotedOutAtomic:transaction.quotedOut.toString(),minimumOutAtomic:transaction.amountOutMinimum.toString(),pool:'0x'+'1'.repeat(40) as `0x${string}`,router:PANCAKE_V3.router,selector:transaction.data.slice(0,10),wallet:{balanceAtomic:(3n*unit).toString(),allowanceAtomic:unit.toString(),bnbAtomic:'1000000000000000'},approvalPreview:{simulation:'NOT_NEEDED' as const,gas:'NOT_NEEDED' as const,gasBudgetAtomic:null,reason:'Already approved.'},gates:{poolIdentity:'CHECKED' as const,calldataMeaning:'CHECKED' as const,referenceCost:'CHECKED' as const,funds:'CHECKED' as const,spendingPermission:'CHECKED' as const,simulation:'PASSED' as const,gas:'CHECKED' as const,authorization:'NOT_REQUESTED' as const,settlement:'NOT_RUN' as const},reference:{price:'780',updatedAt:new Date().toISOString(),deviationBps:'0',reason:'WITHIN_LIMIT',maximumAdverseBps:200},gasBudgetAtomic:'100000000000000',note:'fixture'};
   return {view,transaction};
  }});
  try{
   const origin='http://127.0.0.1:3110',challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:signer.address,chainId:56}})).json();
   const signature=await signer.signMessage({message:challenge.message});
   const verified=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature}});
   const headers={origin,cookie:String(verified.headers['set-cookie']).split(';')[0]};
   process.env.MANDATE_DIRECT_PILOT_WALLETS=wallet;delete process.env.MANDATE_DIRECT_EXECUTION_ENABLED;delete process.env.MANDATE_PLAN_DIRECT_ENABLED;
   const path='/v1/routes/SPYon/plan/prepare',payload={buyAmountAtomic:unit.toString()};
   expect((await app.inject({method:'POST',url:path,headers,payload})).json().error).toBe('PLAN_DIRECT_EXECUTION_DISABLED');
   process.env.MANDATE_PLAN_DIRECT_ENABLED='true';
   expect((await app.inject({method:'POST',url:path,headers,payload:{buyAmountAtomic:(2n*unit).toString()}})).json().error).toBe('INVALID_PLAN_DIRECT_AMOUNT');
   process.env.MANDATE_DIRECT_EXECUTION_ENABLED='true';process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload:{direction:'BUY',buyAmountAtomic:(2n*unit).toString()}})).json().error).toBe('DIRECT_APPROVAL_TRIAL_LIMIT');
   const result=await app.inject({method:'POST',url:path,headers,payload});
   expect(result.statusCode).toBe(200);
   const body=result.json(),attempt=body.attempt;
   expect(body.plan).toMatchObject({heldAtomic:unit.toString(),mandateRevision:1,cashPolicyRevision:1});
   expect(attempt.planBinding).toMatchObject({planId:body.plan.id,mandateRevision:1,cashPolicyRevision:1});
   expect(result.body).not.toContain('414bf389');
   expect((await ledger.snapshot(accountId)).heldAtomic).toBe(unit.toString());
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload:{direction:'BUY',buyAmountAtomic:unit.toString()}})).json().error).toBe('USE_PLAN_BOUND_PREPARATION');
   const begin=await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:attempt.id}});
   expect(begin.statusCode).toBe(200);
   expect(begin.json().transaction.data).toMatch(/^0x414bf389/);
   expect((await ledger.db.query<{request_id:string}>('SELECT request_id FROM submission_barriers WHERE reservation_id=$1',[attempt.planBinding.reservationId])).rows[0].request_id).toBe(attempt.id);
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:attempt.id}})).statusCode).toBe(409);
   const recoveryPath='/v1/routes/SPYon/recover-expired';
   expect((await app.inject({method:'POST',url:recoveryPath,headers,payload:{attemptId:attempt.id}})).json().error).toBe('PLAN_DIRECT_RECOVERY_EVIDENCE_INVALID');
   expect((await ledger.snapshot(accountId)).heldAtomic).toBe(unit.toString());
   const clock=vi.spyOn(Date,'now').mockReturnValue(Number(attempt.deadline)*1000+65000);
   try{
    const recovered=await app.inject({method:'POST',url:recoveryPath,headers,payload:{attemptId:attempt.id}});
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().attempt).toMatchObject({id:attempt.id,state:'abandoned',recovery:{reason:'expired_without_observed_token_spend'}});
    expect((await ledger.snapshot(accountId)).heldAtomic).toBe('0');
   }finally{clock.mockRestore();}
  }finally{
   for(const [key,value] of [['MANDATE_DIRECT_PILOT_WALLETS',prior.wallets],['MANDATE_PLAN_DIRECT_ENABLED',prior.plan],['MANDATE_DIRECT_EXECUTION_ENABLED',prior.full],['MANDATE_DIRECT_APPROVAL_ENABLED',prior.approval]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
   await app.close();await ledger.close();
  }
 },120000);
});
