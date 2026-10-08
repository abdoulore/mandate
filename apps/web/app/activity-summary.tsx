'use client';
import {useEffect,useState} from 'react';

type Attempt={id:string;direction:'BUY'|'SELL';kind:'approval'|'swap';state:string;transactionHash:string|null;settlement?:{blockNumber:string;confirmations:number;spentAtomic?:string;receivedAtomic?:string;gasCostWei?:string}|null};
type Response={items:Attempt[]};
const short=(value:string)=>value.slice(0,10)+'…'+value.slice(-6);

export default function ActivitySummary(){
 const [items,setItems]=useState<Attempt[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();void fetch('/api/v1/routes/SPYon/attempts',{signal:controller.signal,credentials:'same-origin',cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Wallet request history is unavailable.');return response.json() as Promise<Response>;}).then(value=>setItems(value.items??[])).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[]);
 return <section className="activity-wallet" aria-label="SPYon wallet requests"><div className="activity-wallet-heading"><div><p className="eyebrow">WALLET REQUESTS</p><h2>SPYon approvals and swaps</h2><p>Confirmed activity is linked to BNB Chain receipts. An unknown result stays unresolved until checked.</p></div><a href="/plan/SPYon#wallet-requests">Open request controls →</a></div>
 {loading?<p role="status">Loading wallet requests…</p>:error?<p role="alert">{error}</p>:items.length===0?<p>No SPYon wallet requests recorded for this connected wallet.</p>:<div className="activity-wallet-list">{items.slice(0,12).map(item=><article key={item.id}><div><strong>{item.direction==='BUY'?'Buy':'Sell'} · {item.kind==='approval'?'spending approval':'swap'}</strong><span className={item.state==='confirmed'?'confirmed':item.state.includes('unknown')?'unknown':''}>{item.state.replaceAll('_',' ')}</span></div>{item.transactionHash?<p><a href={`https://bscscan.com/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">{short(item.transactionHash)} ↗</a>{item.settlement?` · block #${item.settlement.blockNumber} · ${item.settlement.confirmations} confirmations`:''}</p>:<p>{item.state.includes('unknown')?'Result unknown. Do not repeat this request.':'No transaction hash recorded.'}</p>}</article>)}</div>}
 </section>;
}
