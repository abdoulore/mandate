import {z} from 'zod';
export const passportPolicySchema=z.object({allowLeveraged:z.boolean(),requireDirectOwnership:z.boolean()}).strict();
export type PassportPolicy=z.infer<typeof passportPolicySchema>;
export type PassportFact={value:string;source:string;scope:'issuer-program'|'underlying';checkedAt:string;effectiveAt:null};
export type InstrumentPassport={symbol:string;underlying:string;issuer:'ondo'|'bstock';chainId:56;contract:string;category:string;leveraged:boolean|null;leverageSource:string|null;directOwnership:false;facts:{issuer:PassportFact;exposure:PassportFact;accounting:PassportFact;rights:PassportFact;access:PassportFact};unknowns:string[];profile:{state:'OBSERVED'|'UNKNOWN'|'STALE';observedAt:string|null;underlyingName:string|null;tokenToShareRatio:string|null;reason:string|null};executionAllowed:false};
export type PassportCatalogue={schemaVersion:'1.0';checkedAt:string;items:InstrumentPassport[]};
export function evaluatePassport(passport:InstrumentPassport,policy:PassportPolicy){
 const reasons:string[]=[];
 if(passport.profile.state!=='OBSERVED')reasons.push('Current token-to-underlying profile is '+passport.profile.state.toLowerCase());
 if(!policy.allowLeveraged&&passport.leveraged!==false)reasons.push(passport.leveraged?'Leveraged exposure is excluded by policy':'Leverage classification is unknown');
 if(policy.requireDirectOwnership&&!passport.directOwnership)reasons.push('Token does not provide direct ownership of underlying shares');
 return {symbol:passport.symbol,researchEligible:reasons.length===0,reasons,executionAllowed:false as const};
}
