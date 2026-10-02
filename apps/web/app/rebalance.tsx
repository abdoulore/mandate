'use client';
import {useEffect,useRef,useState} from 'react';
import type {ResearchRebalance,SavedInvestmentMandate,MandateInput} from '@mandate/domain';
function units(value:string,decimals=18){const n=BigInt(value),scale=10n**BigInt(decimals),fraction=(n%scale).toString().padStart(decimals,'0').slice(0,6).replace(/0+$/,'');return (n/scale).toLocaleString('en-US')+(fraction?'.'+fraction:'');}
const percent=(bps:number|null)=>bps===null?'Unknown':(bps/100).toFixed(2)+'%';
export default function RebalancePanel({saved,scenario,fresh,dirty,busy,request,run}:{saved:SavedInvestmentMandate|null;scenario:MandateInput['scenario'];fresh:boolean;dirty:boolean;busy:boolean;request:(url:string,body?:unknown)=>Promise<any>;run:(action:()=>Promise<void>)=>Promise<void>}){
 const [cash,setCash]=useState(false),[records,setRecords]=useState<ResearchRebalance[]>([]),[selected,setSelected]=useState<string|null>(null),[loadError,setLoadError]=useState('');
 const retry=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{let active=true;void request('/rebalances').then(v=>{if(active)setRecords(v.items);}).catch(e=>{if(active)setLoadError(e.message);});return()=>{active=false;};},[]);
 async function preview(){const key=JSON.stringify({revision:saved!.revision,scenario,cash}),requestId=retry.current?.key===key?retry.current.id:crypto.randomUUID();retry.current={key,id:requestId};const value=await request('/rebalances',{mandateRevision:saved!.revision,scenario,useAvailableCash:cash,requestId});setRecords(previous=>[value.rebalance,...previous.filter(r=>r.id!==value.rebalance.id)].slice(0,20));setSelected(value.rebalance.id);setLoadError('');retry.current=null;}
 return <section className="capital-rebalance" aria-label="Target drift and rebalance">
  <span className="eyebrow">TARGETS → MODELED CHANGES</span><h3>Target drift and rebalance</h3>
  <p>Compare held and pending investments with your saved targets. Model sales, purchases and costs while keeping cash protections intact.</p>
  <label className="checkbox"><input type="checkbox" checked={cash} disabled={busy} onChange={e=>setCash(e.target.checked)}/>Include available cash in the rebalance</label>
  <p className="footnote">Unchecked: rebalance existing exposure using modeled sale proceeds. Checked: also contribute wallet cash above protections and pending holds. Pending positions count toward targets and cannot be sold.</p>
  <button type="button" className="text-button" disabled={busy||!fresh||dirty||!saved} onClick={()=>void run(preview)}>Preview rebalance</button>
  {!saved||dirty?<p className="footnote">Save cash and investment rules before modeling.</p>:!fresh?<p className="footnote">Refresh capital before creating a new model.</p>:null}
  {loadError&&<p role="alert" className="wallet-error">{loadError}</p>}
  <p className="footnote">Last 20 saved rebalance models. Recorded estimates remain readable after observations expire; they grant no trading permission.</p>
  {!records.length&&<p>No recorded rebalance models.</p>}
  {records.map(record=>{const r=record.result;return <details key={record.id} data-rebalance-id={record.id} open={selected===record.id}>
   <summary>{r.status==='feasible'?'Rebalance model fits':r.status==='unchanged'?'No changes needed':'Rebalance blocked'} · mandate {record.mandateRevision} · {new Date(record.createdAt).toLocaleString()}</summary>
   <p>Recorded research · block #{record.inputs.checkpoint.blockNumber} · {record.scenario} synthetic costs · {record.useAvailableCash?'available cash included':'sale-funded changes only'}</p>
   <div className="table-wrap"><table><thead><tr><th>Underlying</th><th>Held + pending · USD</th><th>Current</th><th>Target</th><th>Drift</th><th>Modeled after</th></tr></thead><tbody>{r.drift.map(d=><tr key={d.underlying}><td>{d.underlying}</td><td>{units(d.heldAtomic)} + {units(d.pendingAtomic)}</td><td>{percent(d.currentWeightBps)}</td><td>{percent(d.targetWeightBps)}</td><td>{d.driftBps===null?'Unknown':(d.driftBps>0?'+':'')+(d.driftBps/100).toFixed(2)+' pp'}</td><td>{percent(d.afterWeightBps)}</td></tr>)}</tbody></table></div>
   {r.status!=='blocked'&&<div className="capital-metrics"><div><span>Modeled fees · USDT</span><strong>{units(r.feeAtomic)}</strong></div><div><span>Two-sided turnover · USD</span><strong>{units(r.turnoverAtomic)}</strong></div><div><span>Wallet cash contributed · USDT</span><strong>{units(r.cashUsedAtomic)}</strong></div><div><span>Projected wallet cash · USDT</span><strong>{r.projectedCashAtomic===null?'Unknown':units(r.projectedCashAtomic)}</strong></div></div>}
   <p>Protected cash: {units(r.protectedCashAtomic)} USDT · Pending holds: {units(r.heldCashAtomic)} USDT · Available cash: {units(r.availableCashAtomic)} USDT.</p>
   {r.legs.length>0&&<><h4>Modeled trade sequence</h4>{(['SELL','BUY'] as const).map(side=><div key={side} className="rebalance-stage"><h4>{side==='SELL'?'1. Sales · estimated proceeds':'2. Purchases · estimated spend'}</h4>{r.legs.filter(l=>l.side===side).map(l=><div key={l.instrumentId}><p><strong>{side==='SELL'?'Sell':'Buy'} {units(l.quantityAtomic,l.tokenDecimals)} raw {l.symbol}</strong> · {l.issuer}</p><p>{units(l.cashAtomic)} USDT {side==='SELL'?'net proceeds':'total spend'} · fee {units(l.feeAtomic)} USDT · {l.costBps} bps</p><p className="footnote">{l.funding==='requires-sale-settlement'?'Wait for sales to settle and refresh wallet cash before considering this purchase.':l.funding==='modeled-sale-proceeds'?'Proceeds are an estimate and are not yet available in the wallet.':'Modeled against available wallet cash.'}</p></div>)}</div>)}</>}
   {r.issuerExposure.length>0&&<><h4>Modeled issuer shares</h4>{r.issuerExposure.map(e=><p key={e.issuer}>{e.issuer}: {percent(e.shareBps)}</p>)}</>}
   {r.reasons.map((reason,n)=><p key={n}>{reason}</p>)}
   <p className="footnote">Values above are displayed to six decimals. Raw units, marks, costs and rules are retained at full precision below. Eligibility, executable quotes, simulation and transaction authorization are still required before trading. No cash is reserved or transaction requested.</p>
   <details><summary>Inspect recorded rebalance snapshot</summary><pre>{JSON.stringify(record,null,2)}</pre></details>
  </details>;})}
 </section>;
}
