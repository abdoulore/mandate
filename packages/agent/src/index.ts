import {createHash} from 'node:crypto';
import {z} from 'zod';
import {cashTargetSchema,inflowReviewSchema,investmentPolicySchema,mandateSchema,recurringScheduleInputSchema,recurringChangeSchema,type RecurringSchedule,type RecurringFiring,type CapitalView,type InflowRecord,type InstrumentPassport,type MandateInput,type PlanResult,type ResearchCashRaising,type ResearchProposal,type ResearchRebalance,type SavedInvestmentMandate} from '@mandate/domain';

const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/),uuid=z.string().uuid(),scenario=z.enum(['normal','expensive','missing']);
const baseProposal=z.object({mandateRevision:z.number().int().positive(),scenario,requestId:uuid}).strict();
const revalidate=baseProposal.extend({proposalId:uuid}).strict();
const rebalance=baseProposal.extend({useAvailableCash:z.boolean()}).strict();
const cashTarget=baseProposal.extend({target:cashTargetSchema}).strict();
const review=z.object({transactionHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/),review:inflowReviewSchema,expectedRevision:z.number().int().nonnegative()}).strict();
const inflowProposal=baseProposal.extend({transactionHash:review.shape.transactionHash,expectedReviewRevision:z.number().int().positive()}).strict();
const policyUpdate=z.object({policy:investmentPolicySchema,expectedRevision:z.number().int().nonnegative()}).strict();
const empty=z.object({}).strict();

export const agentToolNames=['capital.get','capital.refresh','mandate.get','mandate.save','passport.list','allocation.preview','proposal.list','proposal.create','proposal.revalidate','rebalance.list','rebalance.create','cash.list','cash.create','inflow.list','inflow.review','inflow.propose','recurring.list','recurring.create','recurring.pause','recurring.resume','recurring.revoke'] as const;
export type AgentToolName=typeof agentToolNames[number];
export type WalletMessageSigner={address:`0x${string}`;signMessage(input:{message:string}):Promise<`0x${string}`>};
export type AgentRequest={method:'GET'|'POST';path:string;headers:Readonly<Record<string,string>>;body?:unknown};
export type AgentResponse={status:number;body:unknown;setCookie?:string};
export type AgentTransport=(request:AgentRequest)=>Promise<AgentResponse>;
export class AgentClientError extends Error{constructor(readonly code:string,readonly status?:number){super(code);}}

// Node agents use an explicit cookie; no browser automation or private key import is required.
export function createHttpTransport(baseUrl:string,requestFetch:typeof fetch=fetch):AgentTransport{
 const base=new URL(baseUrl);
 if(base.username||base.password||base.search||base.hash||!['https:','http:'].includes(base.protocol)||base.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('AGENT_TRANSPORT_ORIGIN_INVALID');
 const prefix=base.pathname.replace(/\/$/,'');
 return async request=>{
  const response=await requestFetch(new URL(prefix+request.path,base.origin),{method:request.method,headers:request.headers,body:request.body===undefined?undefined:JSON.stringify(request.body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(65000)});
  let body:unknown;try{body=await response.json();}catch{throw new AgentClientError('AGENT_RESPONSE_INVALID',response.status);}
  return {status:response.status,body,setCookie:response.headers.get('set-cookie')??undefined};
 };
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new AgentClientError('AGENT_RESPONSE_INVALID');return value as Record<string,unknown>;}
function accountId(wallet:string){return 'bsc-usdt:'+createHash('sha256').update(wallet.toLowerCase()).digest('hex').slice(0,40);}
function researchRecord<T extends {accountId:string;researchOnly:true;result:{executable:false}}>(value:unknown,wallet:string):T{
 const v=object(value),result=object(v.result),inputs=object(v.inputs),funding=object(inputs.funding);
 if(v.researchOnly!==true||result.executable!==false||v.accountId!==accountId(wallet)||funding.accountId!==accountId(wallet)||typeof v.id!=='string'||!v.id)throw new AgentClientError('AGENT_RESEARCH_RESPONSE_INVALID');
 return value as T;
}
function capitalResponse(value:unknown,wallet:string):CapitalView{
 const v=object(value);
 if(v.executionAllowed!==false||!['OBSERVED','STALE','UNKNOWN','NOT_OBSERVED'].includes(String(v.state))||typeof v.balanceAtomic!=='string'||typeof v.protectedAtomic!=='string'||typeof v.availableAtomic!=='string'||v.accountId!==accountId(wallet))throw new AgentClientError('AGENT_CAPITAL_RESPONSE_INVALID');
 return value as CapitalView;
}
function responseResult<T>(value:unknown,field:string):T{return object(value)[field] as T;}

export type AgentTool={name:AgentToolName;description:string;inputSchema:z.ZodType<unknown>;jsonSchema:Record<string,unknown>;execute(input:unknown):Promise<unknown>};
type Config={origin:string;signer:WalletMessageSigner;transport:AgentTransport;grants:readonly AgentToolName[];expiresAt?:number};
export class MandateAgentClient{
 readonly #origin:string;readonly #signer:WalletMessageSigner;readonly #transport:AgentTransport;readonly #grants:ReadonlySet<AgentToolName>;readonly #expiresAt:number;
 #cookie:string|null=null;#wallet:string|null=null;
 constructor(config:Config){
  const origin=new URL(config.origin);
  if(origin.origin!==config.origin||origin.username||origin.password||origin.search||origin.hash||origin.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||!['https:','http:'].includes(origin.protocol))throw new Error('AGENT_ORIGIN_INVALID');
  this.#origin=origin.origin;this.#signer=config.signer;this.#transport=config.transport;
  address.parse(config.signer.address);
  if(config.grants.some(g=>!agentToolNames.includes(g)))throw new Error('AGENT_GRANT_INVALID');
  this.#grants=new Set(config.grants);
  this.#expiresAt=config.expiresAt??Date.now()+60*60*1000;
  if(!Number.isFinite(this.#expiresAt)||this.#expiresAt<=Date.now()||this.#expiresAt>Date.now()+12*60*60*1000)throw new Error('AGENT_SCOPE_EXPIRY_INVALID');
 }
 get wallet(){return this.#wallet;}
 get allowedTools():readonly AgentToolName[]{return Object.freeze([...this.#grants]);}
 #scope(name:AgentToolName){if(Date.now()>=this.#expiresAt)throw new AgentClientError('AGENT_SCOPE_EXPIRED');if(!this.#grants.has(name))throw new AgentClientError('AGENT_TOOL_NOT_GRANTED');if(!this.#cookie||!this.#wallet)throw new AgentClientError('AGENT_SESSION_REQUIRED');}
 async #send(method:'GET'|'POST',path:string,body?:unknown,authenticated=true){
  const headers:Record<string,string>={Origin:this.#origin};if(method==='POST')headers['Content-Type']='application/json';if(authenticated&&this.#cookie)headers.Cookie=this.#cookie;
  const response=await this.#transport({method,path,headers,body});if(response.status<200||response.status>=300){const error=object(response.body);throw new AgentClientError(typeof error.error==='string'?error.error:'AGENT_API_ERROR',response.status);}return response;
 }
 async signIn(){
  if(Date.now()>=this.#expiresAt)throw new AgentClientError('AGENT_SCOPE_EXPIRED');
  const expected=this.#signer.address.toLowerCase();const challenge=object((await this.#send('POST','/v1/wallet/challenge',{address:this.#signer.address,chainId:56},false)).body);
  if(typeof challenge.id!=='string'||typeof challenge.message!=='string'||typeof challenge.expiresAt!=='number'||challenge.expiresAt<=Date.now()||challenge.expiresAt>Date.now()+90000||String(challenge.address).toLowerCase()!==expected)throw new AgentClientError('AGENT_CHALLENGE_INVALID');
  const lines=challenge.message.split('\n');
  const issued=lines[5]?.startsWith('Issued At: ')?Date.parse(lines[5].slice(11)):NaN,expires=lines[6]?.startsWith('Expiration Time: ')?Date.parse(lines[6].slice(17)):NaN;
  if(lines.length!==9||lines[0]!=='Mandate read-only wallet sign-in'||lines[1]!=='Origin: '+this.#origin||lines[2]!=='Address: '+expected||lines[3]!=='Chain ID: 56 (BNB Smart Chain)'||lines[4]!=='Nonce: '+challenge.id||!Number.isFinite(issued)||issued>Date.now()||issued<Date.now()-90000||expires!==challenge.expiresAt||lines[7]!=='Purpose: Prove wallet ownership for a read-only Mandate session.'||lines[8]!=='This signature cannot authorize a token approval, transfer, or transaction.')throw new AgentClientError('AGENT_CHALLENGE_INVALID');
  const signature=await this.#signer.signMessage({message:challenge.message});
  const verified=await this.#send('POST','/v1/wallet/verify',{challengeId:challenge.id,signature},false),session=object(verified.body),cookie=verified.setCookie?.split(';')[0];
  if(String(session.address).toLowerCase()!==expected||session.chainId!==56||typeof session.expiresAt!=='number'||session.expiresAt<=Date.now()||!cookie?.startsWith('mandate_session='))throw new AgentClientError('AGENT_SESSION_INVALID');
  this.#cookie=cookie;this.#wallet=expected;return {address:expected,chainId:56 as const,expiresAt:session.expiresAt};
 }
 disconnect(){this.#cookie=null;this.#wallet=null;}
 async capital(){this.#scope('capital.get');return capitalResponse((await this.#send('GET','/v1/capital')).body,this.#wallet!);}
 async refreshCapital(){this.#scope('capital.refresh');return capitalResponse((await this.#send('POST','/v1/capital/refresh',{})).body,this.#wallet!);}
 async mandates():Promise<{latest:SavedInvestmentMandate|null;history:SavedInvestmentMandate[];researchOnly:true}>{this.#scope('mandate.get');const data=object((await this.#send('GET','/v1/capital/mandates')).body);if(data.researchOnly!==true||!Array.isArray(data.history)||data.history.some((v:unknown)=>object(v).accountId!==accountId(this.#wallet!))||data.latest!==null&&object(data.latest).accountId!==accountId(this.#wallet!))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data as {latest:SavedInvestmentMandate|null;history:SavedInvestmentMandate[];researchOnly:true};}
 async saveMandate(input:z.input<typeof policyUpdate>):Promise<SavedInvestmentMandate>{this.#scope('mandate.save');const data=object((await this.#send('POST','/v1/capital/mandates',policyUpdate.parse(input))).body);if(data.researchOnly!==true||object(data.latest).accountId!==accountId(this.#wallet!))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data.latest as SavedInvestmentMandate;}
 async passports():Promise<InstrumentPassport[]>{this.#scope('passport.list');const data=object((await this.#send('GET','/v1/instruments/passports')).body);if(!Array.isArray(data.items)||data.items.some((v:unknown)=>object(v).executionAllowed!==false))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data.items as InstrumentPassport[];}
 async previewAllocation(input:MandateInput):Promise<PlanResult>{this.#scope('allocation.preview');const result=object((await this.#send('POST','/v1/capital/preview',mandateSchema.parse(input))).body);if(result.executable!==false||!['feasible','infeasible'].includes(String(result.status))||object(result.capitalBasis).accountId!==accountId(this.#wallet!))throw new AgentClientError('AGENT_RESEARCH_RESPONSE_INVALID');return result as PlanResult;}
 async proposals():Promise<ResearchProposal[]>{this.#scope('proposal.list');const data=object((await this.#send('GET','/v1/capital/proposals')).body);if(data.researchOnly!==true||!Array.isArray(data.items))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data.items.map((v:unknown)=>researchRecord<ResearchProposal>(v,this.#wallet!));}
 async createProposal(input:z.input<typeof baseProposal>):Promise<ResearchProposal>{this.#scope('proposal.create');const data=object((await this.#send('POST','/v1/capital/proposals',baseProposal.parse(input))).body);if(data.researchOnly!==true)throw new AgentClientError('AGENT_RESPONSE_INVALID');return researchRecord<ResearchProposal>(data.proposal,this.#wallet!);}
 async revalidateProposal(input:z.input<typeof revalidate>):Promise<{proposal:ResearchProposal;capital:CapitalView}>{this.#scope('proposal.revalidate');const data=object((await this.#send('POST','/v1/capital/proposals/revalidate',revalidate.parse(input))).body);if(data.researchOnly!==true)throw new AgentClientError('AGENT_RESPONSE_INVALID');return {proposal:researchRecord<ResearchProposal>(data.proposal,this.#wallet!),capital:capitalResponse(data.capital,this.#wallet!)};}
 async rebalances():Promise<ResearchRebalance[]>{this.#scope('rebalance.list');const data=object((await this.#send('GET','/v1/capital/rebalances')).body);if(data.researchOnly!==true||!Array.isArray(data.items))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data.items.map((v:unknown)=>researchRecord<ResearchRebalance>(v,this.#wallet!));}
 async createRebalance(input:z.input<typeof rebalance>):Promise<ResearchRebalance>{this.#scope('rebalance.create');const data=object((await this.#send('POST','/v1/capital/rebalances',rebalance.parse(input))).body);if(data.researchOnly!==true)throw new AgentClientError('AGENT_RESPONSE_INVALID');return researchRecord<ResearchRebalance>(data.rebalance,this.#wallet!);}
 async cashTargets():Promise<ResearchCashRaising[]>{this.#scope('cash.list');const data=object((await this.#send('GET','/v1/capital/cash-raising')).body);if(data.researchOnly!==true||!Array.isArray(data.items))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data.items.map((v:unknown)=>researchRecord<ResearchCashRaising>(v,this.#wallet!));}
 async createCashTarget(input:z.input<typeof cashTarget>):Promise<ResearchCashRaising>{this.#scope('cash.create');const data=object((await this.#send('POST','/v1/capital/cash-raising',cashTarget.parse(input))).body);if(data.researchOnly!==true)throw new AgentClientError('AGENT_RESPONSE_INVALID');return researchRecord<ResearchCashRaising>(data.cashRaising,this.#wallet!);}
 async inflows():Promise<{record:InflowRecord;proposalId?:string}[]>{this.#scope('inflow.list');const data=object((await this.#send('GET','/v1/capital/inflows')).body);if(data.researchOnly!==true||!Array.isArray(data.items)||data.items.some((v:unknown)=>object(object(v).record).accountId!==accountId(this.#wallet!)))throw new AgentClientError('AGENT_RESPONSE_INVALID');return data.items as {record:InflowRecord;proposalId?:string}[];}
 async reviewInflow(input:z.input<typeof review>):Promise<{record:InflowRecord;capital:CapitalView}>{this.#scope('inflow.review');const data=object((await this.#send('POST','/v1/capital/inflows/check',review.parse(input))).body);if(data.researchOnly!==true||object(data.record).researchOnly!==true||object(data.record).accountId!==accountId(this.#wallet!))throw new AgentClientError('AGENT_RESPONSE_INVALID');return {record:data.record as InflowRecord,capital:capitalResponse(data.capital,this.#wallet!)};}
 async proposeInflow(input:z.input<typeof inflowProposal>):Promise<{proposal:ResearchProposal;capital:CapitalView}>{this.#scope('inflow.propose');const data=object((await this.#send('POST','/v1/capital/inflows/propose',inflowProposal.parse(input))).body);if(data.researchOnly!==true)throw new AgentClientError('AGENT_RESPONSE_INVALID');return {proposal:researchRecord<ResearchProposal>(data.proposal,this.#wallet!),capital:capitalResponse(data.capital,this.#wallet!)};}
 async recurring():Promise<{schedules:RecurringSchedule[];firings:RecurringFiring[]}>{this.#scope('recurring.list');const data=object((await this.#send('GET','/v1/capital/recurring')).body);if(data.researchOnly!==true||data.executionAllowed!==false||!Array.isArray(data.schedules)||!Array.isArray(data.firings)||data.schedules.some((v:unknown)=>object(v).accountId!==accountId(this.#wallet!)||object(v).authority!=='proposal-only')||data.firings.some((v:unknown)=>object(v).accountId!==accountId(this.#wallet!)))throw new AgentClientError('AGENT_RESPONSE_INVALID');return {schedules:data.schedules as RecurringSchedule[],firings:data.firings as RecurringFiring[]};}
 async createRecurring(input:z.input<typeof recurringScheduleInputSchema>):Promise<RecurringSchedule>{this.#scope('recurring.create');return this.#recurringWrite('/v1/capital/recurring',recurringScheduleInputSchema.parse(input));}
 async pauseRecurring(input:z.input<typeof recurringChangeSchema>):Promise<RecurringSchedule>{this.#scope('recurring.pause');return this.#recurringWrite('/v1/capital/recurring/pause',recurringChangeSchema.parse(input));}
 async resumeRecurring(input:z.input<typeof recurringChangeSchema>):Promise<RecurringSchedule>{this.#scope('recurring.resume');return this.#recurringWrite('/v1/capital/recurring/resume',recurringChangeSchema.parse(input));}
 async revokeRecurring(input:z.input<typeof recurringChangeSchema>):Promise<RecurringSchedule>{this.#scope('recurring.revoke');return this.#recurringWrite('/v1/capital/recurring/revoke',recurringChangeSchema.parse(input));}
 async #recurringWrite(path:string,body:unknown):Promise<RecurringSchedule>{const data=object((await this.#send('POST',path,body)).body),schedule=object(data.schedule);if(data.researchOnly!==true||data.executionAllowed!==false||schedule.accountId!==accountId(this.#wallet!)||schedule.authority!=='proposal-only')throw new AgentClientError('AGENT_RESPONSE_INVALID');return schedule as RecurringSchedule;}
 tools():readonly AgentTool[]{
  const definitions:Omit<AgentTool,'jsonSchema'>[]=[
   {name:'capital.get',description:'Inspect this signed wallet capital and pending commitments.',inputSchema:empty,execute:()=>this.capital()},
   {name:'capital.refresh',description:'Refresh this signed wallet chain observations. No transaction is sent.',inputSchema:empty,execute:()=>this.refreshCapital()},
   {name:'mandate.get',description:'Inspect saved investment rules and revisions.',inputSchema:empty,execute:()=>this.mandates()},
   {name:'mandate.save',description:'Save exact research rules with an expected revision.',inputSchema:policyUpdate,execute:a=>this.saveMandate(policyUpdate.parse(a))},
   {name:'passport.list',description:'Inspect sourced instrument passports and execution evidence states.',inputSchema:empty,execute:()=>this.passports()},
   {name:'allocation.preview',description:'Preview research allocation with wallet-bound capital.',inputSchema:mandateSchema,execute:a=>this.previewAllocation(mandateSchema.parse(a))},
   {name:'proposal.list',description:'Inspect immutable research allocation proposals.',inputSchema:empty,execute:()=>this.proposals()},
   {name:'proposal.create',description:'Save a research allocation proposal without a cash hold or trade.',inputSchema:baseProposal,execute:a=>this.createProposal(baseProposal.parse(a))},
   {name:'proposal.revalidate',description:'Refresh evidence and compare a proposal against its immutable parent.',inputSchema:revalidate,execute:a=>this.revalidateProposal(revalidate.parse(a))},
   {name:'rebalance.list',description:'Inspect saved research rebalance history.',inputSchema:empty,execute:()=>this.rebalances()},
   {name:'rebalance.create',description:'Save a research rebalance with modeled, unsettled proceeds.',inputSchema:rebalance,execute:a=>this.createRebalance(rebalance.parse(a))},
   {name:'cash.list',description:'Inspect saved net cash-target history.',inputSchema:empty,execute:()=>this.cashTargets()},
   {name:'cash.create',description:'Save a research cash target; modeled sales do not credit the wallet.',inputSchema:cashTarget,execute:a=>this.createCashTarget(cashTarget.parse(a))},
   {name:'inflow.list',description:'Inspect recorded incoming-funds reviews.',inputSchema:empty,execute:()=>this.inflows()},
   {name:'inflow.review',description:'Verify and classify a receipt; this does not credit cash.',inputSchema:review,execute:a=>this.reviewInflow(review.parse(a))},
   {name:'inflow.propose',description:'Save one research allocation capped by reviewed receipt and current free cash.',inputSchema:inflowProposal,execute:a=>this.proposeInflow(inflowProposal.parse(a))},
   {name:'recurring.list',description:'Inspect this wallet proposal-only schedules and firing history.',inputSchema:empty,execute:()=>this.recurring()},
   {name:'recurring.create',description:'Schedule repeated research proposals using current wallet evidence; no trade authority.',inputSchema:recurringScheduleInputSchema,execute:a=>this.createRecurring(recurringScheduleInputSchema.parse(a))},
   {name:'recurring.pause',description:'Stop new proposal dispatch, including an in-flight worker before persistence.',inputSchema:recurringChangeSchema,execute:a=>this.pauseRecurring(recurringChangeSchema.parse(a))},
   {name:'recurring.resume',description:'Resume a paused proposal-only schedule at its pending due slot.',inputSchema:recurringChangeSchema,execute:a=>this.resumeRecurring(recurringChangeSchema.parse(a))},
   {name:'recurring.revoke',description:'Permanently revoke a proposal-only schedule.',inputSchema:recurringChangeSchema,execute:a=>this.revokeRecurring(recurringChangeSchema.parse(a))},
  ];
  return Object.freeze(definitions.filter(d=>this.#grants.has(d.name)).map(d=>Object.freeze({...d,jsonSchema:z.toJSONSchema(d.inputSchema) as Record<string,unknown>})));
 }
}
