import {exposureModelSchema,type CapitalCheckpoint,type InstrumentPassport,type MarketMarks,type PendingExposure,type PortfolioExposure,type ExposureLeg} from '@mandate/domain';
import {parseUnits} from './money.ts';
const scope='14 tracked tokenized instruments + unsubmitted pending plans; cash and untracked wallet assets excluded';
export function assessPortfolio(checkpoint:CapitalCheckpoint|null,instruments:Pick<InstrumentPassport,'symbol'|'contract'|'issuer'|'underlying'>[],marks:MarketMarks,pending:PendingExposure[]=[],now=Date.now()):PortfolioExposure{
 const reasons:string[]=[],existing:ExposureLeg[]=[],queued:ExposureLeg[]=[];
 const positions=instruments.map(i=>{
  const matches=checkpoint?.positions.filter(p=>p.contract===i.contract)??[],p=matches.length===1?matches[0]:undefined;
  const base={contract:i.contract,symbol:i.symbol,issuer:i.issuer,underlying:i.underlying,rawAtomic:p?.rawAtomic??null,decimals:p?.decimals??18,valueAtomic:null as string|null,price:null as string|null,priceUpdatedAt:null as string|null,markState:'UNKNOWN' as 'UNKNOWN'|'ZERO'|'FRESH'|'STALE'};
  if(!p||p.rawAtomic===null||p.state==='UNKNOWN'||p.accountingVersion==='unknown'||p.symbol.toUpperCase()!==i.symbol.toUpperCase()){reasons.push(i.symbol+': position observation is missing or unverified');return base;}
  if(BigInt(p.rawAtomic)===0n){base.valueAtomic='0';base.markState='ZERO';return base;}
  const found=marks.items.filter(m=>m.contract===i.contract&&m.issuer===i.issuer),m=found.length===1?found[0]:undefined;
  const age=m?now-Date.parse(m.updatedAt):Infinity,responseAge=now-Date.parse(marks.observedAt);
  if(!m||!Number.isFinite(age)||age<0||age>900000||!Number.isFinite(responseAge)||responseAge<0||responseAge>60000){base.markState=m?'STALE':'UNKNOWN';base.priceUpdatedAt=m?.updatedAt??null;reasons.push(i.symbol+': a fresh token mark is unavailable');return base;}
  try{const price=parseUnits(m.price,18);if(price<=0n)throw new Error();const value=BigInt(p.rawAtomic)*price/10n**BigInt(p.decimals);base.valueAtomic=value.toString();base.price=m.price;base.priceUpdatedAt=m.updatedAt;base.markState='FRESH';existing.push({instrumentId:i.contract,symbol:i.symbol,issuer:i.issuer,underlying:i.underlying,valueAtomic:value.toString()});return base;}
  catch{reasons.push(i.symbol+': token mark has invalid precision or value');return base;}
 });
 for(const p of pending){const model=exposureModelSchema.safeParse(p.model);if(p.submissionStarted||!model.success){reasons.push('Pending plan '+p.planId+': issuer exposure is unresolved'+(p.submissionStarted?'; submission may already affect holdings':''));continue;}
  const total=model.data.legs.reduce((n,l)=>n+BigInt(l.valueAtomic),0n);if(total>BigInt(p.amountAtomic)){reasons.push('Pending plan '+p.planId+': exposure exceeds its reservation');continue;}
  for(const l of model.data.legs){const i=instruments.find(i=>i.contract===l.instrumentId&&i.issuer===l.issuer&&i.underlying===l.underlying);if(!i){reasons.push('Pending plan '+p.planId+': representation identity is unverified');continue;}queued.push({...l,symbol:i.symbol});}
 }
 function grouped(key:'issuer'|'underlying'){const keys=[...new Set([...existing,...queued].map(l=>l[key]))].sort();return keys.map(k=>({key:k,existingAtomic:existing.filter(l=>l[key]===k).reduce((n,l)=>n+BigInt(l.valueAtomic),0n).toString(),pendingAtomic:queued.filter(l=>l[key]===k).reduce((n,l)=>n+BigInt(l.valueAtomic),0n).toString()}));}
 return {state:reasons.length?'UNKNOWN':'KNOWN',decimals:18,currency:'USD-nominal-USDT-parity',checkedAt:new Date(now).toISOString(),scope,reasons,positions,existing,pending:queued,pendingCount:pending.length,byIssuer:grouped('issuer').map(g=>({issuer:g.key,existingAtomic:g.existingAtomic,pendingAtomic:g.pendingAtomic})),byUnderlying:grouped('underlying').map(g=>({underlying:g.key,existingAtomic:g.existingAtomic,pendingAtomic:g.pendingAtomic}))};
}
