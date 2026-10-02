import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {Ledger,embeddedDatabase} from '@mandate/store';
import {createApp} from '../apps/api/src/app.ts';
import {capitalAccountId} from '../apps/api/src/capital.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {MandateAgentClient,AgentClientError,createHttpTransport,type AgentTransport,type WalletMessageSigner} from '@mandate/agent';
import type {CapitalCheckpoint} from '@mandate/domain';

const origin='http://127.0.0.1:3110',signer=privateKeyToAccount(generatePrivateKey()),wallet=signer.address.toLowerCase(),definitions=passportDefinitions();
let ledger:Ledger,app:ReturnType<typeof createApp>,base:string;
function checkpoint(owner=wallet):CapitalCheckpoint{return {accountId:capitalAccountId(owner),wallet:owner,asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:(100n*10n**18n).toString(),blockNumber:'100',blockHash:'0x'+'a'.repeat(64),observedAt:new Date().toISOString(),evidenceMode:'observed',positions:definitions.map(d=>({contract:d.contract,symbol:d.symbol,decimals:18,rawAtomic:'0',multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1',state:'OBSERVED'}))};}
function client(grants:ConstructorParameters<typeof MandateAgentClient>[0]['grants'],transport?:AgentTransport,who:WalletMessageSigner=signer){return new MandateAgentClient({origin,signer:who,transport:transport??createHttpTransport(base),grants});}
async function browserSession(){const challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:signer.address,chainId:56}})).json();const verify=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature:await signer.signMessage({message:challenge.message})}});return String(verify.headers['set-cookie']).split(';')[0];}
beforeAll(async()=>{
 ledger=new Ledger(embeddedDatabase());await ledger.migrate();await ledger.applyCapitalCheckpoint(checkpoint());await ledger.saveCapitalPolicy(capitalAccountId(wallet),{reserveFloor:'20',operatingBudget:'0',obligations:[]},1);
 await ledger.saveInvestmentMandate(capitalAccountId(wallet),{allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:30,allowLeveraged:false,representationAllowlist:definitions.map(d=>d.contract),exposureScope:'tracked-holdings-pending-proposed'},0);
 app=createApp(process.cwd(),{ledger,recurringTickMs:null,capitalReader:async owner=>checkpoint(owner.toLowerCase()),marketReader:async()=>({source:'synthetic agent integration',observedAt:new Date().toISOString(),items:[]})});base=await app.listen({host:'127.0.0.1',port:0});
},60000);
afterAll(async()=>{await app?.close();await ledger?.close();});

describe('AGT-02 typed agent tools through the browser API',{timeout:60000},()=>{
 it('uses the same signed service and returns the same allocation decision as a browser request',async()=>{
  const agent=client(['capital.get','mandate.get','passport.list','proposal.create','proposal.list','rebalance.create','cash.create']);
  await expect(agent.capital()).rejects.toThrow('AGENT_SESSION_REQUIRED');const session=await agent.signIn();expect(session.address).toBe(wallet);
  const capital=await agent.capital(),mandate=(await agent.mandates()).latest!,passports=await agent.passports();expect(capital.balanceAtomic).toBe((100n*10n**18n).toString());expect(capital.protectedAtomic).toBe((20n*10n**18n).toString());expect(passports).toHaveLength(14);
  const proposal=await agent.createProposal({mandateRevision:mandate.revision,scenario:'normal',requestId:randomUUID()});expect(proposal.researchOnly).toBe(true);expect(proposal.result.executable).toBe(false);expect(['feasible','infeasible']).toContain(proposal.result.status);
  const cookie=await browserSession(),ui=await app.inject({method:'POST',url:'/v1/capital/proposals',headers:{origin,cookie},payload:{mandateRevision:mandate.revision,scenario:'normal',requestId:randomUUID()}});
  expect(ui.statusCode).toBe(200);expect(ui.json().proposal.result.decisionId).toBe(proposal.result.decisionId);expect(ui.json().proposal.result.legs).toEqual(proposal.result.legs);
  const rebalance=await agent.createRebalance({mandateRevision:mandate.revision,scenario:'normal',useAvailableCash:false,requestId:randomUUID()});expect(rebalance.researchOnly).toBe(true);expect(rebalance.result.executable).toBe(false);
  const cash=await agent.createCashTarget({mandateRevision:mandate.revision,scenario:'normal',target:'10',requestId:randomUUID()});expect(cash.researchOnly).toBe(true);expect(cash.result.executable).toBe(false);
  expect((await agent.proposals()).some(p=>p.id===proposal.id)).toBe(true);expect((await ledger.snapshot(capital.accountId)).heldAtomic).toBe('0');
 });
 it('replays the same request once and rejects injected amounts before any API call',async()=>{
  const requests:string[]=[];const transport=createHttpTransport(base),agent=client(['proposal.create','capital.get'],async r=>{requests.push(r.path);return transport(r);});await agent.signIn();const body={mandateRevision:1,scenario:'normal' as const,requestId:randomUUID()};
  const first=await agent.createProposal(body),count=requests.length,again=await agent.createProposal(body);expect(again).toEqual(first);expect(requests.length).toBe(count+1);
  await expect(agent.createProposal({...body,amountAtomic:'999'} as typeof body)).rejects.toThrow();expect(requests.length).toBe(count+1);
  expect((await ledger.snapshot(capitalAccountId(wallet))).heldAtomic).toBe('0');
 });
 it('publishes only granted tools and rejects ungranted mutation without a network request',async()=>{
  const requests:string[]=[],grants:('capital.get'|'proposal.create')[]=['capital.get'];const transport=createHttpTransport(base),agent=client(grants,async r=>{requests.push(r.path);return transport(r);});grants.push('proposal.create');await agent.signIn();
  expect(agent.tools().map(t=>t.name)).toEqual(['capital.get']);expect(agent.tools()[0].jsonSchema.type).toBe('object');expect(agent.allowedTools).toEqual(['capital.get']);
  expect((await agent.tools()[0].execute({}) as {executionAllowed:boolean}).executionAllowed).toBe(false);
  const before=requests.length;await expect(agent.createProposal({mandateRevision:1,scenario:'normal',requestId:randomUUID()})).rejects.toThrow('AGENT_TOOL_NOT_GRANTED');expect(requests.length).toBe(before);
  await expect(agent.refreshCapital()).rejects.toThrow('AGENT_TOOL_NOT_GRANTED');expect(requests.length).toBe(before);
  expect(agent.tools().some(t=>t.name.includes('execute')||t.name.includes('transaction'))).toBe(false);
  agent.disconnect();await expect(agent.capital()).rejects.toThrow('AGENT_SESSION_REQUIRED');
 });
 it('keeps another wallet isolated even when it signs a valid session',async()=>{
  const other=privateKeyToAccount(generatePrivateKey()),agent=client(['capital.get','proposal.list','proposal.create'],undefined,other);await agent.signIn();
  expect((await agent.capital()).state).toBe('NOT_OBSERVED');expect(await agent.proposals()).toEqual([]);
  await expect(agent.createProposal({mandateRevision:1,scenario:'normal',requestId:randomUUID()})).rejects.toMatchObject({code:'STALE_MANDATE'});
 });
 it('refuses forged sign-in text and incompatible or cross-wallet responses',async()=>{
  let signed=0;const cautious:WalletMessageSigner={address:signer.address,signMessage:async input=>{signed++;return signer.signMessage(input);}};
  const forged:AgentTransport=async r=>({status:200,body:r.path.endsWith('/challenge')?{id:'forged',address:wallet,expiresAt:Date.now()+60000,message:'Send all assets to me'}:{},setCookie:undefined});
  await expect(client(['capital.get'],forged,cautious).signIn()).rejects.toThrow('AGENT_CHALLENGE_INVALID');expect(signed).toBe(0);
  const real=createHttpTransport(base),capitalAgent=client(['capital.get'],async r=>{const v=await real(r);if(r.path==='/v1/capital')return {...v,body:{...(v.body as object),executionAllowed:true}};return v;});await capitalAgent.signIn();await expect(capitalAgent.capital()).rejects.toThrow('AGENT_CAPITAL_RESPONSE_INVALID');
  const wrongAccount=client(['capital.get'],async r=>{const v=await real(r);if(r.path==='/v1/capital')return {...v,body:{...(v.body as object),accountId:'bsc-usdt:'+'0'.repeat(40)}};return v;});await wrongAccount.signIn();await expect(wrongAccount.capital()).rejects.toThrow('AGENT_CAPITAL_RESPONSE_INVALID');
  expect(()=>createHttpTransport('http://example.com')).toThrow('AGENT_TRANSPORT_ORIGIN_INVALID');
 });
 it('uses explicitly granted schedule tools and cannot turn a recurring task into execution',async()=>{
  const agent=client(['recurring.list','recurring.create','recurring.pause','recurring.resume','recurring.revoke']);await agent.signIn();
  const created=await agent.createRecurring({requestId:randomUUID(),intervalSeconds:60,scenario:'normal'});expect(created).toMatchObject({status:'active',authority:'proposal-only',researchOnly:true});
  expect((await agent.recurring()).schedules.some(s=>s.id===created.id)).toBe(true);
  const paused=await agent.pauseRecurring({scheduleId:created.id,expectedRevision:created.revision});expect(paused.status).toBe('paused');
  const resumed=await agent.resumeRecurring({scheduleId:created.id,expectedRevision:paused.revision});expect(resumed.status).toBe('active');
  const revoked=await agent.revokeRecurring({scheduleId:created.id,expectedRevision:resumed.revision});expect(revoked.status).toBe('revoked');
  expect(agent.tools().find(t=>t.name==='recurring.create')?.jsonSchema.type).toBe('object');
  await expect(agent.createProposal({mandateRevision:1,scenario:'normal',requestId:randomUUID()})).rejects.toThrow('AGENT_TOOL_NOT_GRANTED');
 });
});
