import {describe,it,expect} from 'vitest';
import {allocate,parseUnits,formatUnits,capitalProtection,previewInvestment,previewRebalance,previewCashRaising,assessPortfolio} from '@mandate/core';
import {uiAmount} from '@mandate/connectors';
import {accountingInputs,contract,definitions,generator,invariantTime as now,unit} from './fixtures/accounting.ts';

describe('COR-10 seeded accounting and policy properties',()=>{
 it('round-trips unsigned atomic units across every supported precision',()=>{
  const next=generator(1001);for(let decimals=0;decimals<=36;decimals++)for(let n=0;n<32;n++){
   const amount=BigInt(next(1000000))*10n**BigInt(next(60))+BigInt(next(1000000));
   expect(parseUnits(formatUnits(amount,decimals),decimals)).toBe(amount);
  }
 });
 it('conserves allocation units with exact floor/ceiling bounds and stable ties',()=>{
  const next=generator(1002);for(let n=0;n<256;n++){
   const a=1+next(9997),b=1+next(9999-a),weights=[a,b,10000-a-b];
   const total=BigInt(next(1000000))*10n**BigInt(next(45))+BigInt(next(100));
   const parts=allocate(total,weights);expect(parts.reduce((s,v)=>s+v,0n)).toBe(total);
   parts.forEach((v,i)=>{expect(v).toBeGreaterThanOrEqual(total*BigInt(weights[i])/10000n);expect(v).toBeLessThanOrEqual((total*BigInt(weights[i])+9999n)/10000n);});
   expect(allocate(total,weights)).toEqual(parts);
  }
  expect(allocate(1n,[5000,5000])).toEqual([1n,0n]);
 });
 it('covers reserve-linked obligations once and adds independent protections exactly',()=>{
  const next=generator(1003);for(let n=0;n<256;n++){
   const floor=BigInt(next(100000)),covered=BigInt(next(100000)),extra=BigInt(next(100000)),operating=BigInt(next(100000));
   const policy={reserveFloor:formatUnits(floor,18),operatingBudget:formatUnits(operating,18),obligations:[{id:'covered',label:'Covered',amount:formatUnits(covered,18),coverage:'reserve' as const},{id:'extra',label:'Extra',amount:formatUnits(extra,18),coverage:'additional' as const}]};
   expect(BigInt(capitalProtection(policy,18).protectedAtomic)).toBe((floor>covered?floor:covered)+extra+operating);
   expect(capitalProtection({...policy,obligations:[...policy.obligations].reverse()},18)).toEqual(capitalProtection(policy,18));
  }
 });
 it('floors issuer multipliers without manufacturing an adjusted atomic unit',()=>{
  const next=generator(1004);for(let n=0;n<256;n++){
   const raw=BigInt(next(1000000))*unit+BigInt(next(10000)),multiplier=BigInt(1+next(1000000))*10n**12n;
   const adjusted=uiAmount(raw,multiplier);expect(adjusted*unit).toBeLessThanOrEqual(raw*multiplier);expect((adjusted+1n)*unit).toBeGreaterThan(raw*multiplier);
  }
 });
 it('preserves cash and caps allocation across protections, holds, fees and dust',()=>{
  const next=generator(1005);for(let n=0;n<128;n++){
   const balance=BigInt(next(100000))*unit+BigInt(next(100)),protection=BigInt(next(60000))*unit,held=BigInt(next(10000))*unit,cap=BigInt(next(50000))*unit+1n;
   const i=accountingInputs({},balance,protection,held,'1',next(31)),before=JSON.stringify(i);
   const r=previewInvestment(i.mandate,i.candidates,i.quotes,now,i.funding,i.portfolio,cap.toString()),free=balance>protection+held?balance-protection-held:0n,budget=free<cap?free:cap;
   expect(BigInt(r.investableAtomic)).toBe(budget);expect(BigInt(r.balanceAtomic)).toBe(balance);
   const gross=r.legs.reduce((s,l)=>s+BigInt(l.grossAtomic),0n);expect(gross+BigInt(r.unallocatedAtomic)).toBe(budget);
   for(const l of r.legs)expect(BigInt(l.netExposureAtomic)+BigInt(l.modeledCostAtomic)).toBe(BigInt(l.grossAtomic));
   expect(r.executable).toBe(false);expect(JSON.stringify(i)).toBe(before);
   expect(previewInvestment(i.mandate,i.candidates,i.quotes,now,i.funding,i.portfolio,cap.toString())).toEqual(r);
  }
 });
 it('checks issuer caps with exact integers including existing and pending exposure',()=>{
  const next=generator(1006);let feasible=0,infeasible=0;for(let n=0;n<96;n++){
   const i=accountingInputs({SPYon:BigInt(next(200))*unit},100n*unit,0n,10n*unit);
   i.portfolio.pending=[{instrumentId:contract('SPYon'),symbol:'SPYon',issuer:'ondo',underlying:'SPY',valueAtomic:(BigInt(next(200))*unit).toString()}];i.mandate.maxIssuerBps=5000+next(5001);
   const r=previewInvestment(i.mandate,i.candidates,i.quotes,now,i.funding,i.portfolio);
   if(r.status==='feasible'){feasible++;const total=r.issuerExposure.reduce((s,e)=>s+BigInt(e.exposureAtomic),0n);for(const e of r.issuerExposure)expect(BigInt(e.exposureAtomic)*10000n).toBeLessThanOrEqual(total*BigInt(i.mandate.maxIssuerBps));}
   else{infeasible++;expect(r.legs).toHaveLength(0);expect(r.reasons.length).toBeGreaterThan(0);}
  }expect(feasible).toBeGreaterThan(0);expect(infeasible).toBeGreaterThan(0);
 });
 it('never interprets a positive stale/missing position as zero',()=>{
  const i=accountingInputs({SPYon:1n},unit,0n,0n);
  for(const kind of ['old-mark','old-response','future-mark','missing-mark','duplicate-mark'] as const){
   const marks=structuredClone(i.marks),mark=marks.items.find(m=>m.contract===contract('SPYon'))!;
   if(kind==='old-mark')mark.updatedAt=new Date(now.getTime()-900001).toISOString();
   if(kind==='old-response')marks.observedAt=new Date(now.getTime()-60001).toISOString();
   if(kind==='future-mark')mark.updatedAt=new Date(now.getTime()+1).toISOString();
   if(kind==='missing-mark')marks.items=marks.items.filter(m=>m!==mark);
   if(kind==='duplicate-mark')marks.items.push({...mark});
   const p=assessPortfolio(i.checkpoint,definitions,marks,[],now.getTime());expect(p.state).toBe('UNKNOWN');expect(p.positions.find(p=>p.contract===mark.contract)?.valueAtomic).toBeNull();
   expect(previewInvestment(i.mandate,i.candidates,i.quotes,now,i.funding,p).legs).toHaveLength(0);
   expect(previewRebalance({...i,marks,portfolio:p},true,now).status).toBe('blocked');expect(previewCashRaising({...i,marks,portfolio:p},'1',now).shortfallAtomic).toBeNull();
  }
 });
 it('keeps submitted pending exposure unresolved across every planner',()=>{
  const i=accountingInputs({SPYon:unit},100n*unit,0n,10n*unit);
  const pending=[{planId:'uncertain',reservationId:'held',amountAtomic:(10n*unit).toString(),submissionStarted:true,model:{currency:'USD-nominal-USDT-parity' as const,legs:[{instrumentId:contract('SPYon'),underlying:'SPY',issuer:'ondo' as const,valueAtomic:(10n*unit).toString()}]}}];
  const p=assessPortfolio(i.checkpoint,definitions,i.marks,pending,now.getTime());expect(p.state).toBe('UNKNOWN');expect(p.pending).toHaveLength(0);
  expect(previewInvestment(i.mandate,i.candidates,i.quotes,now,i.funding,p).status).toBe('infeasible');expect(previewRebalance({...i,portfolio:p},true,now).status).toBe('blocked');expect(previewCashRaising({...i,portfolio:p},'1',now).status).toBe('blocked');
 });
 it('conserves modeled cash in net cash raising and bounds every sale by raw holdings',()=>{
  const next=generator(1007);for(let n=0;n<96;n++){
   const i=accountingInputs({SPYon:BigInt(1+next(80))*unit+BigInt(next(100)),NVDAon:BigInt(1+next(80))*unit},BigInt(next(50))*unit,BigInt(next(40))*unit,BigInt(next(10))*unit,'1.123456789123456789',next(31)),before=JSON.stringify(i),target=BigInt(1+next(200))*unit+1n;
   const r=previewCashRaising(i,formatUnits(target,18),now);expect(['feasible','shortfall']).toContain(r.status);
   const gross=r.legs.reduce((s,l)=>s+BigInt(l.markNotionalAtomic),0n),fee=r.legs.reduce((s,l)=>s+BigInt(l.feeAtomic),0n),net=r.legs.reduce((s,l)=>s+BigInt(l.cashAtomic),0n);
   expect(gross).toBe(BigInt(r.grossSaleAtomic));expect(fee).toBe(BigInt(r.feeAtomic));expect(net+fee).toBe(gross);
   expect(BigInt(r.projectedCashAfterPayoutAtomic!)+BigInt(r.modeledPayoutAtomic!)).toBe(BigInt(i.funding.balanceAtomic)+net);
   expect(BigInt(r.shortfallAtomic!)+BigInt(r.modeledPayoutAtomic!)).toBe(target);
   const after=BigInt(r.projectedCashAfterPayoutAtomic!),floor=BigInt(i.funding.protectedAtomic)+BigInt(i.funding.heldAtomic);
   expect(BigInt(r.protectionGapAfterAtomic!)).toBe(after<floor?floor-after:0n);if(after<floor)expect(r.modeledPayoutAtomic).toBe('0');
   for(const l of r.legs){expect(BigInt(l.quantityAtomic)).toBeLessThanOrEqual(BigInt(i.checkpoint.positions.find(p=>p.contract===l.instrumentId)!.rawAtomic!));expect(BigInt(l.feeAtomic)).toBe((BigInt(l.markNotionalAtomic)*BigInt(l.costBps)+9999n)/10000n);}
   expect(r.executable).toBe(false);expect(JSON.stringify(i)).toBe(before);
  }
 });
 it('conserves rebalance cash, preserves protections and accounts for sale-funded buys',()=>{
  const next=generator(1008);let completed=0;for(let n=0;n<64;n++){
   const protection=BigInt(next(20))*unit,held=BigInt(next(10))*unit;
   const i=accountingInputs({SPYon:BigInt(1+next(100))*unit,NVDAon:BigInt(1+next(100))*unit},protection+held+BigInt(next(30))*unit,protection,held,'1.123456789123456789',next(31)),before=JSON.stringify(i);
   const r=previewRebalance(i,n%2===0,now);if(r.status==='blocked'){expect(r.legs).toHaveLength(0);continue;}completed++;
   const sells=r.legs.filter(l=>l.side==='SELL'),buys=r.legs.filter(l=>l.side==='BUY'),sale=sells.reduce((s,l)=>s+BigInt(l.cashAtomic),0n),purchase=buys.reduce((s,l)=>s+BigInt(l.cashAtomic),0n);
   expect(BigInt(r.projectedCashAtomic!)).toBe(BigInt(i.funding.balanceAtomic)+sale-purchase);expect(BigInt(r.projectedCashAtomic!)).toBeGreaterThanOrEqual(protection+held);
   expect(BigInt(r.feeAtomic)).toBe(r.legs.reduce((s,l)=>s+BigInt(l.feeAtomic),0n));for(const l of sells)expect(BigInt(l.quantityAtomic)).toBeLessThanOrEqual(BigInt(i.checkpoint.positions.find(p=>p.contract===l.instrumentId)!.rawAtomic!));
   if(purchase>BigInt(r.availableCashAtomic))expect(buys.some(l=>l.funding==='requires-sale-settlement')).toBe(true);
   expect(r.executable).toBe(false);expect(JSON.stringify(i)).toBe(before);
  }expect(completed).toBeGreaterThan(32);
 });
});
