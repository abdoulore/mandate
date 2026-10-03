import {afterEach,describe,expect,it} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeFunctionData,parseAbi} from 'viem';
import {createApp} from '../apps/api/src/app.ts';
import {buildDirectSwap,PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {Ledger,embeddedDatabase} from '@mandate/store';

const origin='http://127.0.0.1:3110';
const signer=privateKeyToAccount('0x'+'31'.repeat(32) as `0x${string}`);
const other=privateKeyToAccount('0x'+'32'.repeat(32) as `0x${string}`);
const hash='0x'+'7'.repeat(64);
const blockHash=('0x'+'8'.repeat(64)) as `0x${string}`;
const previousFlags={swap:process.env.MANDATE_DIRECT_EXECUTION_ENABLED,approval:process.env.MANDATE_DIRECT_APPROVAL_ENABLED,wallets:process.env.MANDATE_DIRECT_PILOT_WALLETS};
const ledgers:Ledger[]=[];
afterEach(async()=>{for(const [key,value] of [['MANDATE_DIRECT_EXECUTION_ENABLED',previousFlags.swap],['MANDATE_DIRECT_APPROVAL_ENABLED',previousFlags.approval],['MANDATE_DIRECT_PILOT_WALLETS',previousFlags.wallets]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}for(const ledger of ledgers.splice(0))await ledger.close();});
async function signed(app:Pick<ReturnType<typeof createApp>,'inject'>,account=signer){
 const challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:account.address,chainId:56}})).json();
 const signature=await account.signMessage({message:challenge.message});
 const verified=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature}});
 return {origin,cookie:String(verified.headers['set-cookie']).split(';')[0]};
}
function preparation(owner:string){
 const transaction=buildDirectSwap({direction:'SELL',recipient:owner as `0x${string}`,amountIn:10n**16n,quotedOut:5n*10n**18n,nowMs:Date.now()});
 const view={state:'READ_ONLY_CHECK' as const,executionEnabled:false,checkedAt:new Date().toISOString(),blockNumber:'123',blockHash, direction:'SELL' as const,assetIn:transaction.tokenIn,assetOut:transaction.tokenOut,amountInAtomic:transaction.amountIn.toString(),quotedOutAtomic:transaction.quotedOut.toString(),minimumOutAtomic:transaction.amountOutMinimum.toString(),pool:'0x1111111111111111111111111111111111111111' as `0x${string}`,router:PANCAKE_V3.router,selector:transaction.data.slice(0,10),wallet:{balanceAtomic:transaction.amountIn.toString(),allowanceAtomic:transaction.amountIn.toString(),bnbAtomic:'10000000000000000'},approvalPreview:{simulation:'NOT_NEEDED' as const,gas:'NOT_NEEDED' as const,gasBudgetAtomic:null,reason:'Already approved.'},gates:{poolIdentity:'CHECKED' as const,calldataMeaning:'CHECKED' as const,referenceCost:'CHECKED' as const,funds:'CHECKED' as const,spendingPermission:'CHECKED' as const,simulation:'PASSED' as const,gas:'CHECKED' as const,authorization:'NOT_REQUESTED' as const,settlement:'NOT_RUN' as const},reference:{price:'500',updatedAt:new Date().toISOString(),deviationBps:'0',reason:'WITHIN_LIMIT',maximumAdverseBps:200},gasBudgetAtomic:'1000000000000000',note:'Test fixture'};
 return {view,transaction};
}
function approvalPreparation(owner:string){const base=preparation(owner),amountIn=base.transaction.amountIn;const data=encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),functionName:'approve',args:[PANCAKE_V3.router,amountIn]});return {view:{...base.view,wallet:{...base.view.wallet,allowanceAtomic:'0'},gates:{...base.view.gates,spendingPermission:'BLOCKED' as const,simulation:'NOT_RUN' as const,gas:'UNKNOWN' as const}},transaction:{chainId:56 as const,from:owner as `0x${string}`,to:PANCAKE_V3.spyOn,data,value:0n,tokenIn:PANCAKE_V3.spyOn,tokenOut:PANCAKE_V3.usdt,amountIn,amountOutMinimum:0n,deadline:BigInt(Math.floor(Date.now()/1000)+120)}};}
function approvalPreparationBuy(owner:string){const amountIn=10n**18n,swap=buildDirectSwap({direction:'BUY',recipient:owner as `0x${string}`,amountIn,quotedOut:1285660000000000n,nowMs:Date.now()}),base=preparation(owner);const data=encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),functionName:'approve',args:[PANCAKE_V3.router,amountIn]});return {view:{...base.view,direction:'BUY' as const,assetIn:swap.tokenIn,assetOut:swap.tokenOut,amountInAtomic:amountIn.toString(),quotedOutAtomic:swap.quotedOut.toString(),minimumOutAtomic:swap.amountOutMinimum.toString(),wallet:{balanceAtomic:(3n*10n**18n).toString(),allowanceAtomic:'0',bnbAtomic:'990000000000000'},approvalPreview:{simulation:'PASSED' as const,gas:'CHECKED' as const,gasBudgetAtomic:'3020000000000',reason:'Approval gas covered.'},gates:{...base.view.gates,spendingPermission:'BLOCKED' as const,simulation:'NOT_RUN' as const,gas:'UNKNOWN' as const}},transaction:{chainId:56 as const,from:owner as `0x${string}`,to:PANCAKE_V3.usdt,data,value:0n,tokenIn:PANCAKE_V3.usdt,tokenOut:PANCAKE_V3.spyOn,amountIn,amountOutMinimum:0n,deadline:BigInt(Math.floor(Date.now()/1000)+120)}};}
async function setup(){const ledger=new Ledger(embeddedDatabase());ledgers.push(ledger);await ledger.migrate();const app=createApp(process.cwd(),{ledger,directPreparer:async owner=>preparation(owner),directApprovalPreparer:async owner=>approvalPreparation(owner),directSettlementReader:async()=>({status:'success',blockNumber:'123',blockHash,confirmations:'12',observedAt:new Date().toISOString()})});return app;}
async function setupApprovalBuy(){const ledger=new Ledger(embeddedDatabase());ledgers.push(ledger);await ledger.migrate();const address=signer.address.toLowerCase(),checkpoint={accountId:capitalAccountId(address),wallet:address,asset:{chainId:56 as const,contract:PANCAKE_V3.usdt.toLowerCase(),decimals:18 as const},balanceAtomic:(3n*10n**18n).toString(),blockNumber:'123',blockHash,observedAt:new Date().toISOString(),positions:[],evidenceMode:'observed' as const};await ledger.applyCapitalCheckpoint(checkpoint);const state=await ledger.capitalState(checkpoint.accountId);await ledger.saveCapitalPolicy(checkpoint.accountId,{reserveFloor:'0',operatingBudget:'0',obligations:[]},state!.revision);return createApp(process.cwd(),{ledger,capitalReader:async()=>checkpoint,directApprovalPreparer:async owner=>approvalPreparationBuy(owner)});}

describe('direct execution API barrier',()=>{
 it('remains disabled unless explicitly configured',async()=>{
  delete process.env.MANDATE_DIRECT_EXECUTION_ENABLED;delete process.env.MANDATE_DIRECT_APPROVAL_ENABLED;delete process.env.MANDATE_DIRECT_PILOT_WALLETS;
  const app=await setup();try{const headers=await signed(app);const result=await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload:{direction:'SELL',sellAmountAtomic:'10000000000000000'}});expect(result.statusCode).toBe(409);expect(result.json().error).toBe('DIRECT_EXECUTION_DISABLED');expect((await app.inject({url:'/v1/routes/SPYon/attempts',headers})).json()).toMatchObject({items:[],executionEnabled:false,approvalEnabled:false});}finally{await app.close();}
 },20000);
 it('releases calldata only after the durable barrier and never re-begins an unknown send',async()=>{
  process.env.MANDATE_DIRECT_EXECUTION_ENABLED='true';process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';process.env.MANDATE_DIRECT_PILOT_WALLETS=signer.address;const app=await setup();try{
   const headers=await signed(app),payload={direction:'SELL',sellAmountAtomic:'10000000000000000'};
   const prepared=await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload});expect(prepared.statusCode).toBe(200);
   const id=prepared.json().attempt.id as string;expect(JSON.stringify(prepared.json())).not.toContain('414bf389');
   expect((await app.inject({url:'/v1/routes/SPYon/attempts',headers})).body).not.toContain('414bf389');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload})).json().error).toBe('DIRECT_ATTEMPT_PENDING');
   const begin=await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:id}});
   expect(begin.json().transaction).toMatchObject({chainId:56,from:signer.address.toLowerCase(),to:PANCAKE_V3.router.toLowerCase()});
   expect(begin.json().transaction.data).toContain('414bf389');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:id}})).json().error).toBe('DIRECT_ATTEMPT_ALREADY_BEGUN');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/abandon',headers,payload:{attemptId:id}})).json().error).toBe('DIRECT_ATTEMPT_ALREADY_BEGUN');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/reconcile',headers,payload:{attemptId:id}})).json().error).toBe('DIRECT_ATTEMPT_UNRESOLVED');
   const otherHeaders=await signed(app,other);expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/hash',headers:otherHeaders,payload:{attemptId:id,transactionHash:hash}})).json().error).toBe('DIRECT_ATTEMPT_NOT_FOUND');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/hash',headers,payload:{attemptId:id,transactionHash:hash}})).json().attempt.state).toBe('submitted');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/reconcile',headers,payload:{attemptId:id}})).json().attempt.state).toBe('confirmed');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload})).statusCode).toBe(200);
  }finally{await app.close();}
 },20000);
 it('journals an exact token approval separately from the later swap',async()=>{
  process.env.MANDATE_DIRECT_EXECUTION_ENABLED='true';process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';process.env.MANDATE_DIRECT_PILOT_WALLETS=signer.address;const app=await setup();try{
   const headers=await signed(app),payload={direction:'SELL',sellAmountAtomic:'10000000000000000'};
   const prepared=await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload});expect(prepared.statusCode).toBe(200);
   const id=prepared.json().attempt.id as string;expect(prepared.json().attempt.kind).toBe('approval');expect(JSON.stringify(prepared.json())).not.toContain('095ea7b3');
   const begin=await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:id}});expect(begin.json().transaction.data).toMatch(/^0x095ea7b3/);
   await app.inject({method:'POST',url:'/v1/routes/SPYon/hash',headers,payload:{attemptId:id,transactionHash:hash}});
   const reconciled=await app.inject({method:'POST',url:'/v1/routes/SPYon/reconcile',headers,payload:{attemptId:id}});expect(reconciled.json().attempt.state).toBe('confirmed');
   const swap=await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload});expect(swap.json().attempt.kind).toBe('swap');
  }finally{await app.close();}
 },20000);
 it('allows only the listed wallet into the approval-only stage and keeps swaps closed',async()=>{
  delete process.env.MANDATE_DIRECT_EXECUTION_ENABLED;process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';delete process.env.MANDATE_DIRECT_PILOT_WALLETS;
  const app=await setup();try{
   const headers=await signed(app),sell={direction:'SELL',sellAmountAtomic:'10000000000000000'};
   expect((await app.inject({url:'/v1/routes/SPYon/attempts',headers})).json()).toMatchObject({executionEnabled:false,approvalEnabled:false});
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload:sell})).json().error).toBe('DIRECT_APPROVAL_DISABLED');
   process.env.MANDATE_DIRECT_PILOT_WALLETS=signer.address+',not-an-address';
   expect((await app.inject({url:'/v1/routes/SPYon/attempts',headers})).json()).toMatchObject({executionEnabled:false,approvalEnabled:false});
   process.env.MANDATE_DIRECT_PILOT_WALLETS=signer.address;
   expect((await app.inject({url:'/v1/routes/SPYon/attempts',headers})).json()).toMatchObject({executionEnabled:false,approvalEnabled:true});
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload:sell})).json().error).toBe('DIRECT_EXECUTION_DISABLED');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload:sell})).json().error).toBe('DIRECT_APPROVAL_TRIAL_LIMIT');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload:{direction:'BUY',buyAmountAtomic:'2000000000000000000'}})).json().error).toBe('DIRECT_APPROVAL_TRIAL_LIMIT');
   const otherHeaders=await signed(app,other);
   expect((await app.inject({url:'/v1/routes/SPYon/attempts',headers:otherHeaders})).json()).toMatchObject({executionEnabled:false,approvalEnabled:false});
  }finally{await app.close();}
 },20000);
 it('prepares only an exact 1 USDT approval after saved cash protection is checked',async()=>{
  delete process.env.MANDATE_DIRECT_EXECUTION_ENABLED;process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';process.env.MANDATE_DIRECT_PILOT_WALLETS=signer.address;
  const app=await setupApprovalBuy();try{
   const headers=await signed(app),payload={direction:'BUY',buyAmountAtomic:'1000000000000000000'};
   const prepared=await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload});expect(prepared.statusCode).toBe(200);
   expect(prepared.json().attempt).toMatchObject({kind:'approval',direction:'BUY',amountInAtomic:payload.buyAmountAtomic});
   expect(JSON.stringify(prepared.json())).not.toContain('095ea7b3');
   delete process.env.MANDATE_DIRECT_APPROVAL_ENABLED;
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:prepared.json().attempt.id}})).json().error).toBe('DIRECT_APPROVAL_DISABLED');
   process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';
   const begin=await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:prepared.json().attempt.id}});
   expect(begin.statusCode).toBe(200);expect(begin.json().transaction).toMatchObject({to:PANCAKE_V3.usdt.toLowerCase(),from:signer.address.toLowerCase()});
   expect(begin.json().transaction.data).toMatch(/^0x095ea7b3/);
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload})).json().error).toBe('DIRECT_EXECUTION_DISABLED');
  }finally{await app.close();}
 },20000);
 it('refuses to begin a prepared swap after the swap stage is disabled',async()=>{
  process.env.MANDATE_DIRECT_EXECUTION_ENABLED='true';process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';process.env.MANDATE_DIRECT_PILOT_WALLETS=signer.address;
  const app=await setup();try{
   const headers=await signed(app),payload={direction:'SELL',sellAmountAtomic:'10000000000000000'};
   const prepared=await app.inject({method:'POST',url:'/v1/routes/SPYon/prepare',headers,payload});expect(prepared.statusCode).toBe(200);
   delete process.env.MANDATE_DIRECT_EXECUTION_ENABLED;
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/begin',headers,payload:{attemptId:prepared.json().attempt.id}})).json().error).toBe('DIRECT_EXECUTION_DISABLED');
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/abandon',headers,payload:{attemptId:prepared.json().attempt.id}})).statusCode).toBe(200);
  }finally{await app.close();}
 },20000);
});
