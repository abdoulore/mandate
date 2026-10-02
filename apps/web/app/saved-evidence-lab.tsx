'use client';

import {useEffect,useState} from 'react';
import type {CapitalCheckpoint,InflowRecord,ResearchCashRaising,ResearchProposal,ResearchRebalance} from '@mandate/domain';
import './saved-evidence-lab.css';

type InflowHistoryItem={record:InflowRecord;proposalId:string|null};
type EvidenceItem=
 | {kind:'proposal';id:string;at:string;record:ResearchProposal}
 | {kind:'rebalance';id:string;at:string;record:ResearchRebalance}
 | {kind:'cash';id:string;at:string;record:ResearchCashRaising}
 | {kind:'inflow';id:string;at:string;record:InflowRecord;proposalId:string|null}
 | {kind:'checkpoint';id:string;at:string;record:CapitalCheckpoint};
type Group='all'|'decisions'|'receipts'|'checkpoints';
const sources=[
 {path:'proposals',label:'research proposals'},
 {path:'rebalances',label:'rebalance models'},
 {path:'cash-raising',label:'cash-target models'},
 {path:'inflows',label:'incoming transfer reviews'},
 {path:'history',label:'wallet checkpoints'},
] as const;

function short(value:string){return value.length>22?value.slice(0,10)+'…'+value.slice(-8):value;}
function date(value:string){const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleString():value;}
function units(value:string,decimals=18){try{const n=BigInt(value),scale=10n**BigInt(decimals),fraction=(n%scale).toString().padStart(decimals,'0').slice(0,6).replace(/0+$/,'');return (n/scale).toLocaleString('en-US')+(fraction?'.'+fraction:'');}catch{return 'Unknown';}}
function groupOf(item:EvidenceItem):Group{return item.kind==='inflow'?'receipts':item.kind==='checkpoint'?'checkpoints':'decisions';}
function title(item:EvidenceItem){switch(item.kind){case 'proposal':return 'Investment proposal';case 'rebalance':return 'Rebalance model';case 'cash':return 'Cash-target model';case 'inflow':return 'Incoming USDT receipt review';case 'checkpoint':return 'Wallet checkpoint';}}
function detail(item:EvidenceItem){switch(item.kind){case 'proposal':return item.record.result.status==='feasible'?'Model fit':'No allocation';case 'rebalance':return item.record.result.status==='feasible'?'Model fit':item.record.result.status==='unchanged'?'No changes needed':'Model blocked';case 'cash':return item.record.result.status==='feasible'?'Target covered':item.record.result.status==='shortfall'?'Shortfall':'Model blocked';case 'inflow':return item.record.classification.kind+' · '+units(item.record.classification.netAtomic)+' USDT';case 'checkpoint':return 'Block #'+item.record.blockNumber;}}
function buildItems(values:PromiseSettledResult<unknown>[]):EvidenceItem[]{
 const items:EvidenceItem[]=[];
 if(values[0].status==='fulfilled')for(const record of (values[0].value as {items:ResearchProposal[]}).items)items.push({kind:'proposal',id:record.id,at:record.createdAt,record});
 if(values[1].status==='fulfilled')for(const record of (values[1].value as {items:ResearchRebalance[]}).items)items.push({kind:'rebalance',id:record.id,at:record.createdAt,record});
 if(values[2].status==='fulfilled')for(const record of (values[2].value as {items:ResearchCashRaising[]}).items)items.push({kind:'cash',id:record.id,at:record.createdAt,record});
 if(values[3].status==='fulfilled')for(const {record,proposalId} of (values[3].value as {items:InflowHistoryItem[]}).items)items.push({kind:'inflow',id:record.id,at:record.createdAt,record,proposalId});
 if(values[4].status==='fulfilled')for(const {id,record} of (values[4].value as {items:{id:string;record:CapitalCheckpoint}[]}).items)items.push({kind:'checkpoint',id,at:record.observedAt,record});
 return items.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}

export default function SavedEvidenceLab({wallet}:{wallet:string|null}){
 const [items,setItems]=useState<EvidenceItem[]>([]),[group,setGroup]=useState<Group>('all'),[selected,setSelected]=useState<string|null>(null),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[errors,setErrors]=useState<string[]>([]),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!wallet){setItems([]);setSelected(null);setErrors([]);setLoaded(false);return;}
  let active=true;const controller=new AbortController();setLoading(true);
  const read=async(path:string)=>{const response=await fetch('/api/v1/capital/'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);return response.json() as Promise<unknown>;};
  void Promise.allSettled(sources.map(source=>read(source.path))).then(values=>{
   if(!active)return;
   const next=buildItems(values);setItems(next);setSelected(previous=>next.some(item=>item.kind+':'+item.id===previous)?previous:next[0]?next[0].kind+':'+next[0].id:null);
   setErrors(values.flatMap((value,index)=>value.status==='rejected'?[sources[index].label]:[]));setLoaded(true);setLoading(false);
  });
  return()=>{active=false;controller.abort();};
 },[wallet,revision]);
 const visible=items.filter(item=>group==='all'||groupOf(item)===group),current=visible.find(item=>item.kind+':'+item.id===selected)??visible[0];
 const choose=(next:Group)=>{setGroup(next);const first=items.find(item=>next==='all'||groupOf(item)===next);setSelected(first?first.kind+':'+first.id:null);};
 return <section className="panel saved-evidence-lab" aria-label="Saved wallet evidence and receipt inspection">
  <div className="panel-title"><div><h2>Saved decisions and receipt proofs</h2><p>Inspect this wallet’s persisted research decisions, incoming-transfer reviews and chain checkpoints. A saved observation is a historical snapshot, not a live quote.</p></div>{wallet&&<button type="button" className="text-button" disabled={loading} onClick={()=>setRevision(value=>value+1)}>{loading?'Loading…':'Refresh records'}</button>}</div>
  <div className="saved-evidence-legend"><span>Recorded wallet observations</span><span>Synthetic model costs</span><span>Research only · no executed trade</span></div>
  {!wallet?<p className="saved-evidence-empty">Connect an EVM wallet to inspect its private saved records. The recorded collector and synthetic failure cases above remain available without a wallet.</p>:<>
   {errors.length>0&&<p role="status" className="wallet-error">Could not load {errors.join(', ')}. Other available records are shown; refresh or reconnect to retry.</p>}
   <div className="saved-evidence-filters" aria-label="Saved evidence category">{([['all','All records'],['decisions','Decisions'],['receipts','Incoming receipts'],['checkpoints','Wallet checkpoints']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={group===value} onClick={()=>choose(value)}>{label}</button>)}</div>
   {loading&&!loaded?<p role="status">Loading saved wallet records…</p>:!visible.length?<p className="saved-evidence-empty">{loading?'Refreshing saved records…':group==='all'?'No saved records for this wallet yet. Create a research proposal or refresh capital to record an observation.':'No '+(group==='receipts'?'incoming receipt reviews':group==='checkpoints'?'wallet checkpoints':'research decisions')+' saved for this wallet.'}</p>:<div className="saved-evidence-layout">
    <div className="saved-evidence-list" aria-label="Saved records">{visible.map(item=><button type="button" key={item.kind+':'+item.id} aria-pressed={current?.kind===item.kind&&current.id===item.id} onClick={()=>setSelected(item.kind+':'+item.id)}><span>{title(item)}</span><strong>{detail(item)}</strong><small>{date(item.at)}</small></button>)}</div>
    {current&&<div className="saved-evidence-detail" aria-live="polite"><span className="eyebrow">{current.kind==='inflow'?'RECORDED CHAIN PROOF + HUMAN SOURCE REVIEW':current.kind==='checkpoint'?'RECORDED CHAIN OBSERVATION':'SAVED RESEARCH DECISION'}</span><h3>{title(current)}</h3><p className="saved-evidence-meta">Recorded {date(current.at)} · ID {short(current.id)}</p>
     {current.kind==='proposal'&&<><p><strong>Decision:</strong> {current.record.result.status==='feasible'?'The saved model fit its recorded rules.':'The saved model made no allocation.'} {current.record.result.legs.length} modeled leg{current.record.result.legs.length===1?'':'s'}.</p><p><strong>Inputs:</strong> mandate revision {current.record.mandateRevision}; wallet block #{current.record.inputs.checkpoint.blockNumber}; {current.record.scenario} synthetic route costs; market source {current.record.inputs.marks.source}.</p><p><strong>Cash:</strong> {units(current.record.inputs.funding.balanceAtomic)} USDT observed, {units(current.record.inputs.funding.protectedAtomic)} USDT protected, {units(current.record.inputs.funding.heldAtomic)} USDT held.</p>{current.record.inflow&&<p><strong>Linked incoming proof:</strong> {short(current.record.inflow.transactionHash)} · review {current.record.inflow.reviewRevision} · cap {units(current.record.inflow.budgetCapAtomic)} USDT.</p>}{current.record.result.reasons.map((reason,index)=><p key={index} className="saved-evidence-reason">{reason}</p>)}</>}
     {current.kind==='rebalance'&&<><p><strong>Decision:</strong> {detail(current)} · {current.record.result.legs.length} modeled trade leg{current.record.result.legs.length===1?'':'s'}.</p><p><strong>Inputs:</strong> mandate revision {current.record.mandateRevision}; wallet block #{current.record.inputs.checkpoint.blockNumber}; {current.record.scenario} synthetic costs.</p>{current.record.result.reasons.map((reason,index)=><p key={index} className="saved-evidence-reason">{reason}</p>)}</>}
     {current.kind==='cash'&&<><p><strong>Decision:</strong> {detail(current)} for a {current.record.target} USDT cash target; {current.record.result.legs.length} modeled sale{current.record.result.legs.length===1?'':'s'}.</p><p><strong>Inputs:</strong> mandate revision {current.record.mandateRevision}; wallet block #{current.record.inputs.checkpoint.blockNumber}; {current.record.scenario} synthetic costs.</p>{current.record.result.reasons.map((reason,index)=><p key={index} className="saved-evidence-reason">{reason}</p>)}</>}
     {current.kind==='inflow'&&<><p><strong>Chain proof:</strong> BNB Smart Chain block #{current.record.proof.blockNumber}; {current.record.classification.confirmations} confirmations at the check. Successful transfer and canonical block were checked when recorded; final settlement is not established.</p><p><strong>Review:</strong> {current.record.classification.kind} · {units(current.record.classification.netAtomic)} USDT net · source review revision {current.record.revision}. The source label is a user/application review, not independent proof of income.</p><p><strong>Transaction:</strong> <a href={'https://bscscan.com/tx/'+current.record.proof.transactionHash} target="_blank" rel="noreferrer">{short(current.record.proof.transactionHash)} ↗</a></p><p><strong>Linked initial research proposal:</strong> {current.proposalId?short(current.proposalId):'None recorded'}</p>{current.record.classification.reasons.map((reason,index)=><p key={index} className="saved-evidence-reason">{reason}</p>)}</>}
     {current.kind==='checkpoint'&&<><p><strong>Observed block:</strong> #{current.record.blockNumber} · {short(current.record.blockHash)}.</p><p><strong>USDT balance:</strong> {units(current.record.balanceAtomic)} USDT · {current.record.positions.length} tracked token read{current.record.positions.length===1?'':'s'}.</p><p>This is the wallet balance observed at the saved block. It is not current spendable cash or proof of trade settlement.</p></>}
     <p className="footnote">{current.kind==='inflow'?'This is an incoming-transfer proof, not a Mandate trade-execution receipt. No execution receipt is available in this view.':'This snapshot does not authorize, submit or prove a trade. Execution receipts are not available in this view.'}</p>
     <details><summary>Inspect complete saved record</summary><pre>{JSON.stringify(current.record,null,2)}</pre></details>
    </div>}
   </div>}
  </>}
 </section>;
}
