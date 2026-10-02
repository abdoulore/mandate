import { z } from 'zod';
export * from './records.ts';
export * from './passports.ts';
export * from './capital.ts';
export * from './portfolio.ts';
export * from './recurring.ts';

export const SCHEMA_VERSION = '1.0.0';
export const amountSchema = z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/, 'Use a non-negative amount with up to six decimal places.');
export const issuerSchema = z.enum(['ondo', 'bstock']);
export const mandateSchema = z.object({
  balance: amountSchema, reserveFloor: amountSchema, operatingBudget: amountSchema,
  obligations: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(120), amount: amountSchema })).max(20),
  maxIssuerBps: z.number().int().min(1).max(10000), maxCostBps: z.number().int().min(0).max(1000),
  allowLeveraged: z.boolean(),
  representationAllowlist:z.array(z.string().regex(/^0x[0-9a-f]{40}$/)).max(20).optional(),
  allocations: z.array(z.object({ underlying: z.string().min(1).max(20), weightBps: z.number().int().min(1).max(10000) })).min(1).max(6),
  scenario: z.enum(['normal', 'expensive', 'missing']),
}).superRefine((v, ctx) => {
  if (v.allocations.reduce((n, a) => n + a.weightBps, 0) !== 10000) ctx.addIssue({code:'custom',message:'Allocation weights must total 100%.',path:['allocations']});
  if (new Set(v.allocations.map(x=>x.underlying)).size !== v.allocations.length) ctx.addIssue({code:'custom',message:'Each exposure must appear once.',path:['allocations']});
  if (new Set(v.obligations.map(x=>x.id)).size !== v.obligations.length) ctx.addIssue({code:'custom',message:'Obligation identifiers must be unique.',path:['obligations']});
});
export type MandateInput = z.infer<typeof mandateSchema>;
export const mandateRecordSchema = z.object({schemaVersion:z.literal('1.0.0'),id:z.string().min(1),accountId:z.string().min(1),revision:z.number().int().positive(),createdAt:z.string().datetime(),policy:mandateSchema}).strict();
export type Instrument = { id:string; underlying:string; name:string; issuer:'ondo'|'bstock'; category:string; accounting:string; leveraged:boolean; evidenceMode:'synthetic'|'research'; contract?:string; researchEligible?:boolean; executionCertified:false };
export type ScenarioQuote = { instrumentId:string; costBps:number; available:boolean; reason?:string; evidenceMode:'synthetic' };
export type PlanLeg = { instrumentId:string; underlying:string; issuer:string; grossAtomic:string; netExposureAtomic:string; modeledCostAtomic:string; costBps:number; weightBps:number };
export type PlanResult = { schemaVersion:string; mode:'scenario'; status:'feasible'|'infeasible'; executable:false; createdAt:string; currency:'USDT'; decimals:number; heldAtomic?:string; capitalBasis?:import('./capital.ts').CapitalFunding|null; portfolioBasis?:import('./portfolio.ts').PortfolioExposure; exposureDenominator?:string; balanceAtomic:string; reserveAtomic:string; operatingAtomic:string; investableAtomic:string; unallocatedAtomic:string; modeledCostAtomic:string; legs:PlanLeg[]; issuerExposure:{issuer:string; exposureAtomic:string; shareBps:number}[]; excluded:{instrumentId:string; reason:string}[]; reasons:string[]; decisionId:string };
export const investmentPolicySchema=z.object({allocations:mandateSchema.shape.allocations,maxIssuerBps:mandateSchema.shape.maxIssuerBps,maxCostBps:mandateSchema.shape.maxCostBps,allowLeveraged:z.boolean(),representationAllowlist:z.array(z.string().regex(/^0x[0-9a-f]{40}$/)).max(20),exposureScope:z.literal('tracked-holdings-pending-proposed')}).strict().superRefine((v,ctx)=>{
 if(v.allocations.reduce((n,a)=>n+a.weightBps,0)!==10000||new Set(v.allocations.map(a=>a.underlying)).size!==v.allocations.length)ctx.addIssue({code:'custom',message:'Unique targets must total 100%.'});
 if(new Set(v.representationAllowlist).size!==v.representationAllowlist.length)ctx.addIssue({code:'custom',message:'Representation contracts must be unique.'});
});
export type InvestmentPolicy=z.infer<typeof investmentPolicySchema>;
export type SavedInvestmentMandate={id:string;accountId:string;revision:number;createdAt:string;policy:InvestmentPolicy;researchOnly:true};
export type ProposalChange={category:'mandate'|'cash'|'holdings'|'pending'|'market'|'eligibility'|'quotes'|'allocation';label:string;before:string;after:string};
export type ProposalComparison={parentProposalId:string;state:'UNCHANGED'|'CHANGED';changes:ProposalChange[];note:string};
export type RebalanceDrift={underlying:string;heldAtomic:string;pendingAtomic:string;currentAtomic:string;currentWeightBps:number|null;targetWeightBps:number;driftBps:number|null;afterAtomic:string|null;afterWeightBps:number|null};
export type RebalanceLeg={side:'SELL'|'BUY';instrumentId:string;symbol:string;underlying:string;issuer:'ondo'|'bstock';quantityAtomic:string;tokenDecimals:number;markNotionalAtomic:string;feeAtomic:string;cashAtomic:string;costBps:number;funding:'wallet-cash'|'requires-sale-settlement'|'modeled-sale-proceeds'};
export type RebalanceResult={schemaVersion:'1.0.0';mode:'research';executable:false;status:'feasible'|'blocked'|'unchanged';createdAt:string;decisionId:string;decimals:18;currency:'USD-nominal-USDT-parity';scope:string;useAvailableCash:boolean;existingExposureAtomic:string;pendingExposureAtomic:string;availableCashAtomic:string;cashUsedAtomic:string;projectedCashAtomic:string|null;protectedCashAtomic:string;heldCashAtomic:string;feeAtomic:string;turnoverAtomic:string;turnoverBps:number|null;afterExposureAtomic:string|null;drift:RebalanceDrift[];legs:RebalanceLeg[];issuerExposure:{issuer:string;exposureAtomic:string;shareBps:number}[];reasons:string[]};
export type ResearchRebalance={schemaVersion:'1.0.0';engineVersion:'rebalance-research-v1';id:string;accountId:string;requestId:string;mandateId:string;mandateRevision:number;scenario:MandateInput['scenario'];createdAt:string;researchOnly:true;useAvailableCash:boolean;inputs:ResearchProposal['inputs'];result:RebalanceResult};
export type ResearchProposal={schemaVersion:'1.0.0';engineVersion:'portfolio-research-v1';revalidation?:ProposalComparison;recurring?:{scheduleId:string;firingId:string;dueAt:string};inflow?:{eventId:string;transactionHash:string;reviewRevision:number;budgetCapAtomic:string};id:string;accountId:string;requestId:string;mandateId:string;mandateRevision:number;createdAt:string;scenario:MandateInput['scenario'];researchOnly:true;inputs:{inflowProof?:InflowProof;allocationBudgetCapAtomic?:string;mandate:MandateInput;cashPolicyRevision:number;cashPolicy:import('./capital.ts').CapitalPolicy;pending:import('./portfolio.ts').PendingExposure[];marks:import('./portfolio.ts').MarketMarks;passports:import('./passports.ts').PassportCatalogue;checkpoint:import('./capital.ts').CapitalCheckpoint;funding:import('./capital.ts').CapitalFunding;portfolio:import('./portfolio.ts').PortfolioExposure;candidates:Instrument[];quotes:ScenarioQuote[]};result:PlanResult};
export const executionStates = ['created','quoting','policy_checked','awaiting_authorization','submitting','submitted','settling','reconciled','deferred','rejected','expired','failed','unknown','cancellation_requested'] as const;
export type ExecutionState = typeof executionStates[number];
export const executionAttemptSchema = z.object({ id:z.string(), planRevisionId:z.string(), wallet:z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainId:z.literal(56), state:z.enum(executionStates), requestId:z.string().uuid(), aggregatorQuoteId:z.string().nullable(), rfqOrderId:z.string().nullable(), platformOrderId:z.string().nullable(), transactionHash:z.string().nullable(), expiresAt:z.string().datetime().nullable() });
export const dataStates = ['AVAILABLE','UNKNOWN_DATA','STALE','PAUSED','MARKET_CLOSED','NO_QUOTE'] as const;
export const durableAttemptRecordSchema = executionAttemptSchema.extend({schemaVersion:z.literal('1.0.0'),reservationId:z.string().min(1),createdAt:z.string().datetime()}).strict();

export const cashTargetSchema=z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,18})?$/).refine(v=>/[1-9]/.test(v),'Use a positive cash target.');
export type CashRaisingResult={schemaVersion:'1.0.0';mode:'research';executable:false;status:'feasible'|'shortfall'|'blocked';createdAt:string;decisionId:string;targetAtomic:string;decimals:18;currency:'USDT';scope:string;availableCashAtomic:string;cashUsedAtomic:string;protectedCashAtomic:string;heldCashAtomic:string;protectionGapAtomic:string;saleNeededAtomic:string;maximumNetSaleAtomic:string|null;netSaleAtomic:string;feeAtomic:string;grossSaleAtomic:string;modeledPayoutAtomic:string|null;shortfallAtomic:string|null;protectionGapAfterAtomic:string|null;projectedCashBeforePayoutAtomic:string|null;projectedCashAfterPayoutAtomic:string|null;remainingExposureAtomic:string|null;remaining:{underlying:string;heldAtomic:string;pendingAtomic:string;shareBps:number|null;targetWeightBps:number}[];issuerExposure:{issuer:string;exposureAtomic:string;shareBps:number}[];legs:RebalanceLeg[];excluded:{instrumentId:string;symbol:string;reason:string}[];reasons:string[]};
export type ResearchCashRaising={schemaVersion:'1.0.0';engineVersion:'cash-raising-research-v1';id:string;accountId:string;requestId:string;mandateId:string;mandateRevision:number;scenario:MandateInput['scenario'];createdAt:string;researchOnly:true;target:string;inputs:ResearchProposal['inputs'];result:CashRaisingResult};

export const inflowReviewSchema=z.enum(['unclassified','external','internal']);
export type InflowReview= z.infer<typeof inflowReviewSchema>;
export const inflowProofSchema=z.object({chainId:z.literal(56),token:z.literal('0x55d398326f99059ff775485246999027b3197955'),decimals:z.literal(18),wallet:z.string().regex(/^0x[0-9a-f]{40}$/),transactionHash:z.string().regex(/^0x[0-9a-f]{64}$/),transactionSender:z.string().regex(/^0x[0-9a-f]{40}$/),blockNumber:z.string().regex(/^(0|[1-9]\d*)$/),blockHash:z.string().regex(/^0x[0-9a-f]{64}$/),headNumber:z.string().regex(/^(0|[1-9]\d*)$/),headHash:z.string().regex(/^0x[0-9a-f]{64}$/),observedAt:z.string().datetime(),incoming:z.array(z.object({logIndex:z.number().int().nonnegative(),from:z.string().regex(/^0x[0-9a-f]{40}$/),to:z.string().regex(/^0x[0-9a-f]{40}$/),amountAtomic:z.string().regex(/^(0|[1-9]\d{0,77})$/)}).strict()).max(1000),usdtOutgoingAtomic:z.string().regex(/^(0|[1-9]\d{0,77})$/),outgoingAssets:z.array(z.object({contract:z.string().regex(/^0x[0-9a-f]{40}$/),logIndex:z.number().int().nonnegative(),amountAtomic:z.string().regex(/^(0|[1-9]\d{0,77})$/)}).strict()).max(1000)}).strict();
export type InflowProof=z.infer<typeof inflowProofSchema>;
export type InflowClassification={kind:'unclassified'|'external'|'internal'|'conversion';netAtomic:string;confirmations:string;eligibleForProposal:boolean;reasons:string[]};
export type InflowRecord={id:string;accountId:string;revision:number;createdAt:string;review:InflowReview;knownSettlement:boolean;proof:InflowProof;classification:InflowClassification;researchOnly:true};
