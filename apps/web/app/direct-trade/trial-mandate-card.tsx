'use client';
import {useEffect,useState} from 'react';

type Trial={revision:number;policy:{maxCostBps:number}};
type Portfolio={revision:number;allocations:{underlying:string;weightBps:number}[]};

export function TrialMandateCard({address,active,onSaved,onStatus}:{address:string;active:boolean;onSaved:()=>void;onStatus:(saved:boolean)=>void}){
 const [visible,setVisible]=useState(false),[trial,setTrial]=useState<Trial|null>(null),[portfolio,setPortfolio]=useState<Portfolio|null>(null),[cost,setCost]=useState('100'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;(async()=>{
  try{const response=await fetch('/api/v1/routes/SPYon/trial-mandate',{credentials:'same-origin',cache:'no-store'});if(response.status===403){onStatus(false);return;}const value=await response.json();if(!response.ok)throw new Error(value.error||'Trial rules are unavailable.');if(!live)return;setVisible(true);onStatus(Boolean(value.trial));setTrial(value.trial);setPortfolio(value.portfolio);setCost(String(value.trial?.policy.maxCostBps??100));}
  catch(error){if(live){onStatus(false);setMessage((error as Error).message);}}
 })();return()=>{live=false;};},[address]);
 if(!visible)return null;
 const parsed=Number(cost),valid=/^(0|[1-9]\d*)$/.test(cost)&&Number.isInteger(parsed)&&parsed>=0&&parsed<=200;
 async function save(){if(!valid)return;setBusy(true);setMessage('');try{
  const response=await fetch('/api/v1/routes/SPYon/trial-mandate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxCostBps:parsed,expectedRevision:trial?.revision??0}),cache:'no-store'});
  const value=await response.json();if(!response.ok)throw new Error(value.error==='DIRECT_ATTEMPT_PENDING'?'Resolve the current wallet request before changing trial rules.':value.error==='STALE_DIRECT_TRIAL_MANDATE'?'Trial rules changed elsewhere. Reload this page.':value.error||'Trial rules could not be saved.');
  setTrial(value.trial);onStatus(true);setMessage('Trial rules saved. No wallet permission or transaction was requested.');onSaved();
 }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
 const main=portfolio?.allocations.map(item=>`${item.underlying} ${item.weightBps/100}%`).join(' · ');
 return <section className="direct-card direct-review"><div className="direct-card-heading"><span>SEPARATE TRIAL RULES</span><h2>{trial?'SPYon trial rules saved':'Save SPYon trial rules'}</h2></div>
  {trial&&<p className="direct-small">SPY only · SPYon contract only · maximum route cost {trial.policy.maxCostBps/100}% · main portfolio plan unchanged.</p>}
  <details className="direct-trial-details" open={!trial}><summary>{trial?active?'Review saved trial rules':'Review or change trial rules':'Set trial rules'}</summary>
   <p>Your portfolio plan{main?` (${main})`:''} stays unchanged. These rules apply only to the capped SPYon direct trial. They do not place a trade.</p>
   {trial&&<p className="direct-small">Saved trial revision {trial.revision} · SPY 100% · Ondo issuer limit 100% · SPYon contract only.</p>}
   <label>Maximum route cost (basis points)<input type="number" inputMode="numeric" min="0" max="200" step="1" value={cost} disabled={busy||active} onChange={event=>setCost(event.target.value)}/><small>100 basis points = 1%. This limit compares the worst-case minimum output with the current reference price; network fees are separate. Choose 0–200.</small></label>
   <button type="button" disabled={busy||active||!valid||trial?.policy.maxCostBps===parsed} onClick={()=>void save()}>{busy?'Saving…':trial?'Update trial rules':'Save trial rules'}</button>
   {!trial&&<p className="direct-small">Save these separate rules before preparing a plan-backed buy. You will review any approval or swap separately in your wallet.</p>}
   {active&&<p className="direct-small">Finish or discard the current request before changing trial rules.</p>}
  </details>
  {message&&<p className="direct-message" role="status">{message}</p>}
 </section>;
}
