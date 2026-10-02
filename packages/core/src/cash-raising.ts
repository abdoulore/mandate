import {createHash} from 'node:crypto';
import type {ResearchProposal,CashRaisingResult,RebalanceLeg} from '@mandate/domain';
import {parseUnits} from './money.ts';
const min=(a:bigint,b:bigint)=>a<b?a:b,max=(a:bigint,b:bigint)=>a>b?a:b,ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
// A sell-only research model. Estimated proceeds never mutate wallet cash or holds.
export function previewCashRaising(inputs:ResearchProposal['inputs'],target:string,now=new Date()):CashRaisingResult{
 const wanted=parseUnits(target,18);if(wanted<=0n)throw new Error('INVALID_CASH_TARGET');
 const {funding:f,portfolio:p,mandate:m,marks,candidates,quotes}=inputs,stamp=now.getTime(),balance=BigInt(f.balanceAtomic),protectedCash=BigInt(f.protectedAtomic),held=BigInt(f.heldAtomic),floor=protectedCash+held,free=max(balance-floor,0n),gap=max(floor-balance,0n),need=max(floor+wanted-balance,0n),pending=p.pending.reduce((a,l)=>a+BigInt(l.valueAtomic),0n);
 const {checkedAt,...book}=p;
 const result:CashRaisingResult={schemaVersion:'1.0.0',mode:'research',executable:false,status:'blocked',createdAt:now.toISOString(),decisionId:createHash('sha256').update(JSON.stringify({inputs:{...inputs,portfolio:book},target})).digest('hex').slice(0,20),targetAtomic:wanted.toString(),decimals:18,currency:'USDT',scope:p.scope,availableCashAtomic:free.toString(),cashUsedAtomic:min(free,wanted).toString(),protectedCashAtomic:protectedCash.toString(),heldCashAtomic:held.toString(),protectionGapAtomic:gap.toString(),saleNeededAtomic:need.toString(),maximumNetSaleAtomic:null,netSaleAtomic:'0',feeAtomic:'0',grossSaleAtomic:'0',modeledPayoutAtomic:null,shortfallAtomic:null,protectionGapAfterAtomic:null,projectedCashBeforePayoutAtomic:null,projectedCashAfterPayoutAtomic:null,remainingExposureAtomic:null,remaining:[],issuerExposure:[],legs:[],excluded:[],reasons:[]};
 const fresh=(date:string,age:number)=>Number.isFinite(Date.parse(date))&&stamp-Date.parse(date)>=0&&stamp-Date.parse(date)<=age;
 const fail=(message:string)=>{result.reasons.push(message);return result;};
 if(f.decimals!==18||p.decimals!==18||!fresh(f.observedAt,60000))return fail('Refresh the wallet checkpoint before modeling a cash target.');
 if(p.state!=='KNOWN'||!fresh(checkedAt,60000))return fail('Tracked exposure is unresolved or stale. '+p.reasons.join('; '));
 type Seller={id:string;symbol:string;underlying:string;issuer:'ondo'|'bstock';raw:bigint;price:bigint;scale:bigint;cost:number};
 const sellers:Seller[]=[],values=new Map(p.existing.map(l=>[l.instrumentId,BigInt(l.valueAtomic)]));
 for(const v of p.positions.filter(v=>v.rawAtomic!==null&&BigInt(v.rawAtomic)>0n)){
  const i=candidates.find(i=>i.id===v.contract&&i.contract===v.contract),q=quotes.find(q=>q.instrumentId===v.contract),found=marks.items.filter(a=>a.contract===v.contract&&a.issuer===v.issuer),mark=found.length===1?found[0]:null;let reason:string|undefined,price=0n;
  if(!i||i.issuer!==v.issuer||i.underlying!==v.underlying||!m.representationAllowlist?.includes(v.contract))reason='Exact held contract is not selected.';
  else if(!i.researchEligible||i.leveraged&&!m.allowLeveraged)reason='Passport/profile or leverage policy excludes this representation.';
  else if(!q?.available)reason='Synthetic sell quote is unavailable.';
  else if(!Number.isInteger(q.costBps)||q.costBps<0||q.costBps>m.maxCostBps)reason='Synthetic sell cost exceeds the saved limit.';
  else if(!mark||!fresh(marks.observedAt,60000)||!fresh(mark.updatedAt,900000))reason='A fresh raw-token USD mark is unavailable.';
  if(!reason)try{price=parseUnits(mark!.price,18);if(price<=0n||mark!.price!==v.price)throw new Error();}catch{reason='Position and raw-token mark disagree or have invalid precision/value.';}
  if(reason){result.excluded.push({instrumentId:v.contract,symbol:v.symbol,reason});continue;}
  sellers.push({id:v.contract,symbol:v.symbol,underlying:v.underlying,issuer:i!.issuer,raw:BigInt(v.rawAtomic!),price,scale:10n**BigInt(v.decimals),cost:q!.costBps});
 }
 const proceeds=(s:Seller,quantity:bigint)=>{const gross=quantity*s.price/s.scale,fee=ceil(gross*BigInt(s.cost),10000n);return {gross,fee,net:gross-fee};};
 result.maximumNetSaleAtomic=sellers.reduce((a,s)=>a+proceeds(s,s.raw).net,0n).toString();
 const total=p.existing.reduce((a,l)=>a+BigInt(l.valueAtomic),0n)+pending;
 const byIssuer=(after:Map<string,bigint>)=>{const grouped=new Map<string,bigint>();for(const l of p.existing)grouped.set(l.issuer,(grouped.get(l.issuer)??0n)+(after.get(l.instrumentId)??0n));for(const l of p.pending)grouped.set(l.issuer,(grouped.get(l.issuer)??0n)+BigInt(l.valueAtomic));return grouped;};
 const byUnderlying=(after:Map<string,bigint>)=>{const grouped=new Map<string,bigint>();for(const l of p.existing)grouped.set(l.underlying,(grouped.get(l.underlying)??0n)+(after.get(l.instrumentId)??0n));for(const l of p.pending)grouped.set(l.underlying,(grouped.get(l.underlying)??0n)+BigInt(l.valueAtomic));return grouped;};
 type Model={quantities:Map<string,bigint>;after:Map<string,bigint>;net:bigint;fees:bigint;gross:bigint;covered:bigint;gapAfter:bigint;drift:bigint};
 let best:Model|null=null;const policyFailures=new Set<string>();
 // Binary search the smallest raw quantity meeting a monotone net/removal threshold.
 function smallest(limit:bigint,test:(q:bigint)=>boolean){let lo=0n,hi=limit;while(lo<hi){const mid=(lo+hi)/2n;if(test(mid))hi=mid;else lo=mid+1n;}return lo;}
 function evaluate(order:Seller[]){
  const quantities=new Map<string,bigint>(),after=new Map(values);let net=0n,fees=0n,gross=0n;
  function sell(s:Seller,quantity:bigint){const previous=quantities.get(s.id)??0n,next=previous+quantity,a=proceeds(s,previous),b=proceeds(s,next);quantities.set(s.id,next);after.set(s.id,(s.raw-next)*s.price/s.scale);net+=b.net-a.net;fees+=b.fee-a.fee;gross+=b.gross-a.gross;}
  for(const s of order){if(net>=need)break;const required=need-net,full=proceeds(s,s.raw).net;if(full<=0n)continue;const quantity=full<required?s.raw:smallest(s.raw,q=>proceeds(s,q).net>=required);sell(s,quantity);}
  // Cash already covers the payout: no investment change or issuer repair is needed.
  if(need>0n){
   if(m.maxIssuerBps<5000){if(pending>0n){policyFailures.add('A sell-only model cannot retain fixed pending exposure with a two-issuer cap below 50%.');return;}for(const s of order)sell(s,s.raw-(quantities.get(s.id)??0n));if([...after.values()].some(v=>v>0n)){policyFailures.add('The issuer cap below 50% requires complete liquidation, including excluded holdings.');return;}}
   for(let step=0;step<128;step++){
    const grouped=byIssuer(after),remaining=[...grouped.values()].reduce((a,b)=>a+b,0n),violated=[...grouped].filter(([,v])=>v*10000n>remaining*BigInt(m.maxIssuerBps)).sort(([a],[b])=>a.localeCompare(b));if(!violated.length)break;
    const [issuer,value]=violated[0],remove=ceil(value*10000n-remaining*BigInt(m.maxIssuerBps),10000n-BigInt(m.maxIssuerBps));let progress=false;
    for(const s of order.filter(s=>s.issuer===issuer)){const sold=quantities.get(s.id)??0n,left=s.raw-sold,old=after.get(s.id)??0n;if(left===0n||old===0n)continue;const reduction=(q:bigint)=>old-(left-q)*s.price/s.scale,quantity=old<remove?left:smallest(left,q=>reduction(q)>=remove);if(quantity>0n){sell(s,quantity);progress=true;break;}}
    if(!progress){policyFailures.add('Remaining holdings and fixed pending exposure cannot meet the issuer limit using permitted sales.');return;}
    if(step===127){policyFailures.add('Issuer repair did not converge within the 128-step research bound.');return;}
   }
  }
  const covered=min(wanted,max(balance+net-floor,0n)),gapAfter=max(floor-balance-net,0n),groups=byUnderlying(after),afterTotal=[...groups.values()].reduce((a,b)=>a+b,0n);let drift=0n;
  for(const [underlying,value] of groups){const delta=value*10000n-afterTotal*BigInt(m.allocations.find(a=>a.underlying===underlying)?.weightBps??0);drift+=delta<0n?-delta:delta;}
  const model={quantities,after,net,fees,gross,covered,gapAfter,drift};
  if(!best||covered>best.covered||covered===best.covered&&(gapAfter<best.gapAfter||gapAfter===best.gapAfter&&(fees<best.fees||fees===best.fees&&(gross<best.gross||gross===best.gross&&drift<best.drift))))best=model;
 }
 const baseGroups=byUnderlying(values),baseIssuers=byIssuer(values),overweight=(s:Seller)=>(baseGroups.get(s.underlying)??0n)*10000n-total*BigInt(m.allocations.find(a=>a.underlying===s.underlying)?.weightBps??0),issuerWeight=(s:Seller)=>baseIssuers.get(s.issuer)??0n,compareBig=(a:bigint,b:bigint)=>a===b?0:a>b?-1:1;
 const strategies=[(a:Seller,b:Seller)=>a.cost-b.cost,(a:Seller,b:Seller)=>compareBig(overweight(a),overweight(b))||a.cost-b.cost,(a:Seller,b:Seller)=>compareBig(issuerWeight(a),issuerWeight(b))||a.cost-b.cost,(a:Seller,b:Seller)=>a.id.localeCompare(b.id)];
 const orders=new Set<string>();if(!sellers.length)evaluate([]);for(const comparator of strategies){const sorted=[...sellers].sort((a,b)=>comparator(a,b)||a.id.localeCompare(b.id));for(let n=0;n<sorted.length;n++){const order=[...sorted.slice(n),...sorted.slice(0,n)],key=order.map(s=>s.id).join(',');if(!orders.has(key)){orders.add(key);evaluate(order);}}}
 if(!best)return fail([...policyFailures].sort().join(' ')||'No permitted sale model is available under the saved rules.');
 const chosen=best as Model,before=balance+chosen.net,afterTotal=[...chosen.after.values()].reduce((a,b)=>a+b,0n)+pending;
 result.status=chosen.covered===wanted&&chosen.gapAfter===0n?'feasible':'shortfall';result.netSaleAtomic=chosen.net.toString();result.feeAtomic=chosen.fees.toString();result.grossSaleAtomic=chosen.gross.toString();result.modeledPayoutAtomic=chosen.covered.toString();result.shortfallAtomic=(wanted-chosen.covered).toString();result.protectionGapAfterAtomic=chosen.gapAfter.toString();result.projectedCashBeforePayoutAtomic=before.toString();result.projectedCashAfterPayoutAtomic=(before-chosen.covered).toString();result.remainingExposureAtomic=afterTotal.toString();
 result.legs=sellers.filter(s=>(chosen.quantities.get(s.id)??0n)>0n).sort((a,b)=>a.id.localeCompare(b.id)).map(s=>{const quantity=chosen.quantities.get(s.id)!,v=proceeds(s,quantity);return {side:'SELL',instrumentId:s.id,symbol:s.symbol,underlying:s.underlying,issuer:s.issuer,quantityAtomic:quantity.toString(),tokenDecimals:Number(s.scale.toString().length-1),markNotionalAtomic:v.gross.toString(),feeAtomic:v.fee.toString(),cashAtomic:v.net.toString(),costBps:s.cost,funding:'modeled-sale-proceeds'} satisfies RebalanceLeg;});
 const groups=byUnderlying(chosen.after),keys=[...new Set([...m.allocations.map(a=>a.underlying),...groups.keys()])].sort();result.remaining=keys.map(underlying=>({underlying,heldAtomic:p.existing.filter(l=>l.underlying===underlying).reduce((a,l)=>a+(chosen.after.get(l.instrumentId)??0n),0n).toString(),pendingAtomic:p.pending.filter(l=>l.underlying===underlying).reduce((a,l)=>a+BigInt(l.valueAtomic),0n).toString(),shareBps:afterTotal>0n?Number((groups.get(underlying)??0n)*10000n/afterTotal):null,targetWeightBps:m.allocations.find(a=>a.underlying===underlying)?.weightBps??0}));
 result.issuerExposure=[...byIssuer(chosen.after)].filter(([,v])=>v>0n).sort(([a],[b])=>a.localeCompare(b)).map(([issuer,value])=>({issuer,exposureAtomic:value.toString(),shareBps:afterTotal>0n?Number(value*10000n/afterTotal):0}));
 result.reasons.push('Saved protections and pending cash holds remain separate from the requested payout. Pending positions are fixed and cannot be sold.','USD marks and modeled USDT proceeds assume nominal 1:1 parity. Sell costs are synthetic estimates; executable liquidity, slippage, gas and taxes are not included.');
 if(chosen.net>need)result.reasons.push('Raw-token rounding or issuer limits require selling more than the minimum cash gap. Extra proceeds remain as projected wallet cash.');
 if(need===0n)result.reasons.push('Available wallet cash covers this target without modeled sales. Existing investment weights and issuer shares are unchanged.');
 if(chosen.gapAfter>0n)result.reasons.push('Permitted proceeds cannot fully restore saved protections and holds; no modeled payout uses protected cash.');
 if(result.status==='shortfall')result.reasons.push('The requested payout is not fully covered by available cash and permitted modeled net proceeds.');
 if(result.legs.length)result.reasons.push('Wait for sales to settle and refresh capital before considering any payout. Modeled proceeds are not available wallet cash.');
 return result;
}
