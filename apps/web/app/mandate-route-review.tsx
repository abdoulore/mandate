'use client';
import {useState} from 'react';

type Review={state:'POLICY_CHECKED'|'BLOCKED';executionAllowed:false;mandateRevision:number|null;cashPolicyRevision:number;routeBlockNumber:string;requestedAtomic:string;worstCaseCostBps:string|null;reasons:string[]};
const descriptions:Record<string,string>={SAVED_MANDATE_REQUIRED:'Save investment rules first.',FRESH_PROTECTED_CAPITAL_REQUIRED:'Refresh wallet cash and save cash rules.',PORTFOLIO_EXPOSURE_UNKNOWN:'Tracked holdings or pending plans could not be valued.',PROTECTED_CASH_INSUFFICIENT:'This amount would use cash set aside by your rules.',REPRESENTATION_NOT_ALLOWED:'Select SPYon under token versions to consider, then save.',SPY_NOT_IN_ALLOCATION:'Add SPY to your target allocation, then save.',MANDATE_COST_LIMIT:'The worst-case route cost exceeds your saved limit.',ALLOCATION_LIMIT:'This buy would exceed the saved SPY target.',ISSUER_LIMIT:'This buy would exceed the saved Ondo issuer cap.',ROUTE_CHECK_STALE:'The route check expired. Check again.',REFERENCE_COST_UNKNOWN:'The reference price or minimum output could not be checked.'};
function atomic(input:string){
 if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(input))throw new Error('Enter an amount with at most 18 decimal places.');
 const [whole,fraction='']=input.split('.'),value=BigInt(whole)*10n**18n+BigInt((fraction+'0'.repeat(18)).slice(0,18));
 if(value<=0n||value>10n*10n**18n)throw new Error('Choose more than 0 and at most 10 USDT.');
 return value.toString();
}
export default function MandateRouteReview({ready}:{ready:boolean}){
 const [amount,setAmount]=useState('1'),[review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function check(){setBusy(true);setError('');setReview(null);try{
  const response=await fetch('/api/v1/routes/SPYon/mandate-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buyAmountAtomic:atomic(amount)}),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error==='CAPITAL_READ_UNAVAILABLE'?'Wallet or chain data could not be refreshed. Try again.':data.error==='MANDATE_ROUTE_REVIEW_UNAVAILABLE'?'The route or reference price is unavailable. Try again.':'Reconnect your wallet and try again.');
  setReview(data);
 }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
 return <details className="capital-mandate-route"><summary>Check a real SPYon route against saved rules</summary><p className="footnote">This compares a fresh Pancake V3 quote with your saved cash and investment rules. It is a research check; it cannot reserve cash or ask your wallet to trade.</p><label>USDT to check<input inputMode="decimal" value={amount} disabled={busy} onChange={event=>{setAmount(event.target.value);setReview(null);}}/></label><button type="button" className="text-button" disabled={!ready||busy} onClick={()=>void check()}>{busy?'Checking…':'Check saved rules and route'}</button>{!ready&&<p className="footnote">Save cash and investment rules before checking.</p>}{error&&<p role="alert" className="wallet-error">{error}</p>}{review&&<div aria-live="polite"><p><strong>{review.state==='POLICY_CHECKED'?'Saved rules fit this route.':'This route is blocked by saved rules or missing evidence.'}</strong></p><p className="footnote">Mandate revision {review.mandateRevision??'none'} · cash rules {review.cashPolicyRevision} · BNB Chain block #{review.routeBlockNumber}{review.worstCaseCostBps!==null?` · minimum-output price cost ${review.worstCaseCostBps} bps`:''}</p>{review.reasons.map(reason=><p key={reason}>{descriptions[reason]??reason.replaceAll('_',' ').toLowerCase()}</p>)}<p className="footnote">Price cost assumes USDT is worth $1 and excludes BNB network fees. No funds are held and no wallet authorization is requested. A new quote and plan reservation will be required for a future trade.</p></div>}</details>;
}
