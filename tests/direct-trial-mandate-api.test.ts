import {describe,expect,it} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {Ledger,embeddedDatabase} from '@mandate/store';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';

const signer=privateKeyToAccount('0x'+'45'.repeat(32) as `0x${string}`);
const wallet=signer.address.toLowerCase(),accountId=capitalAccountId(wallet);

describe('separate SPYon trial mandate API',()=>{
 it('saves versioned trial rules for the signed allowlisted wallet without changing the portfolio mandate',async()=>{
  const prior={wallets:process.env.MANDATE_DIRECT_PILOT_WALLETS,plan:process.env.MANDATE_PLAN_DIRECT_ENABLED,approval:process.env.MANDATE_DIRECT_APPROVAL_ENABLED};
  const ledger=new Ledger(embeddedDatabase());await ledger.migrate();
  await ledger.applyCapitalCheckpoint({accountId,wallet,asset:{chainId:56,contract:PANCAKE_V3.usdt.toLowerCase(),decimals:18},balanceAtomic:'3000000000000000000',blockNumber:'100',blockHash:'0x'+'5'.repeat(64),observedAt:new Date().toISOString(),positions:passportDefinitions().map(p=>({contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1' as const,state:'OBSERVED' as const})),evidenceMode:'observed'});
  const main=await ledger.saveInvestmentMandate(accountId,{allocations:[{underlying:'SPY',weightBps:4000},{underlying:'NVDA',weightBps:3500},{underlying:'SGOV',weightBps:2500}],maxIssuerBps:7000,maxCostBps:30,allowLeveraged:false,representationAllowlist:[PANCAKE_V3.spyOn.toLowerCase()],exposureScope:'tracked-holdings-pending-proposed'},0);
  const app=createApp(process.cwd(),{ledger,recurringTickMs:null});
  try{
   process.env.MANDATE_DIRECT_PILOT_WALLETS=wallet;
   const origin='http://127.0.0.1:3110',path='/v1/routes/SPYon/trial-mandate';
   expect((await app.inject({method:'GET',url:path,headers:{origin}})).statusCode).toBe(401);
   const challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:signer.address,chainId:56}})).json();
   const signature=await signer.signMessage({message:challenge.message});
   const verified=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature}});
   const headers={origin,cookie:String(verified.headers['set-cookie']).split(';')[0]};
   expect((await app.inject({method:'GET',url:path,headers})).json()).toMatchObject({trial:null,portfolio:{revision:1,allocations:main.policy.allocations}});
   process.env.MANDATE_PLAN_DIRECT_ENABLED='true';process.env.MANDATE_DIRECT_APPROVAL_ENABLED='true';
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/approval/prepare',headers,payload:{direction:'BUY',buyAmountAtomic:'500000000000000000'}})).json().error).toBe('PLAN_DIRECT_TRIAL_MANDATE_REQUIRED');
   expect((await app.inject({method:'POST',url:path,headers,payload:{maxCostBps:201,expectedRevision:0}})).statusCode).toBe(400);
   const saved=await app.inject({method:'POST',url:path,headers,payload:{maxCostBps:100,expectedRevision:0}});
   expect(saved.statusCode).toBe(200);
   expect(saved.json().trial).toMatchObject({revision:1,policy:{allocations:[{underlying:'SPY',weightBps:10000}],maxCostBps:100,representationAllowlist:[PANCAKE_V3.spyOn.toLowerCase()]}});
   expect((await ledger.investmentMandates(accountId))[0]).toEqual(main);
   expect((await app.inject({method:'POST',url:path,headers,payload:{maxCostBps:120,expectedRevision:0}})).json().error).toBe('STALE_DIRECT_TRIAL_MANDATE');
   const updated=await app.inject({method:'POST',url:path,headers,payload:{maxCostBps:120,expectedRevision:1}});
   expect(updated.json().trial).toMatchObject({revision:2,policy:{maxCostBps:120}});
   expect((await ledger.investmentMandates(accountId))[0]).toEqual(main);
  }finally{
   for(const [key,value] of [['MANDATE_DIRECT_PILOT_WALLETS',prior.wallets],['MANDATE_PLAN_DIRECT_ENABLED',prior.plan],['MANDATE_DIRECT_APPROVAL_ENABLED',prior.approval]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
   await app.close();await ledger.close();
  }
 },60000);
});
