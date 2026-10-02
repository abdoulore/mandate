'use client';
import {useEffect,useRef,useState} from 'react';
import type {MandateInput,RecurringFiring,RecurringSchedule,ResearchProposal,SavedInvestmentMandate} from '@mandate/domain';

type Activity={schedules:RecurringSchedule[];firings:RecurringFiring[]};
type Props={saved:SavedInvestmentMandate|null;scenario:MandateInput['scenario'];dirty:boolean;hasCheckpoint:boolean;rulesLoaded:boolean;request:(url:string,body?:unknown)=>Promise<any>;proposals:ResearchProposal[];onProposals:(items:ResearchProposal[])=>void};
const cadence=[{seconds:60,label:'Every minute · demo'},{seconds:3600,label:'Every hour'},{seconds:86400,label:'Every day'},{seconds:604800,label:'Every week'}];
const reasonText:Record<string,string>={CAPITAL_READ_UNAVAILABLE:'The wallet balance read failed. This firing will retry with a fresh read.',FRESH_EVIDENCE_REQUIRED:'Current holdings or market evidence could not be confirmed. This firing will retry.',STALE_MANDATE:'Saved investment rules changed during the check. This firing will retry with the latest rules.',STALE_PROPOSAL_INPUTS:'Wallet or policy inputs changed during the check. This firing will retry.',PAUSED:'Paused before a proposal was saved.',REVOKED:'Revoked before a proposal was saved.'};
const date=(value:string)=>new Date(value).toLocaleString();
function money(value:string,decimals:number){const n=BigInt(value),scale=10n**BigInt(decimals),fraction=(n%scale).toString().padStart(decimals,'0').slice(0,6).replace(/0+$/,'');return (n/scale).toLocaleString('en-US')+(fraction?'.'+fraction:'');}
function firingLabel(run:RecurringFiring){return run.state==='proposed'?'Proposal recorded':run.state==='deferred'?'Waiting for fresh evidence':run.state==='claimed'?'Checking current evidence':'Cancelled before proposal';}

export default function RecurringPanel({saved,scenario,dirty,hasCheckpoint,rulesLoaded,request,proposals,onProposals}:Props){
 const [activity,setActivity]=useState<Activity>({schedules:[],firings:[]}),[loaded,setLoaded]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [intervalSeconds,setIntervalSeconds]=useState(86400),[chosenScenario,setChosenScenario]=useState<MandateInput['scenario']>(scenario),[startMode,setStartMode]=useState<'now'|'later'>('now'),[startsAt,setStartsAt]=useState(''),[expanded,setExpanded]=useState<string|null>(null);
 const retry=useRef<{key:string;id:string}|null>(null),sequence=useRef(0),workingRef=useRef(false),mounted=useRef(false),proposalsRef=useRef(proposals);
 useEffect(()=>{proposalsRef.current=proposals;},[proposals]);
 const futureStart=startMode==='now'?null:new Date(startsAt);
 const validStart=startMode==='now'||startsAt!==''&&futureStart!==null&&Number.isFinite(futureStart.getTime())&&futureStart.getTime()>Date.now()&&futureStart.getTime()<=Date.now()+365*86400000;

 async function reload(includeProposals=false){
  const current=++sequence.current;
  try{
   const next:Activity=await request('/recurring');
   if(!mounted.current||current!==sequence.current)return;
   setActivity(next);setLoaded(true);setError('');
   const known=new Set(proposalsRef.current.map(p=>p.id));
   if(includeProposals||next.firings.some(f=>f.proposalId&&!known.has(f.proposalId))){
    const records=await request('/proposals');
    if(mounted.current&&current===sequence.current){proposalsRef.current=records.items;onProposals(records.items);}
   }
  }catch(e){if(mounted.current&&current===sequence.current){setLoaded(true);setError((e as Error).message);}}
 }
 useEffect(()=>{
  mounted.current=true;void reload(true);
  const timer=setInterval(()=>{if(!workingRef.current&&document.visibilityState==='visible')void reload();},30000);
  return()=>{mounted.current=false;sequence.current++;clearInterval(timer);};
 },[]);

 async function act(operation:()=>Promise<RecurringSchedule>,success:string){
  if(workingRef.current)return;
  workingRef.current=true;setWorking(true);setError('');setNotice('');
  try{
   const schedule=await operation();
   setActivity(previous=>({schedules:[schedule,...previous.schedules.filter(s=>s.id!==schedule.id)],firings:previous.firings}));
   setExpanded(schedule.id);setNotice(success);await reload(true);
  }catch(e){const message=(e as Error).message;await reload();if(mounted.current)setError(message);}
  finally{workingRef.current=false;setWorking(false);}
 }
 async function create(){
  if(!saved){
   setNotice('');setError(rulesLoaded?'Save investment rules before creating a schedule. No schedule was created.':'Saved investment rules have not loaded. Reconnect or refresh the page, then try again.');
   if(rulesLoaded)document.getElementById(hasCheckpoint?'save-investment-rules':'refresh-capital')?.scrollIntoView({behavior:'smooth',block:'center'});
   return;
  }
  if(!validStart){setNotice('');setError('Choose a future first check within one year.');return;}
  if(activeCount+pausedCount>=20){setNotice('');setError('This wallet already has 20 active or paused schedules. Revoke one before creating another.');return;}
  const start=startMode==='later'?futureStart!.toISOString():undefined;
  const key=JSON.stringify({intervalSeconds,scenario:chosenScenario,start});
  const requestId=retry.current?.key===key?retry.current.id:crypto.randomUUID();retry.current={key,id:requestId};
  await act(async()=>{
   const value=await request('/recurring',{requestId,intervalSeconds,scenario:chosenScenario,...(start?{startsAt:start}:{})});
   retry.current=null;return value.schedule as RecurringSchedule;
  },`Research schedule saved using investment rules revision ${saved.revision}. Its first check will use fresh wallet and market evidence.`);
 }
 async function change(schedule:RecurringSchedule,action:'pause'|'resume'|'revoke'){
  await act(async()=>{
   const value=await request('/recurring/'+action,{scheduleId:schedule.id,expectedRevision:schedule.revision});
   return value.schedule as RecurringSchedule;
  },action==='pause'?'Schedule paused. An unfinished check cannot save a proposal.':action==='resume'?'Schedule resumed. Its next check will refresh evidence.':'Schedule revoked. No new checks can be dispatched.');
 }
 const activeCount=activity.schedules.filter(s=>s.status==='active').length,pausedCount=activity.schedules.filter(s=>s.status==='paused').length;
 return <section id="recurring-checks" className="capital-recurring" aria-label="Recurring research schedules">
  <div className="recurring-heading"><div><span className="eyebrow">AUTOMATED RESEARCH · NO TRADES</span><h3>Recurring checks</h3><p>Choose how often Mandate rechecks your wallet and saved rules. Each check saves a suggested plan; it does not hold cash or request a trade.</p></div><span className="recurring-authority">No trade permission</span></div>
  <div className="recurring-create">
   <div className="recurring-inputs"><label>Check frequency<select aria-label="Recurring check frequency" value={intervalSeconds} disabled={working} onChange={e=>setIntervalSeconds(Number(e.target.value))}>{cadence.map(c=><option key={c.seconds} value={c.seconds}>{c.label}</option>)}</select></label><label>Research scenario<select aria-label="Recurring research scenario" value={chosenScenario} disabled={working} onChange={e=>setChosenScenario(e.target.value as MandateInput['scenario'])}><option value="normal">Normal costs</option><option value="expensive">Higher costs</option><option value="missing">Missing route</option></select></label><label>First check<select aria-label="Recurring first check" value={startMode} disabled={working} onChange={e=>setStartMode(e.target.value as 'now'|'later')}><option value="now">As soon as the service runs</option><option value="later">At a chosen time</option></select></label>{startMode==='later'&&<label>First check time<input aria-label="Recurring first check time" type="datetime-local" value={startsAt} disabled={working} onChange={e=>setStartsAt(e.target.value)}/></label>}</div>
   <p className="footnote">Checks run only while the Mandate service is online, usually within 30 seconds of the scheduled time. Each check uses the latest saved rules, wallet holdings, protected cash and market evidence. The one-minute option is for short-term testing; pause it when finished.</p>
   <button type="button" className="recurring-create-button" disabled={working} onClick={()=>void create()}>{working?'Updating…':'Create research schedule'}</button>
   {!saved?<p className="recurring-guidance">{rulesLoaded?<>First <a href={hasCheckpoint?'#save-investment-rules':'#refresh-capital'}>{hasCheckpoint?'save investment rules':'refresh wallet capital'}</a> above. Then create a schedule.</>:'Saved investment rules are loading. If this does not clear, reconnect your wallet and refresh the page.'}</p>:dirty?<p className="recurring-guidance">You have unsaved edits. This schedule will use <strong>saved investment rules revision {saved.revision}</strong> and the last saved cash rules. Save your edits first if you want them included.</p>:<p className="recurring-guidance">This schedule will use saved investment rules revision {saved.revision} and the latest saved cash protections.</p>}
   {!validStart&&<p className="wallet-error">Choose a future first check within one year.</p>}{activeCount+pausedCount>=20&&<p className="wallet-error">This wallet has reached the 20-schedule limit. Revoke one before creating another.</p>}
  </div>
  <div className="recurring-list-heading"><div><h4>Your schedules</h4><p>{activeCount} active · {pausedCount} paused · {activity.firings.length} recent check{activity.firings.length===1?'':'s'}</p></div><button type="button" className="text-button" disabled={working} onClick={()=>void reload(true)}>Refresh activity</button></div>
  {notice&&<p role="status" className="recurring-notice">{notice}</p>}{error&&<p role="alert" className="wallet-error">{error}</p>}
  {!loaded?<p>Loading schedules…</p>:!activity.schedules.length?<p className="recurring-empty">No recurring checks yet. Save a schedule to record fresh research automatically.</p>:activity.schedules.map(schedule=>{
   const runs=activity.firings.filter(f=>f.scheduleId===schedule.id),open=expanded===schedule.id;
   return <details className="recurring-schedule" key={schedule.id} data-recurring-id={schedule.id} open={open} onToggle={e=>{if(e.currentTarget.open)setExpanded(schedule.id);else if(expanded===schedule.id)setExpanded(null);}}>
    <summary><span className="recurring-summary-main"><strong>{cadence.find(c=>c.seconds===schedule.intervalSeconds)?.label??`Every ${schedule.intervalSeconds} seconds`}</strong><small>{schedule.status==='active'?'Next check '+date(schedule.nextDueAt):schedule.status==='paused'?'Paused · due slot retained':'Revoked · no further checks'}</small></span><span className={'recurring-state '+schedule.status}>{schedule.status}</span></summary>
    <div className="recurring-detail"><p>Research scenario: {schedule.scenario} · schedule revision {schedule.revision}. Each check uses the latest saved mandate and never inherits trade authorization.</p>
     <div className="recurring-actions">{schedule.status==='active'&&<button type="button" className="text-button" disabled={working} onClick={()=>void change(schedule,'pause')}>Pause checks</button>}{schedule.status==='paused'&&<button type="button" className="text-button" disabled={working} onClick={()=>void change(schedule,'resume')}>Resume checks</button>}{schedule.status!=='revoked'&&<button type="button" className="text-button recurring-revoke" disabled={working} onClick={()=>void change(schedule,'revoke')}>Revoke schedule</button>}</div>
     <h5>Recent checks</h5>{!runs.length?<p>No checks recorded yet.</p>:runs.map(run=>{const proposal=proposals.find(p=>p.id===run.proposalId);return <div className="recurring-firing" key={run.id} data-firing-id={run.id}><div><strong>{firingLabel(run)}</strong><span>{date(run.dueAt)} · attempt {run.attempts}</span></div>{run.reason&&<p>{reasonText[run.reason]??`Check deferred: ${run.reason}`}</p>}{proposal?<><p>Block #{proposal.inputs.checkpoint.blockNumber} · mandate revision {proposal.mandateRevision} · {proposal.result.status==='feasible'?'Model fit':'No allocation'} · {proposal.scenario} synthetic costs.</p><p>Wallet cash {money(proposal.inputs.funding.balanceAtomic,proposal.inputs.funding.decimals)} USDT · market source {proposal.inputs.marks.source}. {proposal.result.reasons.join(' ')}</p><details><summary>Inspect recorded evidence</summary><pre>{JSON.stringify({scheduleId:schedule.id,firingId:run.id,proposalId:proposal.id,mandateRevision:proposal.mandateRevision,checkpoint:proposal.inputs.checkpoint,funding:proposal.inputs.funding,portfolio:proposal.inputs.portfolio,marks:proposal.inputs.marks,result:proposal.result},null,2)}</pre></details></>:run.proposalId?<p>Proposal {run.proposalId} was recorded. Use Research proposal history for its full snapshot.</p>:null}</div>;})}
    </div>
   </details>;
  })}
  <p className="footnote">Schedules and firing history persist after a restart. A stopped API or sleeping computer cannot run a due check; the same due slot resumes when service returns. Pausing or revoking stops future proposal saves, but keeps past research in history.</p>
 </section>;
}
