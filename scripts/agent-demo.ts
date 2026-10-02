// Synthetic, in-memory AGT-02 demonstration. No user wallet, live RPC or transaction endpoint.
import {randomUUID} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {Ledger,embeddedDatabase} from '@mandate/store';
import {MandateAgentClient,createHttpTransport} from '@mandate/agent';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import type {CapitalCheckpoint} from '@mandate/domain';

const signer=privateKeyToAccount(generatePrivateKey()),wallet=signer.address.toLowerCase(),ledger=new Ledger(embeddedDatabase()),definitions=passportDefinitions(),origin='http://127.0.0.1:3110';
await ledger.migrate();
const checkpoint=():CapitalCheckpoint=>({accountId:capitalAccountId(wallet),wallet,asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:(100n*10n**18n).toString(),blockNumber:'100',blockHash:'0x'+'a'.repeat(64),observedAt:new Date().toISOString(),evidenceMode:'observed',positions:definitions.map(d=>({contract:d.contract,symbol:d.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1',state:'OBSERVED'}))});
await ledger.applyCapitalCheckpoint(checkpoint());
await ledger.saveCapitalPolicy(capitalAccountId(wallet),{reserveFloor:'20',operatingBudget:'0',obligations:[]},1);
await ledger.saveInvestmentMandate(capitalAccountId(wallet),{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:30,allowLeveraged:false,representationAllowlist:definitions.map(d=>d.contract),exposureScope:'tracked-holdings-pending-proposed'},0);
const app=createApp(process.cwd(),{ledger,recurringTickMs:null,capitalReader:async()=>checkpoint(),marketReader:async()=>({source:'synthetic agent demo',observedAt:new Date().toISOString(),items:[]})});
try{
 const base=await app.listen({host:'127.0.0.1',port:0});
 const agent=new MandateAgentClient({origin,signer,transport:createHttpTransport(base),grants:['capital.get','mandate.get','proposal.create','proposal.list','recurring.create','recurring.list','recurring.pause','recurring.revoke']});
 await agent.signIn();
 const capital=await agent.capital(),mandate=await agent.mandates();
 if(capital.state!=='OBSERVED'||!mandate.latest)throw new Error('Synthetic capital or mandate missing');
 const requestId=randomUUID(),proposal=await agent.createProposal({mandateRevision:mandate.latest.revision,scenario:'normal',requestId});
 const replay=await agent.createProposal({mandateRevision:mandate.latest.revision,scenario:'normal',requestId});
 if(proposal.id!==replay.id||proposal.result.executable!==false||(await ledger.snapshot(capital.accountId)).heldAtomic!=='0')throw new Error('Agent research invariants failed');
 const schedule=await agent.createRecurring({requestId:randomUUID(),intervalSeconds:60,scenario:'normal'}),tick=await app.runRecurringDue();
 const recurrent=(await agent.recurring()).firings.find(f=>f.scheduleId===schedule.id);
 if(tick.proposed!==1||recurrent?.state!=='proposed')throw new Error('Recurring research did not persist');
 const current=(await agent.recurring()).schedules.find(s=>s.id===schedule.id)!;
 const paused=await agent.pauseRecurring({scheduleId:schedule.id,expectedRevision:current.revision});
 const revoked=await agent.revokeRecurring({scheduleId:schedule.id,expectedRevision:paused.revision});
 if(revoked.status!=='revoked'||(await ledger.snapshot(capital.accountId)).heldAtomic!=='0')throw new Error('Recurring authority or cash invariant failed');
 console.log(JSON.stringify({mode:'synthetic local API',wallet:'ephemeral test signer',capitalState:capital.state,savedMandateRevision:mandate.latest.revision,proposalId:proposal.id,decisionId:proposal.result.decisionId,proposalStatus:proposal.result.status,replaySameRecord:true,recurringFiring:recurrent.state,recurringRevoked:true,holdsCreated:false,executionEnabled:false}));
}finally{await app.close();await ledger.close();}
