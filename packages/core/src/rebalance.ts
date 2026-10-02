import {createHash} from 'node:crypto';
import type {ResearchProposal,RebalanceResult,RebalanceLeg,Instrument} from '@mandate/domain';
import {allocate,parseUnits} from './money.ts';
const sum=(values:bigint[])=>values.reduce((a,b)=>a+b,0n),min=(a:bigint,b:bigint)=>a<b?a:b,ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
export function previewRebalance(inputs:ResearchProposal['inputs'],useAvailableCash=false,now=new Date()):RebalanceResult{
 const {mandate:m,funding:f,portfolio:p,marks,candidates,quotes}=inputs,timestamp=now.getTime(),existing=sum(p.existing.map(l=>BigInt(l.valueAtomic))),pending=sum(p.pending.map(l=>BigInt(l.valueAtomic))),balance=BigInt(f.balanceAtomic),protectedCash=BigInt(f.protectedAtomic),held=BigInt(f.heldAtomic),free=balance>protectedCash+held?balance-protectedCash-held:0n;
 const {checkedAt,...book}=p;
 const result:RebalanceResult={schemaVersion:'1.0.0',mode:'research',executable:false,status:'blocked',createdAt:now.toISOString(),decisionId:createHash('sha256').update(JSON.stringify({mandate:m,funding:f,portfolio:book,marks,candidates,quotes,useAvailableCash})).digest('hex').slice(0,20),decimals:18,currency:'USD-nominal-USDT-parity',scope:p.scope,useAvailableCash,existingExposureAtomic:existing.toString(),pendingExposureAtomic:pending.toString(),availableCashAtomic:free.toString(),cashUsedAtomic:'0',projectedCashAtomic:null,protectedCashAtomic:protectedCash.toString(),heldCashAtomic:held.toString(),feeAtomic:'0',turnoverAtomic:'0',turnoverBps:null,afterExposureAtomic:null,drift:[],legs:[],issuerExposure:[],reasons:[]};
 const total=existing+pending,keys=[...new Set([...m.allocations.map(a=>a.underlying),...p.byUnderlying.map(g=>g.underlying)])].sort();
 result.drift=keys.map(underlying=>{const h=sum(p.existing.filter(l=>l.underlying===underlying).map(l=>BigInt(l.valueAtomic))),q=sum(p.pending.filter(l=>l.underlying===underlying).map(l=>BigInt(l.valueAtomic))),weight=m.allocations.find(a=>a.underlying===underlying)?.weightBps??0,share=p.state==='KNOWN'&&total>0n?Number((h+q)*10000n/total):null;return {underlying,heldAtomic:h.toString(),pendingAtomic:q.toString(),currentAtomic:(h+q).toString(),currentWeightBps:share,targetWeightBps:weight,driftBps:share===null?null:share-weight,afterAtomic:null,afterWeightBps:null};});
 const fail=(reason:string)=>{result.reasons.push(reason);return result;};
 const fresh=(date:string,age:number)=>Number.isFinite(Date.parse(date))&&timestamp-Date.parse(date)>=0&&timestamp-Date.parse(date)<=age;
 if(f.decimals!==18||p.decimals!==18||!fresh(f.observedAt,60000))return fail('Refresh the wallet checkpoint before modeling a rebalance.');
 if(p.state!=='KNOWN'||!fresh(checkedAt,60000))return fail('Tracked exposure is unresolved or stale. '+p.reasons.join('; '));
 if(balance<protectedCash+held)return fail('Observed cash is below saved protections and pending holds. A cash-raising workflow is needed before rebalance purchases.');
 const contribution=useAvailableCash?free:0n,wealth=total+contribution;
 if(wealth===0n){result.status='unchanged';result.afterExposureAtomic='0';result.projectedCashAtomic=balance.toString();result.reasons.push('No tracked investment exposure or selected cash contribution is available to rebalance.');return result;}
 if(m.maxIssuerBps<5000)return fail('Two issuers cannot cover this portfolio under a cap below 50%.');
 const known=new Map(candidates.map(i=>[i.id,i])),prices=new Map<string,bigint>(),issues=new Set<string>();
 function gate(id:string):{instrument:Instrument;price:bigint;cost:number}|null{
  const i=known.get(id),q=quotes.find(q=>q.instrumentId===id);let reason:string|undefined;
  if(!i||i.contract!==id||!m.representationAllowlist?.includes(id))reason='Exact contract is not selected.';
  else if(!i.researchEligible||i.leveraged&&!m.allowLeveraged)reason='Passport/profile or leverage policy excludes this representation.';
  else if(!q?.available)reason='Synthetic quote is unavailable.';
  else if(!Number.isInteger(q.costBps)||q.costBps<0||q.costBps>m.maxCostBps)reason='Synthetic cost exceeds the saved limit.';
  const found=marks.items.filter(mark=>mark.contract===id&&mark.issuer===i?.issuer),mark=found.length===1?found[0]:null;
  if(!reason&&(!mark||!fresh(marks.observedAt,60000)||!fresh(mark.updatedAt,900000)))reason='A fresh raw-token USD mark is unavailable.';
  let price=0n;if(!reason)try{price=parseUnits(mark!.price,18);if(price<=0n)throw new Error();}catch{reason='Raw-token USD mark has invalid precision/value.';}
  if(reason){issues.add((i?.name??id)+': '+reason);return null;}prices.set(id,price);return {instrument:i!,price,cost:q!.costBps};
 }
 const positions=p.positions.filter(v=>v.rawAtomic!==null&&BigInt(v.rawAtomic)>0n),oldValues=new Map(p.existing.map(l=>[l.instrumentId,BigInt(l.valueAtomic)]));
 for(const v of positions){if(v.price===null)return fail(v.symbol+': a position mark is missing.');prices.set(v.contract,parseUnits(v.price,18));}
 const buyChoices=m.allocations.map(a=>{const valid=candidates.filter(i=>i.underlying===a.underlying).sort((a,b)=>a.id.localeCompare(b.id)).filter(i=>gate(i.id));return valid.length?valid:[null];});
 const orders=m.allocations.map(a=>{const values=positions.filter(v=>v.underlying===a.underlying).map(v=>v.contract).sort((a,b)=>a.localeCompare(b));return values.length>1?[values,[...values].reverse()]:[values];});
 if([...buyChoices,...orders].reduce((n,a)=>n*a.length,1)>4096)return fail('This rebalance exceeds the current 4,096-choice research search bound.');
 type Model={legs:RebalanceLeg[];after:Map<string,bigint>;fees:bigint;turnover:bigint;cash:bigint};
 let best:Model|null=null;
 function evaluate(buys:(Instrument|null)[],sellOrders:string[][]){
  let targetTotal=wealth;
  for(let iteration=0;iteration<40;iteration++){
   const targets=allocate(targetTotal,m.allocations.map(a=>a.weightBps)),desired=new Map(oldValues);
   for(const v of positions)if(!m.allocations.some(a=>a.underlying===v.underlying))desired.set(v.contract,0n);
   for(let n=0;n<m.allocations.length;n++){
    const underlying=m.allocations[n].underlying,q=sum(p.pending.filter(l=>l.underlying===underlying).map(l=>BigInt(l.valueAtomic)));if(q>targets[n]){issues.add(underlying+': committed pending exposure exceeds its target; pending positions cannot be sold.');return;}
    const mutable=targets[n]-q,current=sum(positions.filter(v=>v.underlying===underlying).map(v=>oldValues.get(v.contract)??0n));
    if(current>mutable){let reduce=current-mutable;for(const id of sellOrders[n]){const value=desired.get(id)??0n,take=min(value,reduce);desired.set(id,value-take);reduce-=take;if(reduce===0n)break;}}
    else if(current<mutable){const buy=buys[n];if(!buy){issues.add(underlying+': no selected, eligible representation has a fresh mark and permitted quote.');return;}desired.set(buy.id,(desired.get(buy.id)??0n)+mutable-current);}
   }
   if(p.pending.some(l=>!m.allocations.some(a=>a.underlying===l.underlying)&&BigInt(l.valueAtomic)>0n)){issues.add('A pending position lies outside the saved targets and cannot be sold.');return;}
   const exposure=()=>{const values=new Map<string,bigint>();for(const [id,value] of desired){const i=known.get(id);if(i)values.set(i.issuer,(values.get(i.issuer)??0n)+value);}for(const l of p.pending)values.set(l.issuer,(values.get(l.issuer)??0n)+BigInt(l.valueAtomic));return values;};
   // Rotate mutable holdings/new additions within an underlying to repair issuer concentration.
   const cap=targetTotal*BigInt(m.maxIssuerBps)/10000n;
   for(const issuer of ['bstock','ondo']){let excess=(exposure().get(issuer)??0n)-cap;if(excess<=0n)continue;
    const sources=[...desired.keys()].filter(id=>known.get(id)?.issuer===issuer).sort((a,b)=>{const aNew=(desired.get(a)??0n)>(oldValues.get(a)??0n),bNew=(desired.get(b)??0n)>(oldValues.get(b)??0n);return aNew===bNew?a.localeCompare(b):aNew?-1:1;});
    for(const id of sources){const source=known.get(id)!,index=m.allocations.findIndex(a=>a.underlying===source.underlying),buy=buys[index];if(!buy||buy.issuer===issuer)continue;const room=cap-(exposure().get(buy.issuer)??0n),take=min(desired.get(id)??0n,min(excess,room>0n?room:0n));if(take<=0n)continue;desired.set(id,(desired.get(id)??0n)-take);desired.set(buy.id,(desired.get(buy.id)??0n)+take);excess-=take;if(excess===0n)break;}
    if(excess>0n){issues.add('Selected representations and immutable pending exposure cannot satisfy the issuer cap.');return;}
   }
   const legs:RebalanceLeg[]=[],after=new Map(oldValues);let fees=0n,turnover=0n,saleNet=0n,buyCash=0n,roundingLoss=0n;
   for(const v of positions){const old=oldValues.get(v.contract)??0n,target=desired.get(v.contract)??0n;if(target>=old)continue;const g=gate(v.contract);if(!g)return;const scale=10n**BigInt(v.decimals),raw=BigInt(v.rawAtomic!),quantity=target===0n?raw:min(raw,(old-target)*scale/g.price);if(quantity===0n)continue;
    const notional=quantity*g.price/scale,fee=ceil(notional*BigInt(g.cost),10000n);if(fee>notional){issues.add(v.symbol+': sale fee would exceed its modeled proceeds.');return;}const remaining=(raw-quantity)*g.price/scale;roundingLoss+=old-notional-remaining;after.set(v.contract,remaining);fees+=fee;turnover+=notional;saleNet+=notional-fee;legs.push({side:'SELL',instrumentId:v.contract,symbol:v.symbol,underlying:v.underlying,issuer:g.instrument.issuer,quantityAtomic:quantity.toString(),tokenDecimals:v.decimals,markNotionalAtomic:notional.toString(),feeAtomic:fee.toString(),cashAtomic:(notional-fee).toString(),costBps:g.cost,funding:'modeled-sale-proceeds'});
   }
   for(const [id,target] of desired){const old=oldValues.get(id)??0n;if(target<=old)continue;const g=gate(id);if(!g)return;const scale=10n**18n,quantity=(target-old)*scale/g.price;if(quantity===0n)continue;const marked=quantity*g.price/scale,spend=ceil(quantity*g.price,scale),fee=ceil(spend*BigInt(g.cost),10000n);roundingLoss+=spend-marked;after.set(id,(after.get(id)??0n)+marked);fees+=fee;turnover+=spend;buyCash+=spend+fee;legs.push({side:'BUY',instrumentId:id,symbol:g.instrument.name,underlying:g.instrument.underlying,issuer:g.instrument.issuer,quantityAtomic:quantity.toString(),tokenDecimals:18,markNotionalAtomic:marked.toString(),feeAtomic:fee.toString(),cashAtomic:(spend+fee).toString(),costBps:g.cost,funding:'wallet-cash'});
   }
   const next=wealth>fees+roundingLoss?wealth-fees-roundingLoss:0n,cash=balance+saleNet-buyCash,afterTotal=sum([...after.values()])+pending;
   const issuerValues=new Map<string,bigint>();for(const [id,value] of after){const i=known.get(id);if(i)issuerValues.set(i.issuer,(issuerValues.get(i.issuer)??0n)+value);}for(const l of p.pending)issuerValues.set(l.issuer,(issuerValues.get(l.issuer)??0n)+BigInt(l.valueAtomic));
   const finalTargets=allocate(afterTotal,m.allocations.map(a=>a.weightBps)),tolerance=afterTotal/10000n+10000n;
   const driftOK=m.allocations.every((a,n)=>{const value=sum([...after].filter(([id])=>known.get(id)?.underlying===a.underlying).map(([,v])=>v))+sum(p.pending.filter(l=>l.underlying===a.underlying).map(l=>BigInt(l.valueAtomic))),delta=value-finalTargets[n];return (delta<0n?-delta:delta)<=tolerance;});
   if(cash>=protectedCash+held&&cash>=balance-contribution&&buyCash<=contribution+saleNet&&driftOK&&[...issuerValues.values()].every(v=>v*10000n<=afterTotal*BigInt(m.maxIssuerBps))){
    for(const l of legs)if(l.side==='BUY'&&buyCash>contribution)l.funding='requires-sale-settlement';
    const model={legs,after,fees,turnover,cash};if(!best||fees<best.fees||fees===best.fees&&turnover<best.turnover)best=model;return;
   }
   if(next===0n||targetTotal===0n)return;targetTotal=min(targetTotal-1n,next);
  }
  issues.add('Fee, rounding, funding or issuer constraints did not converge within the research model bound.');
 }
 function chooseOrders(n:number,buys:(Instrument|null)[],selected:string[][]){if(n===orders.length){evaluate(buys,selected);return;}for(const order of orders[n])chooseOrders(n+1,buys,[...selected,order]);}
 function chooseBuys(n:number,selected:(Instrument|null)[]){if(n===buyChoices.length){chooseOrders(0,selected,[]);return;}for(const i of buyChoices[n])chooseBuys(n+1,[...selected,i]);}
 chooseBuys(0,[]);
 if(!best)return fail([...issues].sort().join(' ')||'No cost- and issuer-compliant rebalance is available.');
 const selected=best as Model,afterTotal=sum([...selected.after.values()])+pending;
 result.status=selected.legs.length?'feasible':'unchanged';result.legs=selected.legs;result.feeAtomic=selected.fees.toString();result.turnoverAtomic=selected.turnover.toString();result.turnoverBps=total>0n?Number(selected.turnover*10000n/total):null;result.afterExposureAtomic=afterTotal.toString();result.projectedCashAtomic=selected.cash.toString();result.cashUsedAtomic=(balance>selected.cash?balance-selected.cash:0n).toString();
 const issuerValues=new Map<string,bigint>();for(const [id,value] of selected.after){const i=known.get(id);if(i)issuerValues.set(i.issuer,(issuerValues.get(i.issuer)??0n)+value);}for(const l of p.pending)issuerValues.set(l.issuer,(issuerValues.get(l.issuer)??0n)+BigInt(l.valueAtomic));result.issuerExposure=[...issuerValues].filter(([,v])=>v>0n).sort(([a],[b])=>a.localeCompare(b)).map(([issuer,value])=>({issuer,exposureAtomic:value.toString(),shareBps:afterTotal>0n?Number(value*10000n/afterTotal):0}));
 for(const row of result.drift){const value=sum([...selected.after].filter(([id])=>known.get(id)?.underlying===row.underlying).map(([,v])=>v))+sum(p.pending.filter(l=>l.underlying===row.underlying).map(l=>BigInt(l.valueAtomic)));row.afterAtomic=value.toString();row.afterWeightBps=afterTotal>0n?Number(value*10000n/afterTotal):null;}
 result.reasons.push('USD marks and modeled USDT cash assume nominal 1:1 parity. Costs and proceeds are synthetic estimates, not executable quotes.','Pending exposure is fixed; reserved cash and protections are excluded from purchases. Target tolerance is one basis point plus 10,000 USD atomic units.');
 if(selected.legs.some(l=>l.funding==='requires-sale-settlement'))result.reasons.push('Purchases require modeled sales to settle first. Estimated proceeds are not available wallet cash.');
 if(!selected.legs.length)result.reasons.push('Tracked exposure already fits the target and issuer limits within the stated tolerance.');
 return result;
}
