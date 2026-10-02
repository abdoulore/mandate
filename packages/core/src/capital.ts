import {capitalPolicySchema,type CapitalPolicy} from '@mandate/domain';
import {parseUnits} from './money.ts';
export function capitalProtection(value:CapitalPolicy,decimals:number){
 const policy=capitalPolicySchema.parse(value),floor=parseUnits(policy.reserveFloor,decimals),operating=parseUnits(policy.operatingBudget,decimals);
 let covered=0n,additional=0n;for(const o of policy.obligations){const amount=parseUnits(o.amount,decimals);if(o.coverage==='reserve')covered+=amount;else additional+=amount;}
 const reserve=floor>covered?floor:covered;
 return {reserveAtomic:reserve.toString(),additionalAtomic:additional.toString(),operatingAtomic:operating.toString(),protectedAtomic:(reserve+additional+operating).toString()};
}
