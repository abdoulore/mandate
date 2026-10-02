import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {Ledger,embeddedDatabase} from '@mandate/store';

// No wallet keys, API calls or real tokens. This is a local persistence demonstration.
await mkdir('.runtime',{recursive:true});
const path=resolve('.runtime/ledger-demo');
const runId=randomUUID();const planId=randomUUID();const createdAt=new Date().toISOString();
const asset={chainId:56,contract:'0x'+'1'.repeat(40),decimals:18};
let ledger=new Ledger(embeddedDatabase(path));
try {
 await ledger.migrate();
 await ledger.createAccount({schemaVersion:'1.0.0',id:runId,createdAt,wallet:'0x'+'2'.repeat(40),asset,balanceAtomic:'4000000000000000000000',protectedAtomic:'1220000000000000000000',revision:0,observedAt:createdAt,evidenceMode:'synthetic'});
 await ledger.savePlan({schemaVersion:'1.0.0',id:planId,accountId:runId,createdAt,revision:1,accountRevision:0,decisionId:'synthetic-demo',inputHash:'a'.repeat(64),maximumDebit:{asset,atomic:'2000000000000000000000'},evidenceMode:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()});
 const reservation=await ledger.reserve({accountId:runId,planRevisionId:planId,idempotencyKey:runId,amountAtomic:'2000000000000000000000'});
 await ledger.beginSubmission(reservation.id,runId);
 await ledger.close();ledger=new Ledger(embeddedDatabase(path));await ledger.migrate();
 const recovered=await ledger.snapshot(runId);
 const maySubmitAgain=await ledger.beginSubmission(reservation.id,runId);
 await ledger.reconcile({schemaVersion:'1.0.0',id:randomUUID(),createdAt,reservationId:reservation.id,transactionHash:'0x'+'3'.repeat(64),blockNumber:'1',debitedAtomic:'1900000000000000000000',observedAt:createdAt,evidenceMode:'synthetic'});
 let acknowledged=0;
 // Demonstration consumer only: no external side effects or execution.
 while(true){const event=await ledger.claimEvent();if(!event)break;await ledger.acknowledgeEvent(event.id,event.token);acknowledged++;}
 console.log(JSON.stringify({mode:'synthetic',database:path,runId,recoveredHold:recovered.heldAtomic,maySubmitAgain,final:await ledger.snapshot(runId),acknowledgedEvents:acknowledged},null,2));
}finally{await ledger.close();}
