import './smoke-output.mjs';
// Disposable browser fixture for the signed-wallet recurring panel. No chain
// transaction or public wallet is involved.
import {chromium} from '@playwright/test';
import {defaultMandate} from '../packages/core/src/index.ts';

const address='0x'+'1'.repeat(40),origin='http://127.0.0.1:3110',now=()=>new Date().toISOString();
const policy={allocations:[{underlying:'SPY',weightBps:10000}],maxIssuerBps:10000,maxCostBps:30,allowLeveraged:false,representationAllowlist:[],exposureScope:'tracked-holdings-pending-proposed'};
let saved=null;
const checkpoint={accountId:'fixture',wallet:address,asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:'0',blockNumber:'123',blockHash:'0x'+'2'.repeat(64),observedAt:now(),evidenceMode:'observed',positions:[]};
const capital={state:'OBSERVED',executionAllowed:false,accountId:'fixture',revision:1,decimals:18,balanceAtomic:'0',protectedAtomic:'0',heldAtomic:'0',availableAtomic:'0',shortfallAtomic:'0',checkpointId:'fixture-checkpoint',checkpoint,portfolio:null,pending:[],policy:{reserveFloor:'0',operatingBudget:'0',obligations:[]},policyRevision:0};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),pageErrors=[],walletCalls=[];
page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.message));
let schedules=[],firings=[],proposals=[],createPayload=null,revision=0;
const respond=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
try{
 await page.addInitScript(address=>{window.binancew3w={ethereum:{request:async({method})=>{if(method==='eth_accounts')return [address];if(method==='eth_chainId')return '0x38';throw new Error('Fixture has no chain reads: '+method);}}};},address);
 await page.route('**/api/v1/wallet/session',route=>respond(route,{session:{address,chainId:56,expiresAt:Date.now()+3600000}}));
 await page.route('**/api/v1/workspace',route=>respond(route,{schemaVersion:'1.0.0',mode:'scenario',executionEnabled:false,mandate:defaultMandate,instruments:[],capabilities:{checkedAt:null,checks:[]}}));
 await page.route('**/api/v1/capital',route=>respond(route,capital));
 await page.route('**/api/v1/capital/mandates',route=>{if(route.request().method()==='GET')return respond(route,{latest:saved,history:saved?[saved]:[]});const body=JSON.parse(route.request().postData());saved={id:'fixture-mandate',accountId:'fixture',revision:1,createdAt:now(),researchOnly:true,policy:body.policy};capital.revision++;return respond(route,{latest:saved,capital});});
 await page.route('**/api/v1/capital/proposals',route=>respond(route,{items:proposals}));
 for(const name of ['rebalances','cash-raising','inflows'])await page.route('**/api/v1/capital/'+name,route=>respond(route,{items:[]}));
 await page.route('**/api/v1/capital/recurring',route=>{
  if(route.request().method()==='GET')return respond(route,{schedules,firings,researchOnly:true,executionAllowed:false});
  const body=JSON.parse(route.request().postData());createPayload=body;
  if('wallet' in body||'executionAllowed' in body||'authority' in body)throw new Error('UI supplied trading authority or wallet');
  const schedule={id:'22222222-2222-4222-8222-222222222222',accountId:'fixture',wallet:address,requestId:body.requestId,status:'active',revision:++revision,intervalSeconds:body.intervalSeconds,scenario:body.scenario,startsAt:now(),nextDueAt:now(),createdAt:now(),updatedAt:now(),researchOnly:true,authority:'proposal-only'};
  schedules=[schedule];return respond(route,{schedule,researchOnly:true,executionAllowed:false});
 });
 await page.route('**/api/v1/capital/recurring/*',route=>{
  const action=route.request().url().split('/').pop(),body=JSON.parse(route.request().postData());
  if(body.scheduleId!==schedules[0].id||body.expectedRevision!==schedules[0].revision)throw new Error('UI used stale schedule revision');
  const schedule={...schedules[0],revision:++revision,status:action==='pause'?'paused':action==='resume'?'active':'revoked',updatedAt:now()};schedules=[schedule];return respond(route,{schedule,researchOnly:true,executionAllowed:false});
 });
 await page.goto(origin+'/recurring',{waitUntil:'networkidle'});
 const panel=page.getByLabel('Recurring research schedules');await page.getByRole('link',{name:'Recurring checks ↓'}).click();await panel.getByText('No recurring checks yet.').waitFor();if(!page.url().endsWith('#recurring-checks'))throw new Error('Schedule jump link did not reach the panel');
 await panel.getByRole('button',{name:'Create research schedule'}).click();await panel.getByText('Save investment rules before creating a schedule.',{exact:false}).waitFor();if(createPayload)throw new Error('Created a schedule without saved investment rules');
 await page.getByRole('button',{name:'Save investment rules'}).click();await page.getByText('Saved revision 1',{exact:true}).waitFor();
 await page.getByLabel('Maximum with one token issuer · %',{exact:true}).fill('65');await panel.getByText('You have unsaved edits.',{exact:false}).waitFor();if(!await panel.getByRole('button',{name:'Create research schedule'}).isEnabled())throw new Error('Unsaved edits disabled the schedule even with a saved mandate');
 await panel.getByLabel('Recurring check frequency').selectOption('60');await panel.getByRole('button',{name:'Create research schedule'}).click();
 const card=panel.locator('[data-recurring-id="22222222-2222-4222-8222-222222222222"]');await card.getByText('Next check',{exact:false}).waitFor();
 if(createPayload.intervalSeconds!==60||!/^[-0-9a-f]{36}$/.test(createPayload.requestId))throw new Error('Schedule creation payload was invalid');
 const run={id:'33333333-3333-4333-8333-333333333333',accountId:'fixture',scheduleId:schedules[0].id,dueAt:now(),requestId:'44444444-4444-4444-8444-444444444444',attempts:1,state:'deferred',proposalId:null,reason:'FRESH_EVIDENCE_REQUIRED',createdAt:now(),updatedAt:now()};firings=[run];
 await panel.getByRole('button',{name:'Refresh activity'}).click();await card.getByText('Waiting for fresh evidence').waitFor();await card.getByText('Current holdings or market evidence could not be confirmed.',{exact:false}).waitFor();
 proposals=[{id:'55555555-5555-4555-8555-555555555555',accountId:'fixture',requestId:run.requestId,mandateId:saved.id,mandateRevision:1,createdAt:now(),scenario:'normal',researchOnly:true,recurring:{scheduleId:schedules[0].id,firingId:run.id,dueAt:run.dueAt},inputs:{checkpoint,funding:{accountId:'fixture',accountRevision:1,checkpointId:capital.checkpointId,blockNumber:'123',observedAt:now(),balanceAtomic:'0',protectedAtomic:'0',heldAtomic:'0',decimals:18},cashPolicyRevision:0,marks:{source:'Synthetic test marks',observedAt:now(),items:[]},portfolio:{state:'KNOWN',reasons:[],positions:[],pending:[],byIssuer:[],byUnderlying:[],existing:[],pendingCount:0,checkedAt:now(),currency:'USD-nominal-USDT-parity',decimals:18,scope:'fixture'}},result:{status:'infeasible',executable:false,investableAtomic:'0',decimals:18,legs:[],reasons:['No permitted representation has fresh evidence.'],decisionId:'fixture-decision'}}];
 firings=[{...run,state:'proposed',proposalId:proposals[0].id,reason:null,attempts:2,updatedAt:now()}];
 await panel.getByRole('button',{name:'Refresh activity'}).click();await card.getByText('Proposal recorded').waitFor();await card.getByText('Block #123',{exact:false}).waitFor();await card.locator('.recurring-firing > p').filter({hasText:'No permitted representation has fresh evidence.'}).first().waitFor();
 await panel.screenshot({path:'.runtime/outputs/mandate-recurring-mobile.png'});
 await card.getByRole('button',{name:'Pause checks'}).click();await card.getByText('Paused · due slot retained').waitFor();
 await page.reload({waitUntil:'networkidle'});const afterReload=page.getByLabel('Recurring research schedules').locator('[data-recurring-id="22222222-2222-4222-8222-222222222222"]');await afterReload.getByText('Paused · due slot retained').waitFor();await afterReload.locator(':scope > summary').click();
 await afterReload.getByRole('button',{name:'Resume checks'}).click();await afterReload.getByText('Next check',{exact:false}).waitFor();await afterReload.getByRole('button',{name:'Revoke schedule'}).click();await afterReload.getByText('Revoked · no further checks').waitFor();
 if(await afterReload.getByRole('button',{name:'Resume checks'}).count()||await afterReload.getByRole('button',{name:'Pause checks'}).count())throw new Error('Revoked schedule still has active controls');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Recurring panel overflows on a 390px viewport');
 if(pageErrors.length)throw new Error(pageErrors.join('; '));
 console.log('Recurring browser passed: create, deferred reason, recorded proposal evidence, pause/reload/resume/revoke, no mobile overflow or page errors.');
}finally{await browser.close();}
