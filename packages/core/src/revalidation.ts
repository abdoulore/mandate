import type {ResearchProposal,ProposalChange,ProposalComparison} from '@mandate/domain';
import {formatUnits} from './money.ts';
const stable=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const ordered=(items:{instrumentId:string}[])=>[...items].sort((a,b)=>a.instrumentId.localeCompare(b.instrumentId));
export function compareResearchProposals(before:ResearchProposal,after:ResearchProposal):ProposalComparison{
 if(before.accountId!==after.accountId)throw new Error('PROPOSAL_ACCOUNT_MISMATCH');
 const changes:ProposalChange[]=[];
 function add(category:ProposalChange['category'],label:string,a:unknown,b:unknown){if(stable(a)!==stable(b))changes.push({category,label,before:typeof a==='string'?a:stable(a)??'Unknown',after:typeof b==='string'?b:stable(b)??'Unknown'});}
 const unit=(v:string,decimals=18)=>formatUnits(BigInt(v),decimals);
 add('mandate','Saved mandate revision',before.mandateRevision,after.mandateRevision);
 for(const [key,label] of [['maxIssuerBps','Issuer limit · bps'],['maxCostBps','Cost limit · bps'],['allowLeveraged','Leverage allowed'],['allocations','Target weights']] as const)add('mandate',label,before.inputs.mandate[key],after.inputs.mandate[key]);
 add('mandate','Exact permitted contracts',[...(before.inputs.mandate.representationAllowlist??[])].sort(),[...(after.inputs.mandate.representationAllowlist??[])].sort());
 add('quotes','Scenario conditions',before.scenario,after.scenario);
 const source=(p:ResearchProposal)=>{if(!p.inputs.inflowProof)return null;const {observedAt,headHash,headNumber,...facts}=p.inputs.inflowProof;return facts;};
 add('cash','Incoming receipt facts',source(before),source(after));
 add('cash','Inflow allocation cap · atomic USDT',before.inputs.allocationBudgetCapAtomic??null,after.inputs.allocationBudgetCapAtomic??null);
 add('cash','Saved cash rules',before.inputs.cashPolicy,after.inputs.cashPolicy);
 for(const [key,label] of [['balanceAtomic','Observed cash · USDT'],['protectedAtomic','Protected cash · USDT'],['heldAtomic','Pending cash holds · USDT']] as const)add('cash',label,unit(before.inputs.funding[key],before.inputs.funding.decimals),unit(after.inputs.funding[key],after.inputs.funding.decimals));
 const pending=(p:ResearchProposal)=>p.inputs.pending?[...p.inputs.pending].sort((a,b)=>a.reservationId.localeCompare(b.reservationId)):null;
 add('pending','Pending plans and submission uncertainty',pending(before),pending(after));
 const positions=new Set([...before.inputs.checkpoint.positions,...after.inputs.checkpoint.positions].map(p=>p.contract));
 for(const contract of [...positions].sort()){
  const a=before.inputs.checkpoint.positions.find(p=>p.contract===contract),b=after.inputs.checkpoint.positions.find(p=>p.contract===contract),name=b?.symbol??a?.symbol??contract;
  const accounting=(p:typeof a)=>p?{rawAtomic:p.rawAtomic,decimals:p.decimals,multiplierAtomic:p.multiplierAtomic,accountingVersion:p.accountingVersion,state:p.state??'OBSERVED'}:null;
  add('holdings',name+' position accounting',accounting(a),accounting(b));
  const mark=(p:ResearchProposal)=>{const m=p.inputs.marks?.items.find(m=>m.contract===contract),v=p.inputs.portfolio.positions.find(v=>v.contract===contract);return {price:m?.price??v?.price??null,state:v?.markState??'UNKNOWN',valueUSD:v?.valueAtomic===null||v?.valueAtomic===undefined?null:unit(v.valueAtomic)};};
  add('market',name+' USD research mark',mark(before),mark(after));
 }
 add('market','Market observation source',before.inputs.marks?.source??'Unknown',after.inputs.marks?.source??'Unknown');
 const passport=(p:ResearchProposal)=>p.inputs.passports?.items.map(i=>({contract:i.contract,leveraged:i.leveraged,profile:{state:i.profile.state,ratio:i.profile.tokenToShareRatio,name:i.profile.underlyingName},facts:Object.fromEntries(Object.entries(i.facts).map(([k,v])=>[k,{value:v.value,source:v.source,scope:v.scope,effectiveAt:v.effectiveAt}]))})).sort((a,b)=>a.contract.localeCompare(b.contract))??null;
 add('eligibility','Passport observations and rights',passport(before),passport(after));
 const eligibility=(p:ResearchProposal)=>p.inputs.candidates.map(c=>({id:c.id,researchEligible:c.researchEligible??false})).sort((a,b)=>a.id.localeCompare(b.id));
 add('eligibility','Candidate research eligibility',eligibility(before),eligibility(after));
 add('quotes','Synthetic quote inputs',ordered(before.inputs.quotes),ordered(after.inputs.quotes));
 add('allocation','Model outcome',before.result.status,after.result.status);
 add('allocation','Research budget · USDT',unit(before.result.investableAtomic,before.result.decimals),unit(after.result.investableAtomic,after.result.decimals));
 add('allocation','Proposed representations and amounts',ordered(before.result.legs),ordered(after.result.legs));
 add('allocation','Tracked exposure scope',before.inputs.portfolio.scope,after.inputs.portfolio.scope);
 add('allocation','Issuer exposure',[...before.result.issuerExposure].sort((a,b)=>a.issuer.localeCompare(b.issuer)),[...after.result.issuerExposure].sort((a,b)=>a.issuer.localeCompare(b.issuer)));
 add('allocation','Model exclusions',ordered(before.result.excluded),ordered(after.result.excluded));
 add('allocation','Model explanations',before.result.reasons,after.result.reasons);
 return {parentProposalId:before.id,state:changes.length?'CHANGED':'UNCHANGED',changes,note:'Compared recorded research inputs with newly observed inputs. Timestamps and block references alone do not count as financial changes. Costs remain synthetic; revalidation grants no trade permission and releases no holds.'};
}
