import {assessPortfolio,defaultMandate} from '@mandate/core';
import type {ResearchProposal,CapitalCheckpoint} from '@mandate/domain';
import {passportDefinitions} from '../../apps/api/src/passports.ts';

export const invariantTime=new Date('2026-09-27T12:00:00.000Z');
export const unit=10n**18n;
export const definitions=passportDefinitions();
export const contract=(symbol:string)=>definitions.find(p=>p.symbol===symbol)!.contract;
// Fixed seeds make a failing case reproducible without network or secrets.
export function generator(seed:number){let state=seed>>>0;return (limit:number)=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%limit;};}
export function accountingInputs(raw:Record<string,bigint>,cash:bigint,protectedCash:bigint,held:bigint,price='1',cost=10):ResearchProposal['inputs']{
 const checkpoint:CapitalCheckpoint={accountId:'invariant',wallet:'0x'+'1'.repeat(40),asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:cash.toString(),blockNumber:'100',blockHash:'0x'+'2'.repeat(64),observedAt:invariantTime.toISOString(),evidenceMode:'observed',positions:definitions.map(p=>({contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:(raw[p.symbol]??0n).toString(),multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1',state:'OBSERVED'}))};
 const marks={source:'synthetic invariant fixtures',observedAt:invariantTime.toISOString(),items:definitions.map(p=>({contract:p.contract,issuer:p.issuer,price,updatedAt:invariantTime.toISOString()}))};
 const candidates=definitions.map(p=>({id:p.contract,contract:p.contract,name:p.symbol,underlying:p.underlying,issuer:p.issuer,category:p.category,accounting:'raw',leveraged:false,evidenceMode:'research' as const,executionCertified:false as const,researchEligible:true}));
 return {cashPolicyRevision:0,cashPolicy:{reserveFloor:'0',operatingBudget:'0',obligations:[]},mandate:{...defaultMandate,allocations:[{underlying:'SPY',weightBps:5000},{underlying:'NVDA',weightBps:5000}],maxIssuerBps:10000,maxCostBps:30,representationAllowlist:definitions.map(p=>p.contract)},funding:{accountId:'invariant',accountRevision:1,checkpointId:'c',blockNumber:'100',observedAt:invariantTime.toISOString(),balanceAtomic:cash.toString(),protectedAtomic:protectedCash.toString(),heldAtomic:held.toString(),decimals:18},checkpoint,marks,portfolio:assessPortfolio(checkpoint,definitions,marks,[],invariantTime.getTime()),pending:[],candidates,quotes:candidates.map(i=>({instrumentId:i.id,costBps:cost,available:true,evidenceMode:'synthetic' as const})),passports:{schemaVersion:'1.0',checkedAt:invariantTime.toISOString(),items:[]}};
}
