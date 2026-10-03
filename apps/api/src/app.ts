import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {decodeFunctionData,parseAbi,type Hex} from 'viem';
import {Ledger,LedgerError,RecurringStore,DirectAttemptStore,DirectAttemptError,embeddedDatabase,type DirectAttempt} from '@mandate/store';
import {capitalPolicySchema,capitalCheckpointSchema} from '@mandate/domain';
import {readInflowProof} from './inflows.ts';
import {capitalAccountId,capitalView,readCapitalCheckpoint} from './capital.ts';
import {readPortfolioMarks,withPortfolio,researchCandidates} from './portfolio.ts';
import {defaultMandate,instruments,quotesFor,previewInvestment,previewWithdrawal,compareResearchProposals,previewRebalance,previewCashRaising,parseUnits,formatUnits,classifyInflow} from '@mandate/core';
import {mandateSchema,amountSchema,SCHEMA_VERSION,investmentPolicySchema,type ResearchProposal,type ResearchRebalance,type ResearchCashRaising,cashTargetSchema,type CapitalView,inflowReviewSchema,inflowProofSchema,type InflowRecord} from '@mandate/domain';
import {recordedCatalogue,capabilities} from './recorded.ts';
import {createWalletSessionService,WalletSessionError} from './wallet-session.ts';
import {BinanceReadClient,BSC_USDT,AAOIB,bindQuote,inspectBuild,costIdentityForAAOIBRoute,type RouteIntent} from '@mandate/connectors';
import {readWalletReadiness} from './wallet-readiness.ts';
import {reviewResearchExecution} from './execution-review.ts';
import {readDirectPreflight,readDirectPreparation,readDirectApprovalPreparation} from './direct-preflight.ts';
import {readDirectSettlement} from './direct-settlement.ts';
import {directPilotAccess,directPilotConfigured} from './direct-pilot-access.ts';
import {PANCAKE_V3,pancakeRouterAbi} from './pancake-direct.ts';
import {passportCatalogue} from './passports.ts';
import {readRegime} from './regime.ts';
import {latestObservedCost} from './observed-cost.ts';
import {passportPolicySchema,evaluatePassport} from '@mandate/domain';
import {recurringScheduleInputSchema,recurringChangeSchema} from '@mandate/domain';
class CapitalReadError extends Error{}
class InflowReadError extends Error{}
export function createApp(root=process.cwd(),options:{researchClient?:Pick<BinanceReadClient,'get'>;readinessReader?:typeof readWalletReadiness;directReader?:(owner:string,direction:'BUY'|'SELL',sellAmountAtomic?:string,buyAmountAtomic?:string)=>Promise<unknown>;directPreparer?:typeof readDirectPreparation;directApprovalPreparer?:typeof readDirectApprovalPreparation;directSettlementReader?:typeof readDirectSettlement;capitalReader?:typeof readCapitalCheckpoint;marketReader?:typeof readPortfolioMarks;inflowReader?:typeof readInflowProof;ledger?:Ledger;recurringTickMs?:number|null}={}){
 const app=Fastify({logger:false,bodyLimit:16384});
 const wallet=createWalletSessionService();
 let ledgerPromise:Promise<Ledger>|undefined;
 const getLedger=()=>ledgerPromise??=options.ledger?Promise.resolve(options.ledger):(async()=>{fs.mkdirSync(path.join(root,'.runtime'),{recursive:true});const ledger=new Ledger(embeddedDatabase(path.join(root,'.runtime/capital-ledger')));try{await ledger.migrate();return ledger;}catch(error){await ledger.close();throw error;}})();
 const directStore=async()=>new DirectAttemptStore((await getLedger()).db);
 app.addHook('onClose',async()=>{if(ledgerPromise&&!options.ledger){const ledger=await ledgerPromise.catch(()=>null);await ledger?.close();}});
 function capitalSession(cookie:string|undefined,origin:string|undefined,mutation=false){const session=wallet.session(cookie,origin);if(!session)throw new WalletSessionError(401,'WALLET_SESSION_REQUIRED');if(mutation&&!origin)throw new WalletSessionError(403,'ORIGIN_NOT_ALLOWED');return session;}
 let markets:ReturnType<typeof readPortfolioMarks>|undefined,marketTime=0;
 async function getCapital(address:string,forceMarkets=false){const capital=await capitalView(await getLedger(),address);let observation=markets;if(forceMarkets||!observation||Date.now()-marketTime>30000){marketTime=Date.now();observation=(options.marketReader??readPortfolioMarks)().catch(()=>({observedAt:new Date().toISOString(),items:[],source:'unavailable'}));markets=observation;}return withPortfolio(capital,await observation);}
 async function refreshCapital(address:string){const ledger=await getLedger(),accountId=capitalAccountId(address);try{const checkpoint=capitalCheckpointSchema.parse(await (options.capitalReader??readCapitalCheckpoint)(address));if(checkpoint.wallet!==address.toLowerCase()||checkpoint.accountId!==accountId||checkpoint.asset.chainId!==56||checkpoint.asset.contract!==BSC_USDT.toLowerCase()||checkpoint.asset.decimals!==18)throw new Error('Checkpoint identity mismatch');await ledger.applyCapitalCheckpoint(checkpoint);}catch{await ledger.invalidateCapital(accountId);throw new CapitalReadError();}return getCapital(address,true);}
 async function buildProposal(address:string,mandateRevision:number,scenario:'normal'|'expensive'|'missing',requestId:string,capital:CapitalView,budgetCapAtomic?:string){
  const accountId=capitalAccountId(address),mandate=(await (await getLedger()).investmentMandates(accountId))[0];if(!mandate||mandate.revision!==mandateRevision)throw new LedgerError('STALE_MANDATE');
  if(capital.state!=='OBSERVED'||!capital.checkpoint||!capital.checkpointId||!capital.portfolio)throw new LedgerError('FRESH_CAPITAL_REQUIRED');
  const input=mandateSchema.parse({...defaultMandate,balance:'0',reserveFloor:'0',operatingBudget:'0',obligations:[],...mandate.policy,scenario});
  const funding={accountId,accountRevision:capital.revision,checkpointId:capital.checkpointId,blockNumber:capital.checkpoint.blockNumber,observedAt:capital.checkpoint.observedAt,balanceAtomic:capital.balanceAtomic,protectedAtomic:capital.protectedAtomic,heldAtomic:capital.heldAtomic,decimals:capital.decimals};
  const research=researchCandidates(root,input),result=previewInvestment(input,research.candidates,research.quotes,new Date(),funding,capital.portfolio,budgetCapAtomic);
  const proposal:ResearchProposal={schemaVersion:'1.0.0',engineVersion:'portfolio-research-v1',id:randomUUID(),accountId,requestId,mandateId:mandate.id,mandateRevision:mandate.revision,createdAt:result.createdAt,scenario,researchOnly:true,inputs:{...(budgetCapAtomic===undefined?{}:{allocationBudgetCapAtomic:budgetCapAtomic}),mandate:input,cashPolicyRevision:capital.policyRevision,cashPolicy:capital.policy,pending:capital.pending??[],marks:capital.marketEvidence!,checkpoint:capital.checkpoint,funding,portfolio:capital.portfolio,...research},result};return proposal;
 }
 async function checkInflow(address:string,hash:string,review:InflowRecord['review'],expectedRevision:number){
  let proof;try{proof=inflowProofSchema.parse(await (options.inflowReader??readInflowProof)(address,hash));if(proof.wallet!==address.toLowerCase()||proof.transactionHash!==hash)throw new Error('Identity mismatch');classifyInflow(proof,review);}catch{throw new InflowReadError();}
  return (await getLedger()).saveInflowReview(capitalAccountId(address),proof,review,expectedRevision);
 }
 let runningRecurring=false,timer:ReturnType<typeof setInterval>|undefined;
 async function runRecurringDue(){
  if(runningRecurring)return {claimed:0,proposed:0,deferred:0};runningRecurring=true;
  const totals={claimed:0,proposed:0,deferred:0};
  try{const ledger=await getLedger(),store=new RecurringStore(ledger);
   for(let n=0;n<3;n++){
    const claim=await store.claim();if(!claim)break;totals.claimed++;
    try{
     const capital=await refreshCapital(claim.schedule.wallet);
     if(capital.state!=='OBSERVED'||!capital.portfolio||capital.portfolio.state!=='KNOWN'||!capital.marketEvidence||capital.marketEvidence.source==='unavailable')throw new Error('FRESH_EVIDENCE_REQUIRED');
     const mandate=(await ledger.investmentMandates(claim.schedule.accountId))[0];if(!mandate)throw new Error('SAVED_MANDATE_REQUIRED');
     const proposal=await buildProposal(claim.schedule.wallet,mandate.revision,claim.schedule.scenario,claim.firing.requestId,capital);
     proposal.recurring={scheduleId:claim.schedule.id,firingId:claim.firing.id,dueAt:claim.firing.dueAt};
     await ledger.saveResearchProposal(proposal,{scheduleId:claim.schedule.id,firingId:claim.firing.id,leaseToken:claim.leaseToken,revision:claim.schedule.revision});totals.proposed++;
    }catch(error){const reason=error instanceof LedgerError?error.code:error instanceof CapitalReadError?'CAPITAL_READ_UNAVAILABLE':'FRESH_EVIDENCE_REQUIRED';await store.defer(claim,reason);totals.deferred++;}
   }
   return totals;
  }finally{runningRecurring=false;}
 }
 app.addHook('onReady',async()=>{if(options.recurringTickMs===null)return;const interval=options.recurringTickMs??30000;if(!Number.isInteger(interval)||interval<1000)throw new Error('INVALID_RECURRING_INTERVAL');timer=setInterval(()=>{void runRecurringDue().catch(()=>{});},interval);timer.unref();});
 app.addHook('onClose',async()=>{if(timer)clearInterval(timer);});
 app.get('/v1/health',async()=>({service:'mandate',schemaVersion:SCHEMA_VERSION,status:'ok',executionEnabled:false,directPilotEnabled:directPilotConfigured().swapEnabled,directApprovalPilotEnabled:directPilotConfigured().approvalEnabled,directFullRouteEnabled:directPilotConfigured().fullRouteEnabled}));
 app.get('/v1/workspace',async()=>({schemaVersion:SCHEMA_VERSION,mode:'scenario',executionEnabled:false,directPilotEnabled:directPilotConfigured().swapEnabled,directApprovalPilotEnabled:directPilotConfigured().approvalEnabled,directFullRouteEnabled:directPilotConfigured().fullRouteEnabled,mandate:defaultMandate,instruments,capabilities:capabilities(root)}));
 app.get('/v1/instruments',async()=>recordedCatalogue(root));
 const regimeQuery=z.object({token:z.string().regex(/^[A-Z0-9.-]{1,24}$/),platform:z.enum(['ondo','bstock'])}).strict();
 app.get('/v1/regime',async(req,reply)=>{
  const parsed=regimeQuery.safeParse(req.query);
  if(!parsed.success)return reply.code(400).send({error:'INVALID_REGIME_QUERY'});
  const result=await readRegime(root,parsed.data.token,parsed.data.platform);
  if(!result.availableTokens.some(item=>item.token===parsed.data.token&&item.platform===parsed.data.platform))return reply.code(400).send({error:'UNKNOWN_REGIME_INSTRUMENT',availableTokens:result.availableTokens});
  return result;
 });
 const costReviewQuery=z.object({ticker:z.string().regex(/^[A-Z0-9.-]{1,24}$/),platform:z.enum(['ondo','bstock']),side:z.enum(['buy','sell']),usd:z.coerce.number().int().positive().max(1_000_000)}).strict();
 app.get('/v1/cost-review',async(req,reply)=>{
  const parsed=costReviewQuery.safeParse(req.query);
  if(!parsed.success)return reply.code(400).send({error:'INVALID_COST_REVIEW_QUERY'});
  reply.header('Cache-Control','no-store');
  return latestObservedCost(root,parsed.data);
 });
 app.get('/v1/instruments/passports',async()=>passportCatalogue(root));
 app.post('/v1/instruments/eligibility',async(req,reply)=>{const policy=passportPolicySchema.safeParse(req.body);if(!policy.success)return reply.code(400).send({error:'INVALID_PASSPORT_POLICY'});return {scope:'research',executionAllowed:false,items:passportCatalogue(root).items.map(p=>evaluatePassport(p,policy.data))};});
 app.get('/v1/capital',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);return getCapital(session.address);});
 app.get('/v1/capital/mandates',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);const history=await (await getLedger()).investmentMandates(capitalAccountId(session.address));return {latest:history[0]??null,history,researchOnly:true};});
 const saveMandateBody=z.object({policy:investmentPolicySchema,expectedRevision:z.number().int().nonnegative()}).strict();
 app.post('/v1/capital/mandates',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=saveMandateBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_INVESTMENT_POLICY'});
  const defs=passportCatalogue(root).items;if(body.data.policy.representationAllowlist.some(c=>!defs.some(p=>p.contract===c)))return reply.code(400).send({error:'UNKNOWN_REPRESENTATION'});
  const latest=await (await getLedger()).saveInvestmentMandate(capitalAccountId(session.address),body.data.policy,body.data.expectedRevision);return {latest,capital:await getCapital(session.address),researchOnly:true};
 });
 app.get('/v1/capital/proposals',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);return {items:await (await getLedger()).researchHistory(capitalAccountId(session.address)),researchOnly:true};});
 const proposalBody=z.object({mandateRevision:z.number().int().positive(),scenario:z.enum(['normal','expensive','missing']),requestId:z.string().uuid()}).strict();
 app.post('/v1/capital/proposals',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=proposalBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_PROPOSAL_REQUEST'});
  const ledger=await getLedger(),accountId=capitalAccountId(session.address),previous=await ledger.researchProposal(accountId,body.data.requestId);
  if(previous){if(previous.revalidation||previous.inflow||previous.mandateRevision!==body.data.mandateRevision||previous.scenario!==body.data.scenario)throw new LedgerError('PROPOSAL_REQUEST_CONFLICT');return {proposal:previous,researchOnly:true};}
  const capital=await getCapital(session.address),proposal=await buildProposal(session.address,body.data.mandateRevision,body.data.scenario,body.data.requestId,capital);
  return {proposal:await ledger.saveResearchProposal(proposal),researchOnly:true};
 });
 const revalidationBody=z.object({proposalId:z.string().uuid(),mandateRevision:z.number().int().positive(),scenario:z.enum(['normal','expensive','missing']),requestId:z.string().uuid()}).strict();
 app.post('/v1/capital/proposals/revalidate',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=revalidationBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_REVALIDATION_REQUEST'});
  const ledger=await getLedger(),accountId=capitalAccountId(session.address),parent=await ledger.researchProposalById(accountId,body.data.proposalId);if(!parent)return reply.code(404).send({error:'PROPOSAL_NOT_FOUND'});
  const previous=await ledger.researchProposal(accountId,body.data.requestId);if(previous){if(previous.revalidation?.parentProposalId!==parent.id||previous.mandateRevision!==body.data.mandateRevision||previous.scenario!==body.data.scenario)throw new LedgerError('PROPOSAL_REQUEST_CONFLICT');return {proposal:previous,capital:await getCapital(session.address),researchOnly:true};}
  const mandate=(await ledger.investmentMandates(accountId))[0];if(!mandate||mandate.revision!==body.data.mandateRevision)throw new LedgerError('STALE_MANDATE');
  let capital=await refreshCapital(session.address),inflow:InflowRecord|undefined;
  if(parent.inflow){const current=await ledger.inflowRecord(accountId,parent.inflow.transactionHash);if(!current||current.classification.kind!=='external')throw new LedgerError('INELIGIBLE_INFLOW');inflow=await checkInflow(session.address,current.proof.transactionHash,current.review,current.revision);if(!inflow.classification.eligibleForProposal)throw new LedgerError('INELIGIBLE_INFLOW');capital=await getCapital(session.address);}
  const proposal=await buildProposal(session.address,body.data.mandateRevision,body.data.scenario,body.data.requestId,capital,parent.inflow?.budgetCapAtomic);if(inflow){proposal.inputs.inflowProof=inflow.proof;proposal.inflow={eventId:inflow.id,transactionHash:inflow.proof.transactionHash,reviewRevision:inflow.revision,budgetCapAtomic:parent.inflow!.budgetCapAtomic};}proposal.revalidation=compareResearchProposals(parent,proposal);
  return {proposal:await ledger.saveResearchProposal(proposal),capital,researchOnly:true};
 });
 app.get('/v1/capital/rebalances',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);return {items:await (await getLedger()).rebalanceHistory(capitalAccountId(session.address)),researchOnly:true};});
 const rebalanceBody=proposalBody.extend({useAvailableCash:z.boolean()}).strict();
 app.post('/v1/capital/rebalances',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=rebalanceBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_REBALANCE_REQUEST'});
  const ledger=await getLedger(),accountId=capitalAccountId(session.address),previous=await ledger.researchRebalance(accountId,body.data.requestId);
  if(previous){if(previous.mandateRevision!==body.data.mandateRevision||previous.scenario!==body.data.scenario||previous.useAvailableCash!==body.data.useAvailableCash)throw new LedgerError('REBALANCE_REQUEST_CONFLICT');return {rebalance:previous,researchOnly:true};}
  const capital=await getCapital(session.address),source=await buildProposal(session.address,body.data.mandateRevision,body.data.scenario,body.data.requestId,capital),result=previewRebalance(source.inputs,body.data.useAvailableCash);
  const rebalance:ResearchRebalance={schemaVersion:'1.0.0',engineVersion:'rebalance-research-v1',id:randomUUID(),accountId,requestId:body.data.requestId,mandateId:source.mandateId,mandateRevision:source.mandateRevision,scenario:source.scenario,createdAt:result.createdAt,researchOnly:true,useAvailableCash:body.data.useAvailableCash,inputs:source.inputs,result};
  return {rebalance:await ledger.saveResearchRebalance(rebalance),researchOnly:true};
 });
 app.get('/v1/capital/cash-raising',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);return {items:await (await getLedger()).cashRaisingHistory(capitalAccountId(session.address)),researchOnly:true};});
 const cashRaisingBody=proposalBody.extend({target:cashTargetSchema}).strict();
 app.post('/v1/capital/cash-raising',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=cashRaisingBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_CASH_RAISING_REQUEST'});
  const ledger=await getLedger(),accountId=capitalAccountId(session.address),target=formatUnits(parseUnits(body.data.target,18),18),previous=await ledger.researchCashRaising(accountId,body.data.requestId);
  if(previous){if(previous.mandateRevision!==body.data.mandateRevision||previous.scenario!==body.data.scenario||previous.target!==target)throw new LedgerError('CASH_RAISING_REQUEST_CONFLICT');return {cashRaising:previous,researchOnly:true};}
  const capital=await getCapital(session.address),source=await buildProposal(session.address,body.data.mandateRevision,body.data.scenario,body.data.requestId,capital),result=previewCashRaising(source.inputs,target);
  const cashRaising:ResearchCashRaising={schemaVersion:'1.0.0',engineVersion:'cash-raising-research-v1',id:randomUUID(),accountId,requestId:body.data.requestId,mandateId:source.mandateId,mandateRevision:source.mandateRevision,scenario:source.scenario,createdAt:result.createdAt,researchOnly:true,target,inputs:source.inputs,result};return {cashRaising:await ledger.saveResearchCashRaising(cashRaising),researchOnly:true};
 });
 app.get('/v1/capital/inflows',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);return {items:await (await getLedger()).inflowHistory(capitalAccountId(session.address)),researchOnly:true};});
 app.get('/v1/capital/recurring',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin),store=new RecurringStore(await getLedger()),accountId=capitalAccountId(session.address);return {schedules:await store.schedules(accountId),firings:await store.firings(accountId),researchOnly:true,executionAllowed:false};});
 app.post('/v1/capital/recurring',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=recurringScheduleInputSchema.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_RECURRING_SCHEDULE'});const schedule=await new RecurringStore(await getLedger()).create(capitalAccountId(session.address),session.address,body.data);return {schedule,researchOnly:true,executionAllowed:false};});
 for(const action of ['pause','resume','revoke'] as const)app.post('/v1/capital/recurring/'+action,async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=recurringChangeSchema.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_RECURRING_CHANGE'});const schedule=await new RecurringStore(await getLedger()).change(capitalAccountId(session.address),body.data.scheduleId,body.data.expectedRevision,action);return {schedule,researchOnly:true,executionAllowed:false};});
 const inflowCheckBody=z.object({transactionHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v.toLowerCase()),review:inflowReviewSchema,expectedRevision:z.number().int().nonnegative()}).strict();
 app.post('/v1/capital/inflows/check',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=inflowCheckBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_INFLOW_REQUEST'});const capital=await capitalView(await getLedger(),session.address);if(capital.state!=='OBSERVED')throw new LedgerError('FRESH_CAPITAL_REQUIRED');const record=await checkInflow(session.address,body.data.transactionHash,body.data.review,body.data.expectedRevision);return {record,capital:await getCapital(session.address),researchOnly:true};});
 const inflowProposalBody=proposalBody.extend({transactionHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v.toLowerCase()),expectedReviewRevision:z.number().int().positive()}).strict();
 app.post('/v1/capital/inflows/propose',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=inflowProposalBody.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'INVALID_INFLOW_REQUEST'});
  const ledger=await getLedger(),accountId=capitalAccountId(session.address),previous=await ledger.researchProposal(accountId,body.data.requestId);if(previous){if(previous.revalidation||previous.inflow?.transactionHash!==body.data.transactionHash||previous.mandateRevision!==body.data.mandateRevision||previous.scenario!==body.data.scenario)throw new LedgerError('PROPOSAL_REQUEST_CONFLICT');return {proposal:previous,researchOnly:true};}
  const current=await ledger.inflowRecord(accountId,body.data.transactionHash);if(!current||current.revision!==body.data.expectedReviewRevision)throw new LedgerError('STALE_INFLOW_REVIEW');if(!current.classification.eligibleForProposal)throw new LedgerError('INELIGIBLE_INFLOW');if(await ledger.inflowLinkedProposal(accountId,body.data.transactionHash))throw new LedgerError('INFLOW_ALREADY_PROPOSED');
  const latest=(await ledger.investmentMandates(accountId))[0];if(!latest||latest.revision!==body.data.mandateRevision)throw new LedgerError('STALE_MANDATE');
  await refreshCapital(session.address);const record=await checkInflow(session.address,body.data.transactionHash,current.review,current.revision),capital=await getCapital(session.address);if(!record.classification.eligibleForProposal)throw new LedgerError('INELIGIBLE_INFLOW');
  const proposal=await buildProposal(session.address,body.data.mandateRevision,body.data.scenario,body.data.requestId,capital,record.classification.netAtomic);proposal.inputs.inflowProof=record.proof;proposal.inflow={eventId:record.id,transactionHash:record.proof.transactionHash,reviewRevision:record.revision,budgetCapAtomic:record.classification.netAtomic};return {proposal:await ledger.saveResearchProposal(proposal),capital,researchOnly:true};
 });
 app.get('/v1/capital/history',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin);const ledger=await getLedger(),accountId=capitalAccountId(session.address);return {executionAllowed:false,items:await ledger.capitalHistory(accountId),policies:await ledger.capitalPolicyHistory(accountId)};});
 app.post('/v1/capital/refresh',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);if(req.body&&Object.keys(req.body as object).length)return reply.code(400).send({error:'REFRESH_BODY_NOT_SUPPORTED'});
  const ledger=await getLedger(),accountId=capitalAccountId(session.address);
  try{const checkpoint=capitalCheckpointSchema.parse(await (options.capitalReader??readCapitalCheckpoint)(session.address));if(checkpoint.wallet!==session.address.toLowerCase()||checkpoint.accountId!==accountId||checkpoint.asset.chainId!==56||checkpoint.asset.contract!==BSC_USDT.toLowerCase()||checkpoint.asset.decimals!==18)throw new Error('Checkpoint identity mismatch');await ledger.applyCapitalCheckpoint(checkpoint);return getCapital(session.address);}
  catch{await ledger.invalidateCapital(accountId);return reply.code(503).send({error:'CAPITAL_READ_UNAVAILABLE',state:'UNKNOWN',executionAllowed:false});}
 });
 app.post('/v1/capital/policy',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),body=req.body as {policy?:unknown;expectedRevision?:unknown}|null,policy=capitalPolicySchema.safeParse(body?.policy);if(!policy.success||!Number.isInteger(body?.expectedRevision)||Number(body?.expectedRevision)<0)return reply.code(400).send({error:'INVALID_CAPITAL_POLICY'});const ledger=await getLedger();await ledger.saveCapitalPolicy(capitalAccountId(session.address),policy.data,Number(body!.expectedRevision));return getCapital(session.address);});
 app.post('/v1/capital/preview',async(req,reply)=>{const session=capitalSession(req.headers.cookie,req.headers.origin,true),input=mandateSchema.safeParse(req.body);if(!input.success)return reply.code(400).send({error:'INVALID_MANDATE'});const capital=await getCapital(session.address);if(capital.state!=='OBSERVED'||!capital.checkpoint||!capital.checkpointId)return reply.code(409).send({error:'FRESH_CAPITAL_REQUIRED',state:capital.state});const funding={accountId:capital.accountId,accountRevision:capital.revision,checkpointId:capital.checkpointId,blockNumber:capital.checkpoint.blockNumber,observedAt:capital.checkpoint.observedAt,balanceAtomic:capital.balanceAtomic,protectedAtomic:capital.protectedAtomic,heldAtomic:capital.heldAtomic,decimals:capital.decimals};const research=researchCandidates(root,input.data);return previewInvestment(input.data,research.candidates,research.quotes,new Date(),funding,capital.portfolio);});
 app.post('/v1/wallet/challenge',async(req,reply)=>{
  try{const body=req.body as {address?:unknown;chainId?:unknown}|null;return wallet.issue(body?.address,body?.chainId,req.headers.origin,req.ip);}
  catch(error){if(error instanceof WalletSessionError)return reply.code(error.statusCode).send({error:error.code});throw error;}
 });
 app.post('/v1/wallet/verify',async(req,reply)=>{
  try{const body=req.body as {challengeId?:unknown;signature?:unknown}|null;const session=await wallet.verify(body?.challengeId,body?.signature,req.headers.origin);reply.header('Set-Cookie',session.cookie);return {address:session.address,chainId:session.chainId,expiresAt:session.expiresAt};}
  catch(error){if(error instanceof WalletSessionError)return reply.code(error.statusCode).send({error:error.code});throw error;}
 });
 app.get('/v1/wallet/session',async(req,reply)=>{
  try{return {session:wallet.session(req.headers.cookie,req.headers.origin)};}
  catch(error){if(error instanceof WalletSessionError)return reply.code(error.statusCode).send({error:error.code});throw error;}
 });
 app.delete('/v1/wallet/session',async(req,reply)=>{reply.header('Set-Cookie',wallet.clearCookie());return {disconnected:true};});
 app.post('/v1/routes/AAOIB/research',async(req,reply)=>{
  try{
   // Research only: a fresh quote/build is tied to the signed-in wallet, not a caller-supplied address.
   const session=wallet.session(req.headers.cookie,req.headers.origin);
   if(!session)return reply.code(401).send({error:'WALLET_SESSION_REQUIRED'});
   if(!req.headers.origin)return reply.code(403).send({error:'ORIGIN_NOT_ALLOWED'});
   const body=req.body as {amount?:unknown}|null;
   if(body?.amount!=='10')return reply.code(400).send({error:'RESEARCH_AMOUNT_NOT_SUPPORTED'});
   const key=process.env.BINANCE_WEB3_API_KEY,secret=process.env.BINANCE_WEB3_API_SECRET;
   if(!options.researchClient&&(!key||!secret))return reply.code(503).send({error:'BINANCE_RESEARCH_UNAVAILABLE'});
   const client=options.researchClient??new BinanceReadClient(key!,secret!);
   const intent:RouteIntent={chainId:'56',fromToken:BSC_USDT,toToken:AAOIB,amount:'10000000000000000000',wallet:session.address};
   const costIdentity=costIdentityForAAOIBRoute(intent,BSC_USDT);
   if(!costIdentity)return reply.code(500).send({error:'COST_IDENTITY_UNBOUND'});
   const costEvidence=latestObservedCost(root,costIdentity);
   const quote=await client.get('/api/v1/dex/aggregator/quote',{binanceChainId:intent.chainId,fromTokenAddress:intent.fromToken,toTokenAddress:intent.toToken,amount:intent.amount,userWalletAddress:intent.wallet});
   const bound=bindQuote(quote.body,intent,quote.finishedAt);
   if(!bound)return {instrument:'AAOIB',amount:'10',asset:'BSC USDT',state:'UNAVAILABLE',quoteCode:quote.code,costEvidence,executionEnabled:false,note:'No current route matched the connected wallet, chain, token pair and amount.'};
   const build=await client.get('/api/v1/dex/aggregator/swap',{binanceChainId:intent.chainId,fromTokenAddress:intent.fromToken,toTokenAddress:intent.toToken,amount:intent.amount,userWalletAddress:intent.wallet,quoteId:bound.quoteId,slippagePercent:'0.5',approveTransaction:'false'});
   const inspection=inspectBuild(build.body,bound,build.finishedAt);
   let walletCheck:Awaited<ReturnType<typeof readWalletReadiness>>|{state:'UNKNOWN'|'NOT_CHECKED';reason:string};
   if(inspection.identityAndShapeChecked&&bound.mode==='SWAP'&&inspection.txTo&&inspection.txSelector){
    try{walletCheck=await (options.readinessReader??readWalletReadiness)({owner:session.address,spender:bound.approveTarget,router:inspection.txTo,selector:inspection.txSelector,requiredAtomic:intent.amount});}
    catch{walletCheck={state:'UNKNOWN',reason:'CHAIN_READ_FAILED'};}
   }else walletCheck={state:'NOT_CHECKED',reason:'ROUTE_SHAPE_UNVERIFIED'};
   const validUntil=new Date(Date.parse(bound.receivedAt)+30000).toISOString();
   const executionReview=reviewResearchExecution({shapeChecked:inspection.identityAndShapeChecked,validUntil,checkedAt:new Date().toISOString(),wallet:walletCheck,costEvidence});
   return {instrument:'AAOIB',amount:'10',asset:'BSC USDT',state:inspection.identityAndShapeChecked?'SHAPE_CHECKED':'UNVERIFIED',observedAt:build.finishedAt,validUntil,mode:bound.mode,vendorName:bound.vendorName,toTokenAmount:bound.toTokenAmount,buildCode:build.code,inspection:{identityAndShapeChecked:inspection.identityAndShapeChecked,reasons:inspection.reasons},walletCheck,executionReview,costEvidence,executionEnabled:false,note:'Read-only research. Wallet funds, allowance and router code are observations only; eligibility, calldata meaning, gas sufficiency, simulation and transaction authorization remain unverified.'};
  }catch(error){if(error instanceof WalletSessionError)return reply.code(error.statusCode).send({error:error.code});throw error;}
 });
 const directPreflightBody=z.object({direction:z.enum(['BUY','SELL']),sellAmountAtomic:z.string().max(20).regex(/^[1-9]\d*$/).optional(),buyAmountAtomic:z.string().max(20).regex(/^[1-9]\d*$/).optional()}).strict().refine(x=>x.direction==='SELL'?x.buyAmountAtomic===undefined&&x.sellAmountAtomic!==undefined&&BigInt(x.sellAmountAtomic)<=2n*10n**16n:x.sellAmountAtomic===undefined&&(x.buyAmountAtomic===undefined||BigInt(x.buyAmountAtomic)<=10n*10n**18n));
 app.post('/v1/routes/SPYon/preflight',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const parsed=directPreflightBody.safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_PREFLIGHT'});
  try{return await (options.directReader??readDirectPreflight)(session.address,parsed.data.direction,parsed.data.sellAmountAtomic,parsed.data.buyAmountAtomic);}
  catch{return reply.code(503).send({error:'DIRECT_PREFLIGHT_UNAVAILABLE',executionEnabled:false});}
 });
 const attemptIdBody=z.object({attemptId:z.string().uuid()}).strict();
 const attemptHashBody=attemptIdBody.extend({transactionHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict();
 const publicAttempt=(attempt:DirectAttempt)=>{const {data:_,...review}=attempt;return review;};
 const checkBuyCapital=async(address:string,amountIn:bigint)=>{const capital=await refreshCapital(address);return capital.state==='OBSERVED'&&capital.policyRevision>=1&&BigInt(capital.availableAtomic)>=amountIn;};
 const approvalAbi=parseAbi(['function approve(address,uint256) returns (bool)']);
 function swapPayloadMatches(data:Hex,owner:string,amountIn:bigint,minimumOut:bigint,deadline:bigint,direction:'BUY'|'SELL'){
  try{const decoded=decodeFunctionData({abi:pancakeRouterAbi,data});if(decoded.functionName!=='exactInputSingle')return false;const p=decoded.args[0];return p.tokenIn.toLowerCase()===(direction==='BUY'?PANCAKE_V3.usdt:PANCAKE_V3.spyOn).toLowerCase()&&p.tokenOut.toLowerCase()===(direction==='BUY'?PANCAKE_V3.spyOn:PANCAKE_V3.usdt).toLowerCase()&&p.recipient.toLowerCase()===owner&&p.fee===PANCAKE_V3.fee&&p.amountIn===amountIn&&p.amountOutMinimum===minimumOut&&p.deadline===deadline&&p.sqrtPriceLimitX96===0n;}catch{return false;}
 }
 function approvalPayloadMatches(data:Hex,amountIn:bigint){try{const decoded=decodeFunctionData({abi:approvalAbi,data});return decoded.functionName==='approve'&&decoded.args[0].toLowerCase()===PANCAKE_V3.router.toLowerCase()&&decoded.args[1]===amountIn;}catch{return false;}}
 app.get('/v1/routes/SPYon/attempts',async req=>{const session=capitalSession(req.headers.cookie,req.headers.origin),access=directPilotAccess(session.address);return {items:(await (await directStore()).history(session.address)).map(publicAttempt),executionEnabled:access.swapEnabled,approvalEnabled:access.approvalEnabled,fullRouteEnabled:access.fullRouteEnabled};});
 app.post('/v1/routes/SPYon/prepare',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const access=directPilotAccess(session.address);
  if(!access.swapEnabled)return reply.code(409).send({error:'DIRECT_EXECUTION_DISABLED'});
  const parsed=directPreflightBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_PREPARATION'});
  const {direction,sellAmountAtomic,buyAmountAtomic}=parsed.data;
  const requestedAmount=direction==='BUY'?BigInt(buyAmountAtomic??'10000000000000000000'):BigInt(sellAmountAtomic!);
  if(!access.fullRouteEnabled&&(direction!=='BUY'||requestedAmount>10n**18n))return reply.code(409).send({error:'DIRECT_SWAP_TRIAL_LIMIT'});
  if(direction==='BUY'&&!(await checkBuyCapital(session.address,requestedAmount)))return reply.code(409).send({error:'PROTECTED_CASH_OR_POLICY_BLOCKS_TRADE'});
  const {view,transaction}=await (options.directPreparer??readDirectPreparation)(session.address,direction,sellAmountAtomic,buyAmountAtomic);
  const checkedAt=Date.parse(view.checkedAt),expiry=Math.min(checkedAt+20000,Number(transaction.deadline)*1000);
  if(!Number.isFinite(checkedAt)||Date.now()-checkedAt>10000||Date.now()<checkedAt-10000||expiry<=Date.now()||view.gates.poolIdentity!=='CHECKED'||view.gates.calldataMeaning!=='CHECKED'||view.gates.referenceCost!=='CHECKED'||view.gates.funds!=='CHECKED'||view.gates.spendingPermission!=='CHECKED'||view.gates.simulation!=='PASSED'||view.gates.gas!=='CHECKED'||transaction.chainId!==56||transaction.from.toLowerCase()!==session.address||transaction.to.toLowerCase()!==PANCAKE_V3.router.toLowerCase()||transaction.value!==0n||transaction.amountIn!==requestedAmount||transaction.amountIn.toString()!==view.amountInAtomic||transaction.amountOutMinimum.toString()!==view.minimumOutAtomic||transaction.tokenIn.toLowerCase()!==view.assetIn.toLowerCase()||transaction.tokenOut.toLowerCase()!==view.assetOut.toLowerCase()||!swapPayloadMatches(transaction.data,session.address,transaction.amountIn,transaction.amountOutMinimum,transaction.deadline,direction))return reply.code(409).send({error:'DIRECT_PREFLIGHT_BLOCKED'});
  const attempt=await (await directStore()).prepare({wallet:session.address,kind:'swap',direction,chainId:56,to:transaction.to,data:transaction.data,valueAtomic:'0',tokenIn:transaction.tokenIn,tokenOut:transaction.tokenOut,amountInAtomic:transaction.amountIn.toString(),minimumOutAtomic:transaction.amountOutMinimum.toString(),deadline:transaction.deadline.toString(),expiresAt:new Date(expiry).toISOString()});
  // Preparation displays a review, but the one-shot /begin call is needed before calldata is released.
  return {attempt:publicAttempt(attempt)};
 });
 app.post('/v1/routes/SPYon/approval/prepare',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const access=directPilotAccess(session.address);
  if(!access.approvalEnabled)return reply.code(409).send({error:'DIRECT_APPROVAL_DISABLED'});
  const parsed=directPreflightBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_PREPARATION'});
  const {direction,sellAmountAtomic,buyAmountAtomic}=parsed.data;
  const requestedAmount=direction==='BUY'?BigInt(buyAmountAtomic??'10000000000000000000'):BigInt(sellAmountAtomic!);
  if(!access.fullRouteEnabled&&(direction!=='BUY'||requestedAmount>10n**18n))return reply.code(409).send({error:'DIRECT_APPROVAL_TRIAL_LIMIT'});
  if(direction==='BUY'&&!(await checkBuyCapital(session.address,requestedAmount)))return reply.code(409).send({error:'PROTECTED_CASH_OR_POLICY_BLOCKS_TRADE'});
  const {view,transaction}=await (options.directApprovalPreparer??readDirectApprovalPreparation)(session.address,direction,sellAmountAtomic,buyAmountAtomic);
  const checkedAt=Date.parse(view.checkedAt),expiry=Math.min(checkedAt+120000,Number(transaction.deadline)*1000);
  if(!Number.isFinite(checkedAt)||Date.now()-checkedAt>10000||Date.now()<checkedAt-10000||expiry<=Date.now()||view.gates.poolIdentity!=='CHECKED'||view.gates.referenceCost!=='CHECKED'||view.gates.funds!=='CHECKED'||view.gates.spendingPermission!=='BLOCKED'||transaction.chainId!==56||transaction.from.toLowerCase()!==session.address||transaction.to.toLowerCase()!==view.assetIn.toLowerCase()||transaction.value!==0n||transaction.amountIn!==requestedAmount||transaction.amountIn.toString()!==view.amountInAtomic||transaction.amountOutMinimum!==0n||transaction.tokenIn.toLowerCase()!==view.assetIn.toLowerCase()||transaction.tokenOut.toLowerCase()!==view.assetOut.toLowerCase()||!approvalPayloadMatches(transaction.data,transaction.amountIn))return reply.code(409).send({error:'DIRECT_APPROVAL_BLOCKED'});
  const attempt=await (await directStore()).prepare({wallet:session.address,kind:'approval',direction,chainId:56,to:transaction.to,data:transaction.data,valueAtomic:'0',tokenIn:transaction.tokenIn,tokenOut:transaction.tokenOut,amountInAtomic:transaction.amountIn.toString(),minimumOutAtomic:'0',deadline:transaction.deadline.toString(),expiresAt:new Date(expiry).toISOString()});
  return {attempt:publicAttempt(attempt)};
 });
 app.post('/v1/routes/SPYon/begin',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const parsed=attemptIdBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_ATTEMPT'});
  const store=await directStore(),pending=await store.get(session.address,parsed.data.attemptId);
  if(!pending)return reply.code(404).send({error:'DIRECT_ATTEMPT_NOT_FOUND'});
  const access=directPilotAccess(session.address);
  if(pending.kind==='swap'&&!access.swapEnabled)return reply.code(409).send({error:'DIRECT_EXECUTION_DISABLED'});
  if(pending.kind==='approval'&&!access.approvalEnabled)return reply.code(409).send({error:'DIRECT_APPROVAL_DISABLED'});
  if(pending.kind==='swap'&&!access.fullRouteEnabled&&(pending.direction!=='BUY'||BigInt(pending.amountInAtomic)>10n**18n))return reply.code(409).send({error:'DIRECT_SWAP_TRIAL_LIMIT'});
  if(pending.kind==='approval'&&!access.fullRouteEnabled&&(pending.direction!=='BUY'||BigInt(pending.amountInAtomic)>10n**18n))return reply.code(409).send({error:'DIRECT_APPROVAL_TRIAL_LIMIT'});
  if(pending.direction==='BUY'&&!(await checkBuyCapital(session.address,BigInt(pending.amountInAtomic))))return reply.code(409).send({error:'PROTECTED_CASH_OR_POLICY_BLOCKS_TRADE'});
  const attempt=await store.begin(session.address,parsed.data.attemptId);
  return {attemptId:attempt.id,state:attempt.state,transaction:{chainId:56,from:attempt.wallet,to:attempt.to,value:'0x0',data:attempt.data},note:'The submission barrier is committed. If the wallet result is unknown, do not retry.'};
 });
 app.post('/v1/routes/SPYon/abandon',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const parsed=attemptIdBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_ATTEMPT'});
  const attempt=await (await directStore()).abandon(session.address,parsed.data.attemptId);return {attempt:publicAttempt(attempt)};
 });
 app.post('/v1/routes/SPYon/hash',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const parsed=attemptHashBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_ATTEMPT_HASH'});
  const attempt=await (await directStore()).recordHash(session.address,parsed.data.attemptId,parsed.data.transactionHash);return {attempt:publicAttempt(attempt)};
 });
 app.post('/v1/routes/SPYon/reconcile',async(req,reply)=>{
  const session=capitalSession(req.headers.cookie,req.headers.origin,true);
  const parsed=attemptIdBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_DIRECT_ATTEMPT'});
  const store=await directStore(),attempt=await store.get(session.address,parsed.data.attemptId);
  if(!attempt)return reply.code(404).send({error:'DIRECT_ATTEMPT_NOT_FOUND'});
  if(attempt.state==='confirmed'||attempt.state==='reverted')return {attempt:publicAttempt(attempt)};
  if(attempt.state!=='submitted')return reply.code(409).send({error:'DIRECT_ATTEMPT_UNRESOLVED',attempt:publicAttempt(attempt)});
  try{const settlement=await (options.directSettlementReader??readDirectSettlement)(attempt);return {attempt:publicAttempt(await store.settle(session.address,attempt.id,settlement))};}
  catch{return reply.code(409).send({error:'DIRECT_SETTLEMENT_NOT_VERIFIED',attempt:publicAttempt(attempt)});}
 });
 app.post('/v1/plans/preview',async(req,reply)=>{
  const input=mandateSchema.safeParse(req.body);if(!input.success)return reply.code(400).send({error:'INVALID_MANDATE',issues:input.error.issues.map(i=>({path:i.path,message:i.message}))});
  return previewInvestment(input.data,instruments,quotesFor(input.data.scenario));
 });
 app.post('/v1/withdrawals/preview',async(req,reply)=>{
  const body=req.body as {target?:unknown;scenario?:unknown}|null;const amount=amountSchema.safeParse(body?.target);
  if(!amount.success)return reply.code(400).send({error:'INVALID_AMOUNT'});
  return previewWithdrawal(amount.data,'0',[{id:'scenario:NVDA:bstock',maxNet:'700',available:true},{id:'scenario:SPY:ondo',maxNet:'1100',available:true},{id:'scenario:SGOV:ondo',maxNet:'690',available:body?.scenario!=='missing'}]);
 });
 app.setErrorHandler((error,_req,reply)=>{if(error instanceof WalletSessionError)return reply.code(error.statusCode).send({error:error.code});if(error instanceof InflowReadError)return reply.code(503).send({error:'INFLOW_PROOF_UNAVAILABLE',message:'Receipt, payment identity, canonical block or 12 confirmations could not be verified.'});if(error instanceof CapitalReadError)return reply.code(503).send({error:'CAPITAL_READ_UNAVAILABLE',state:'UNKNOWN',executionAllowed:false});if(error instanceof LedgerError||error instanceof DirectAttemptError)return reply.code(409).send({error:error.code});reply.code(500).send({error:'INTERNAL_ERROR',message:'The request could not be completed.'});});
 return Object.assign(app,{runRecurringDue});
}
