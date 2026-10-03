import type {CapitalView,SavedInvestmentMandate} from '@mandate/domain';
import {parseUnits} from '@mandate/core';
import {PANCAKE_V3} from './pancake-direct.ts';
import type {readDirectPreflight} from './direct-preflight.ts';

type Route=Awaited<ReturnType<typeof readDirectPreflight>>;
const unit=10n**18n;
const validAtomic=(value:string)=>/^[1-9]\d*$/.test(value);

// A saved research mandate can be compared with a real route, but that
// comparison never authorizes a transaction or creates a spending permission.
export function reviewDirectMandate(mandate:SavedInvestmentMandate|null,capital:CapitalView,route:Route,requestedAtomic:string,now=Date.now()){
 const reasons:string[]=[];
 if(!mandate)reasons.push('SAVED_MANDATE_REQUIRED');
 if(capital.state!=='OBSERVED'||!capital.checkpoint||capital.policyRevision<1)reasons.push('FRESH_PROTECTED_CAPITAL_REQUIRED');
 if(!capital.portfolio||capital.portfolio.state!=='KNOWN')reasons.push('PORTFOLIO_EXPOSURE_UNKNOWN');
 if(!validAtomic(requestedAtomic)||BigInt(requestedAtomic)>10n*unit)reasons.push('AMOUNT_OUT_OF_SCOPE');
 else if(BigInt(capital.availableAtomic)<BigInt(requestedAtomic))reasons.push('PROTECTED_CASH_INSUFFICIENT');
 if(mandate&&mandate.accountId!==capital.accountId)reasons.push('MANDATE_ACCOUNT_MISMATCH');
 if(mandate&&!mandate.policy.representationAllowlist.includes(PANCAKE_V3.spyOn.toLowerCase()))reasons.push('REPRESENTATION_NOT_ALLOWED');
 const target=mandate?.policy.allocations.find(a=>a.underlying==='SPY');
 if(!target)reasons.push('SPY_NOT_IN_ALLOCATION');
 const routeAge=now-Date.parse(route.checkedAt);
 if(!Number.isFinite(routeAge)||routeAge<0||routeAge>10000)reasons.push('ROUTE_CHECK_STALE');
 if(route.direction!=='BUY'||route.assetIn.toLowerCase()!==PANCAKE_V3.usdt.toLowerCase()||route.assetOut.toLowerCase()!==PANCAKE_V3.spyOn.toLowerCase()||route.router.toLowerCase()!==PANCAKE_V3.router.toLowerCase()||route.amountInAtomic!==requestedAtomic)reasons.push('ROUTE_IDENTITY_MISMATCH');
 if(!validAtomic(route.quotedOutAtomic)||!validAtomic(route.minimumOutAtomic)||BigInt(route.minimumOutAtomic)>BigInt(route.quotedOutAtomic))reasons.push('ROUTE_OUTPUT_INVALID');
 for(const gate of ['poolIdentity','calldataMeaning','referenceCost','funds','spendingPermission','gas'] as const)if(route.gates[gate]!=='CHECKED')reasons.push('ROUTE_'+gate.toUpperCase()+'_BLOCKED');
 if(route.gates.simulation!=='PASSED')reasons.push('ROUTE_SIMULATION_NOT_PASSED');
 let worstCaseCostBps:string|null=null;
 try{
  const price=parseUnits(route.reference.price??'',18),minimum=BigInt(route.minimumOutAtomic),amount=BigInt(requestedAtomic);
  const fairCash=minimum*price/unit;
  const referenceAge=now-Date.parse(route.reference.updatedAt??'');
  if(price<=0n||minimum<=0n||fairCash<=0n||!Number.isFinite(referenceAge)||referenceAge< -10000||referenceAge>300000)throw new Error();
  const adverse=amount>fairCash?((amount-fairCash)*10000n+fairCash-1n)/fairCash:0n;
  worstCaseCostBps=adverse.toString();
  if(mandate&&adverse>BigInt(mandate.policy.maxCostBps))reasons.push('MANDATE_COST_LIMIT');
 }catch{reasons.push('REFERENCE_COST_UNKNOWN');}
 if(capital.portfolio?.state==='KNOWN'&&mandate&&target&&validAtomic(requestedAtomic)){
  const amount=BigInt(requestedAtomic),legs=[...capital.portfolio.existing,...capital.portfolio.pending];
  const total=legs.reduce((n,leg)=>n+BigInt(leg.valueAtomic),0n)+amount;
  const spy=legs.filter(leg=>leg.underlying==='SPY').reduce((n,leg)=>n+BigInt(leg.valueAtomic),0n)+amount;
  const ondo=legs.filter(leg=>leg.issuer==='ondo').reduce((n,leg)=>n+BigInt(leg.valueAtomic),0n)+amount;
  if(spy*10000n>total*BigInt(target.weightBps))reasons.push('ALLOCATION_LIMIT');
  if(ondo*10000n>total*BigInt(mandate.policy.maxIssuerBps))reasons.push('ISSUER_LIMIT');
 }
 return {state:reasons.length?'BLOCKED' as const:'POLICY_CHECKED' as const,executionAllowed:false,authorizationRequested:false,mandateId:mandate?.id??null,mandateRevision:mandate?.revision??null,cashPolicyRevision:capital.policyRevision,capitalCheckpointId:capital.checkpointId,routeBlockNumber:route.blockNumber,routeCheckedAt:route.checkedAt,requestedAtomic,worstCaseCostBps,reasons};
}
