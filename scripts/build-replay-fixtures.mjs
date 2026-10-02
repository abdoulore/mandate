import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'research/evidence-manifest.json'),'utf8'));
const byFile=new Map(manifest.files.map(item=>[item.file,item]));
const hash=value=>createHash('sha256').update(value).digest('hex');

function recorded(file,line,metricClass,note){
 const frozen=byFile.get(file);if(!frozen)throw new Error(`No frozen manifest for ${file}`);
 const bytes=fs.readFileSync(path.join(root,'data',file));
 if(bytes.length<frozen.bytes||hash(bytes.subarray(0,frozen.bytes))!==frozen.sha256)throw new Error(`Frozen source prefix changed: ${file}`);
 const lines=bytes.subarray(0,frozen.bytes).toString('utf8').split(/\r?\n/);
 if(line<1||line>frozen.rows)throw new Error(`Line outside frozen source: ${file}:${line}`);
 const text=lines[line-1],row=JSON.parse(text);
 return {kind:'recorded_collector_row',at:row.ts,source:{file:`data/${file}`,line,fileBytes:frozen.bytes,fileSha256:frozen.sha256,lineSha256:hash(text)},metricClass,storedCollectorRow:row,note};
}

const limitsRecorded=[
 'The old collector saved derived metrics or summary fields, not the upstream raw quote/build response, wallet context, expiry, or fill.',
 'This is historical research evidence only. It cannot establish executable liquidity, eligibility, transaction meaning, or a counterfactual trade outcome.'
];
const limitsSynthetic=[
 'This incident is invented to exercise a control; it was not observed in the collector or on-chain.',
 'The replay cannot reach a signer, approval, submit endpoint, or live market source.'
];
const scenarios=[
 {schemaVersion:'1.0.0',id:'recorded-nvda-issuer-cost-divergence',title:'NVDA issuer cost divergence',kind:'recorded',capturedAt:'2026-09-20T11:06:45.960Z',question:'Two issuers reported different derived buy-cost metrics for the same ticker and nominal 1,000 USD size. Should a planner silently substitute one token for the other?',expectedControl:'Keep issuer and contract identity explicit; apply the saved representation allowlist and cost limit before a research proposal.',limitations:[...limitsRecorded,'The samples are about six seconds apart; their cost estimates are not directly executable quotes or proof of equivalent instrument accounting.'],executionEnabled:false,events:[
  recorded('cost-2026-09-20.jsonl',2,'derived_cost_metric','Ondo NVDA derived buy-cost metric for 1,000 USD.'),
  recorded('cost-2026-09-20.jsonl',8,'derived_cost_metric','Backed NVDA derived buy-cost metric for 1,000 USD.')
 ]},
 {schemaVersion:'1.0.0',id:'recorded-source-error-40367',title:'Collector source error during a closed-status observation',kind:'recorded',capturedAt:'2026-09-20T11:07:56.811Z',question:'What should research mode do when the collector recorded an error code and a false open flag?',expectedControl:'Represent source availability as unknown or blocked; do not infer a live quote, fill, or current market closure from the old row.',limitations:[...limitsRecorded,'The collector did not preserve the upstream error body or enough context to identify the precise meaning of error 40367.'],executionEnabled:false,events:[
  recorded('cost-2026-09-20.jsonl',91,'derived_cost_metric','SOXL buy-cost collection returned code 40367; no finite derived metric was saved.')
 ]},
 {schemaVersion:'1.0.0',id:'recorded-sweep-error-40374',title:'Catalogue sweep error',kind:'recorded',capturedAt:'2026-09-21T13:28:53.614Z',question:'How should a discovered instrument with a sweep error appear in research results?',expectedControl:'Keep discovery separate from market data and route certification; show error provenance and avoid a tradable claim.',limitations:[...limitsRecorded,'The sweep row has no raw upstream response or executable quote. Code 40374 alone does not prove a specific market condition.'],executionEnabled:false,events:[
  recorded('sweep-all-2026-09-21T13-28.jsonl',1,'collector_sweep_summary','MSTR was discovered but the sweep saved error code 40374.')
 ]},
 {schemaVersion:'1.0.0',id:'synthetic-quote-expiry',title:'Quote expires before authorization',kind:'synthetic',capturedAt:'2026-09-28T00:00:30.000Z',question:'Can an expired research quote become a transaction?',expectedControl:'Block preparation and require a fresh quote, route check, simulation, and authorization.',limitations:limitsSynthetic,executionEnabled:false,events:[
  {kind:'synthetic_failure',at:'2026-09-28T00:00:30.000Z',failure:'quote_expired',injectedState:{quoteAgeSeconds:31,quoteTtlSeconds:30,authorizationGranted:false},note:'Synthetic 30-second TTL crossed without an authorized transaction.'}
 ]},
 {schemaVersion:'1.0.0',id:'synthetic-source-timeout',title:'Source times out during revalidation',kind:'synthetic',capturedAt:'2026-09-28T00:00:00.000Z',question:'Does an older observation authorize a new proposal when a fresh read times out?',expectedControl:'Defer the proposal and preserve the prior record as historical evidence.',limitations:limitsSynthetic,executionEnabled:false,events:[
  {kind:'synthetic_failure',at:'2026-09-28T00:00:00.000Z',failure:'source_timeout',injectedState:{freshReadSucceeded:false,lastKnownAgeSeconds:600},note:'Synthetic fresh market source timeout; last-known value remains historical.'}
 ]},
 {schemaVersion:'1.0.0',id:'synthetic-ambiguous-submission',title:'Submission response lost after dispatch',kind:'synthetic',capturedAt:'2026-09-28T00:00:00.000Z',question:'May a worker retry a transaction when submission outcome is unknown?',expectedControl:'Hold the reservation and reconcile by durable attempt identifiers before any new submission.',limitations:limitsSynthetic,executionEnabled:false,events:[
  {kind:'synthetic_failure',at:'2026-09-28T00:00:00.000Z',failure:'ambiguous_submission',injectedState:{submissionAttempted:true,responseReceived:false,transactionHash:null},note:'Synthetic network interruption after dispatch; no on-chain outcome is asserted.'}
 ]},
 {schemaVersion:'1.0.0',id:'synthetic-partial-settlement',title:'Partial settlement is not a complete fill',kind:'synthetic',capturedAt:'2026-09-28T00:00:00.000Z',question:'How should reserved cash be treated when a modeled order settles only partly?',expectedControl:'Reconcile actual debits before releasing unused reservation; do not report the target quantity as filled.',limitations:limitsSynthetic,executionEnabled:false,events:[
  {kind:'synthetic_failure',at:'2026-09-28T00:00:00.000Z',failure:'partial_settlement',injectedState:{requestedAtomic:'10000000000000000000',confirmedDebitAtomic:'4000000000000000000',settlementConfirmed:false},note:'Synthetic partial debit amounts; not a real chain receipt.'}
 ]}
];
const target=path.join(root,'packages/evidence/src/replay-scenarios.json');
const output=JSON.stringify(scenarios,null,2)+'\n';
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw new Error('Replay fixtures are stale; run node scripts/build-replay-fixtures.mjs');console.log('Replay fixtures match frozen collector lines.');}
else{fs.writeFileSync(target,output);console.log(`Wrote ${scenarios.length} replay scenarios to ${path.relative(root,target)}.`);}
