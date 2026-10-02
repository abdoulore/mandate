import {createHash} from 'node:crypto';
import {mandateSchema,SCHEMA_VERSION,type Instrument,type ScenarioQuote,type PlanResult,type PlanLeg,type ExecutionState,type CapitalFunding,type PortfolioExposure} from '@mandate/domain';
import {parseUnits,allocate} from './money.ts';
export {parseUnits,formatUnits,allocate} from './money.ts';
export {defaultMandate,instruments,quotesFor} from './fixtures.ts';
export {capitalProtection} from './capital.ts';
export {assessPortfolio} from './portfolio.ts';
export {compareResearchProposals} from './revalidation.ts';
export {previewRebalance} from './rebalance.ts';

export function previewInvestment(raw:unknown,instruments:Instrument[],quotes:ScenarioQuote[],now=new Date(),funding?:CapitalFunding,portfolio?:PortfolioExposure,budgetCapAtomic?:string):PlanResult{
 const input=mandateSchema.parse(raw);
 const decimals=funding?.decimals??6;
 const balance=funding?BigInt(funding.balanceAtomic):parseUnits(input.balance,6),floor=parseUnits(input.reserveFloor,6),operating=funding?0n:parseUnits(input.operatingBudget,6);
 const obligations=input.obligations.reduce((s,o)=>s+parseUnits(o.amount,6),0n);
 const reserve=funding?BigInt(funding.protectedAtomic):floor>obligations?floor:obligations;
 const held=funding?BigInt(funding.heldAtomic):0n;
 const budget=balance-reserve-operating-held;let spendable=budget>0n?budget:0n;if(budgetCapAtomic!==undefined){if(!/^(0|[1-9]\d{0,77})$/.test(budgetCapAtomic))throw new Error('INVALID_BUDGET_CAP');const cap=BigInt(budgetCapAtomic);if(cap<spendable)spendable=cap;}
 const result:PlanResult={schemaVersion:SCHEMA_VERSION,mode:'scenario',status:'infeasible',executable:false,createdAt:now.toISOString(),currency:'USDT',decimals:6,balanceAtomic:balance.toString(),reserveAtomic:reserve.toString(),operatingAtomic:operating.toString(),investableAtomic:spendable.toString(),unallocatedAtomic:spendable.toString(),modeledCostAtomic:'0',legs:[],issuerExposure:[],excluded:[],reasons:[],decisionId:createHash('sha256').update(JSON.stringify({input,instruments,quotes,budgetCapAtomic})).digest('hex').slice(0,20)};
 result.decimals=decimals;result.heldAtomic=held.toString();result.capitalBasis=funding??null;
 if(funding){result.decisionId=createHash('sha256').update(JSON.stringify({input,instruments,quotes,funding,budgetCapAtomic})).digest('hex').slice(0,20);const age=now.getTime()-Date.parse(funding.observedAt);if(!Number.isFinite(age)||age<0||age>60000){result.investableAtomic='0';result.unallocatedAtomic='0';result.reasons.push('The wallet checkpoint is stale or has an invalid timestamp. Refresh capital before planning.');return result;}}
 if(budget<=0n||spendable===0n){result.reasons.push(funding?'Observed cash does not cover saved protections and pending reservations with funds left to invest.':'The balance does not cover the reserve and operating budget with funds left to invest.');return result;}
 if(portfolio){result.portfolioBasis=portfolio;result.exposureDenominator=portfolio.scope;const {checkedAt,...basis}=portfolio;result.decisionId=createHash('sha256').update(JSON.stringify({input,instruments,quotes,funding,portfolio:basis,budgetCapAtomic})).digest('hex').slice(0,20);const age=now.getTime()-Date.parse(checkedAt);if(portfolio.state!=='KNOWN'||portfolio.decimals!==decimals||!Number.isFinite(age)||age<0||age>60000){result.reasons.push('Tracked portfolio exposure is unresolved or stale. '+portfolio.reasons.join('; '));return result;}}
 const baseline=new Map<string,bigint>();for(const l of [...(portfolio?.existing??[]),...(portfolio?.pending??[])])baseline.set(l.issuer,(baseline.get(l.issuer)??0n)+BigInt(l.valueAtomic));
 const amounts=allocate(spendable,input.allocations.map(a=>a.weightBps));
 const choices=input.allocations.map((a,n)=>instruments.filter(i=>i.underlying===a.underlying).flatMap(i=>{
  const q=quotes.find(q=>q.instrumentId===i.id);
  let reason:string|undefined;
  if(i.evidenceMode==='research'&&(!i.contract||!input.representationAllowlist?.includes(i.contract)))reason='This exact representation has not been selected for research.';
  else if(i.evidenceMode==='research'&&!i.researchEligible)reason='Sourced passport facts or profile freshness exclude this research candidate.';
  else if(i.leveraged&&!input.allowLeveraged)reason='Leveraged products are excluded by this mandate.';
  else if(!q||!q.available)reason=q?.reason||'No current scenario quote is available.';
  else if(!Number.isInteger(q.costBps)||q.costBps<0||q.costBps>input.maxCostBps)reason='Modeled execution cost exceeds your limit.';
  if(reason){result.excluded.push({instrumentId:i.id,reason});return [];}
  const net=amounts[n]*10000n/BigInt(10000+q!.costBps);
  return [{instrumentId:i.id,underlying:a.underlying,issuer:i.issuer,grossAtomic:amounts[n].toString(),netExposureAtomic:net.toString(),modeledCostAtomic:(amounts[n]-net).toString(),costBps:q!.costBps,weightBps:a.weightBps} satisfies PlanLeg];
 }));
 choices.forEach((c,n)=>{if(!c.length)result.reasons.push('No permitted representation is available for '+input.allocations[n].underlying+'.');});
 if(result.reasons.length)return result;
 if(choices.reduce((n,c)=>n*c.length,1)>4096){result.reasons.push('This proposal exceeds the current planner search bound.');return result;}
 let best:PlanLeg[]|undefined;let bestCost:bigint|undefined;
 function search(index:number,legs:PlanLeg[]){
  if(index<choices.length){for(const leg of choices[index])search(index+1,[...legs,leg]);return;}
  const exposure=new Map(baseline);let total=[...baseline.values()].reduce((n,v)=>n+v,0n),cost=0n;
  for(const leg of legs){const net=BigInt(leg.netExposureAtomic);total+=net;cost+=BigInt(leg.modeledCostAtomic);exposure.set(leg.issuer,(exposure.get(leg.issuer)||0n)+net);}
  if(total===0n||[...exposure.values()].some(n=>n*10000n>total*BigInt(input.maxIssuerBps)))return;
  if(bestCost===undefined||cost<bestCost){best=legs;bestCost=cost;}
 }
 search(0,[]);
 if(!best){result.reasons.push('The available representations cannot satisfy the issuer concentration limit. Adjust the allocation or approved limit.');return result;}
 result.status='feasible';result.legs=best;result.unallocatedAtomic='0';result.modeledCostAtomic=bestCost!.toString();
 const exposure=new Map(baseline);let total=[...baseline.values()].reduce((n,v)=>n+v,0n);for(const leg of best){const value=BigInt(leg.netExposureAtomic);total+=value;exposure.set(leg.issuer,(exposure.get(leg.issuer)||0n)+value);}
 result.issuerExposure=[...exposure].map(([issuer,value])=>({issuer,exposureAtomic:value.toString(),shareBps:Number(value*10000n/total)}));
 result.reasons.push('The plan preserves your committed reserve and operating budget.',portfolio?'Representation choices satisfy the issuer cap on tracked holdings, pending plans and proposed net exposure. USD marks and modeled USDT budgets assume nominal 1:1 parity; this is not a verified exchange rate.':'Representation choices satisfy the issuer cap on modeled invested exposure.',funding?'Synthetic quote estimates against observed ledger capacity. Pending reservations are excluded; no trade has been authorized.':'Scenario estimates only. No wallet is connected and no trade has been authorized.');
 return result;
}

// Submission uncertainty is deliberately not convertible to a fresh order.
const transitions:Record<ExecutionState,readonly ExecutionState[]>={created:['quoting','rejected'],quoting:['policy_checked','deferred','rejected'],policy_checked:['awaiting_authorization','deferred'],awaiting_authorization:['submitting','expired','rejected'],submitting:['submitted','unknown'],submitted:['settling','unknown','cancellation_requested'],settling:['reconciled','failed','unknown','cancellation_requested'],unknown:['submitted','settling','reconciled','failed','expired','cancellation_requested'],cancellation_requested:['settling','reconciled','failed','expired','unknown'],deferred:['quoting','rejected'],rejected:[],expired:[],failed:[],reconciled:[]};
export function transitionAttempt(from:ExecutionState,to:ExecutionState):ExecutionState{if(!transitions[from].includes(to))throw new Error('Invalid attempt transition: '+from+' -> '+to);return to;}

export function previewWithdrawal(target:string,uncommitted:string,quotes:{id:string;maxNet:string;available:boolean}[]){
 const goal=parseUnits(target,6),cash=parseUnits(uncommitted,6);let missing=goal>cash?goal-cash:0n;
 const legs:{id:string;netAtomic:string}[]=[];
 for(const q of quotes){if(!q.available||missing===0n)continue;const max=parseUnits(q.maxNet,6),n=max<missing?max:missing;legs.push({id:q.id,netAtomic:n.toString()});missing-=n;}
 return {mode:'scenario',executable:false,targetAtomic:goal.toString(),existingUncommittedAtomic:(cash<goal?cash:goal).toString(),coveredAtomic:(goal-missing).toString(),shortfallAtomic:missing.toString(),legs,note:'Synthetic net-capacity estimates. Positions without quotes are excluded. No proceeds are guaranteed or settled.'};
}

export {previewCashRaising} from './cash-raising.ts';

export {classifyInflow} from './inflows.ts';
