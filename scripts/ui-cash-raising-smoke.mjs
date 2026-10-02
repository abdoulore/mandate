import './smoke-output.mjs';
// Synthetic funded portfolio; real core decisions through the browser's request shape.
// This does not contact a wallet, reserve funds or submit transactions.
import {chromium} from '@playwright/test';
import {assessPortfolio,previewInvestment,previewRebalance,previewCashRaising,defaultMandate} from '../packages/core/src/index.ts';
import {passportDefinitions} from '../apps/api/src/passports.ts';
import {encodeAbiParameters} from 'viem';
const defs=passportDefinitions(),spy=defs.find(p=>p.symbol==='SPYon'),spyb=defs.find(p=>p.symbol==='SPYB');
const address='0x'+'1'.repeat(40),u=10n**18n,amount=n=>(BigInt(n)*u).toString(),now=new Date();
const checkpoint={accountId:'fixture',wallet:address,asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:amount(100),blockNumber:'123',blockHash:'0x'+'2'.repeat(64),observedAt:now.toISOString(),evidenceMode:'observed',positions:defs.map(p=>{const raw=p.contract===spy.contract?amount(80):p.contract===spyb.contract?amount(20):'0';return {contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:raw,multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1',state:'OBSERVED'};})};
const marks={source:'Synthetic fixture',observedAt:now.toISOString(),items:defs.map(p=>({contract:p.contract,issuer:p.issuer,price:'1',updatedAt:now.toISOString()}))};
const portfolio=assessPortfolio(checkpoint,defs,marks,[],now.getTime());
const capital={state:'OBSERVED',executionAllowed:false,accountId:'fixture',revision:1,decimals:18,balanceAtomic:amount(100),protectedAtomic:'0',heldAtomic:'0',availableAtomic:amount(100),shortfallAtomic:'0',checkpointId:'fixture-checkpoint',checkpoint,portfolio,pending:[],policy:{reserveFloor:'0',operatingBudget:'0',obligations:[]},policyRevision:0};
const funding={accountId:'fixture',accountRevision:1,checkpointId:capital.checkpointId,blockNumber:'123',observedAt:now.toISOString(),balanceAtomic:amount(100),protectedAtomic:'0',heldAtomic:'0',decimals:18};
const candidates=[spy,spyb].map(p=>({id:p.contract,contract:p.contract,underlying:'SPY',name:p.symbol,issuer:p.issuer,category:'ETF',accounting:'raw',leveraged:false,evidenceMode:'research',executionCertified:false,researchEligible:true}));
const quotes=candidates.map(p=>({instrumentId:p.id,costBps:p.issuer==='ondo'?4:15,available:true,evidenceMode:'synthetic'}));
const mandate={...defaultMandate,maxIssuerBps:9500,allocations:[{underlying:'SPY',weightBps:10000}]};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
let result,saved=null,history=[];
const fulfill=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
try{
 const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),str=s=>encodeAbiParameters([{type:'string'}],[s]);
 await page.addInitScript(({address,zero,one,decimals,usdt,aaoi,name})=>{window.binancew3w={ethereum:{request:async({method,params})=>{
  if(method==='eth_accounts')return [address];if(method==='eth_chainId')return '0x38';if(method==='eth_blockNumber')return '0x7b';if(method==='eth_getCode')return '0x6001';if(method==='eth_getBalance')return zero;
  if(method==='eth_call'){const d=params[0].data;if(d.startsWith('0x70a08231'))return zero;if(d==='0x313ce567')return decimals;if(d==='0x06fdde03')return name;if(d==='0x95d89b41')return params[0].to.toLowerCase()==='0x10343ef7da3301493d7ecb647d68a288c6c1db2f'?aaoi:usdt;if(d==='0xa60bf13d'||d==='0xdc767007')return one;if(d==='0x18160ddd'||d==='0x97a4064f'||d==='0x9bea6429')return zero;}
  throw new Error('Unexpected wallet method '+method);
 }}};},{address,zero:word(0),one:word(u),decimals:word(18),usdt:str('USDT'),aaoi:str('AAOIB'),name:str('Tether USD')});
 await page.route('**/api/v1/wallet/session',r=>fulfill(r,{session:{address,chainId:56,expiresAt:Date.now()+3600000}}));
 await page.route('**/api/v1/workspace',r=>fulfill(r,{schemaVersion:'1.0',mode:'scenario',executionEnabled:false,mandate,instruments:[],capabilities:{checkedAt:null,checks:[]}}));
 await page.route('**/api/v1/capital',r=>fulfill(r,capital));
 await page.route('**/api/v1/capital/mandates',r=>{if(r.request().method()==='GET')return fulfill(r,{latest:saved,history:saved?[saved]:[]});const b=JSON.parse(r.request().postData());saved={id:'fixture-mandate',accountId:'fixture',revision:(saved?.revision??0)+1,createdAt:new Date().toISOString(),researchOnly:true,policy:b.policy};capital.revision++;funding.accountRevision=capital.revision;return fulfill(r,{latest:saved,capital});});
 await page.route('**/api/v1/capital/proposals',r=>{if(r.request().method()==='GET')return fulfill(r,{items:history});const input={...mandate,...saved.policy};result=previewInvestment(input,candidates,quotes,new Date(),funding,portfolio);const proposal={id:'fixture-'+history.length,accountId:'fixture',requestId:JSON.parse(r.request().postData()).requestId,mandateId:saved.id,mandateRevision:saved.revision,createdAt:result.createdAt,scenario:'normal',researchOnly:true,inputs:{mandate:input,cashPolicyRevision:0,checkpoint,funding:{...funding},portfolio,candidates,quotes},result};history.unshift(proposal);return fulfill(r,{proposal});});


 let models=[];
 await page.route('**/api/v1/capital/rebalances',route=>fulfill(route,{items:[]}));
 await page.route('**/api/v1/capital/cash-raising',route=>{if(route.request().method()==='GET')return fulfill(route,{items:models});const body=JSON.parse(route.request().postData()),inputs={mandate:{...mandate,...saved.policy},checkpoint,funding:{...funding},portfolio,marks,pending:[],cashPolicyRevision:1,cashPolicy:capital.policy,candidates,quotes,passports:{schemaVersion:'1.0',checkedAt:now.toISOString(),items:[]}},result=previewCashRaising(inputs,body.target,new Date());const cashRaising={schemaVersion:'1.0.0',engineVersion:'cash-raising-research-v1',id:'synthetic-cash-'+models.length,requestId:body.requestId,accountId:'fixture',mandateId:saved.id,mandateRevision:saved.revision,scenario:body.scenario,createdAt:result.createdAt,researchOnly:true,target:body.target,inputs,result};models.unshift(cashRaising);return fulfill(route,{cashRaising});});
 capital.protectedAtomic=amount(20);capital.availableAtomic=amount(80);capital.policy.reserveFloor='20';capital.policyRevision=1;funding.protectedAtomic=amount(20);
 await page.goto('http://127.0.0.1:3110/cash-raising',{waitUntil:'networkidle'});
 const panel=page.getByLabel('Wallet cash and commitments'),controls=panel.getByRole('group',{name:'Token versions to consider'}),cash=panel.getByLabel('Net cash-raising planner');
 await controls.getByLabel('SPYon · Ondo',{exact:true}).check();await controls.getByLabel('SPYB · bStocks',{exact:true}).check();await panel.getByRole('button',{name:'Save investment rules'}).click();await panel.getByText('Saved revision 1',{exact:true}).waitFor();
 await cash.getByLabel('Cash-raising target').fill('50');await cash.getByRole('button',{name:'Preview cash target'}).click();await cash.getByText('Cash target covered · 50 USDT · mandate 1',{exact:true}).waitFor();if(models[0].result.legs.length)throw new Error('Cash-only target sold holdings');
 await panel.getByLabel('Maximum with one token issuer · %',{exact:true}).fill('70');if(await cash.getByRole('button',{name:'Preview cash target'}).isEnabled())throw new Error('Dirty rules permitted cash modeling');await panel.getByRole('button',{name:'Save investment rules'}).click();await panel.getByText('Saved revision 2',{exact:true}).waitFor();
 await cash.getByLabel('Cash-raising target').fill('100');await cash.getByRole('button',{name:'Preview cash target'}).click();await cash.getByText('Cash target covered · 100 USDT · mandate 2',{exact:true}).waitFor();await cash.getByText('Modeled sales · settle before any payout',{exact:true}).waitFor();if(!models[0].result.legs.length||BigInt(models[0].result.projectedCashAfterPayoutAtomic)<20n*u)throw new Error('Sale model lost fee coverage or cash reserve');for(const e of models[0].result.issuerExposure)if(BigInt(e.exposureAtomic)*10000n>BigInt(models[0].result.remainingExposureAtomic)*7000n)throw new Error('Remaining issuer cap breached');
 await cash.screenshot({path:'.runtime/outputs/mandate-cash-raising-synthetic-mobile.png'});
 const original=JSON.stringify(models[0]);await page.reload({waitUntil:'networkidle'});await cash.getByText('Cash target covered · 100 USDT · mandate 2',{exact:true}).waitFor();if(JSON.stringify(models[0])!==original)throw new Error('History changed on reload');
 await cash.getByLabel('Cash-raising target').fill('200');await cash.getByRole('button',{name:'Preview cash target'}).click();await cash.getByText('Cash target shortfall · 200 USDT · mandate 2',{exact:true}).waitFor();if(models[0].result.status!=='shortfall'||BigInt(models[0].result.shortfallAtomic)<=0n)throw new Error('Oversized payout was not a shortfall');
 await cash.getByLabel('Cash-raising target').fill('0');if(await cash.getByRole('button',{name:'Preview cash target'}).isEnabled())throw new Error('Zero cash target accepted');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile overflow');if(errors.length)throw new Error(errors.join('; '));
 console.log('Synthetic cash-raising browser passed: cash-only target, net sale with fees/reserve/issuer limits, dirty-rule gating, immutable reload history, explicit shortfall, positive-target validation, no page errors or mobile overflow.');
}finally{await browser.close();}
