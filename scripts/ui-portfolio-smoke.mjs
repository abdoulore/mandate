import './smoke-output.mjs';
// Synthetic funded portfolio; real core decisions through the browser's request shape.
// This does not contact a wallet, reserve funds or submit transactions.
import {chromium} from '@playwright/test';
import {assessPortfolio,previewInvestment,defaultMandate} from '../packages/core/src/index.ts';
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
 await page.goto('http://127.0.0.1:3110/portfolio-exit',{waitUntil:'networkidle'});
 const panel=page.getByLabel('Wallet cash and commitments'),controls=panel.getByRole('group',{name:'Token versions to consider'}),preview=panel.locator('.capital-preview');
 await panel.getByRole('heading',{name:'Your wallet at a glance'}).waitFor();
 if(!await panel.getByRole('link',{name:'View holdings'}).isVisible())throw new Error('Overview hides the holdings task');
 if(await panel.getByRole('group',{name:'Token versions to consider'}).count())throw new Error('Detailed investment controls clutter the overview');
 await panel.screenshot({path:'.runtime/outputs/mandate-portfolio-fixture-mobile.png'});
 await panel.getByRole('link',{name:'View holdings'}).click();
 const exposure=panel.getByLabel('Tracked portfolio exposure');
 await exposure.getByRole('heading',{name:'Tracked holdings and pending exposure'}).waitFor();
 if(await exposure.locator('table').first().locator('tbody tr').count()!==2)throw new Error('Empty tracked tokens clutter the holdings summary');
 if(!await exposure.getByText('$80.00',{exact:true}).isVisible())throw new Error('Held USD mark is not rounded for display');
 const allTokens=exposure.locator('.capital-all-tokens');
 if(await allTokens.locator('tbody tr').count()!==defs.length)throw new Error('Exact tracked-token evidence was lost');
 await allTokens.locator('summary').click();
 if(!await allTokens.getByText('MSFTon',{exact:true}).isVisible())throw new Error('Empty tracked-token evidence cannot be inspected');
 await allTokens.locator('summary').click();

 await page.goto('http://127.0.0.1:3110/plans',{waitUntil:'networkidle'});
 await panel.getByRole('heading',{name:'Investment rules and proposals'}).waitFor();
 await controls.getByLabel('SPYon · Ondo',{exact:true}).check();await controls.getByLabel('SPYB · bStocks',{exact:true}).check();
 await panel.getByRole('button',{name:'Save investment rules'}).click();await panel.getByText('Saved revision 1',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Preview using wallet cash'}).click();await preview.getByText('This example fits your wallet cash and saved rules.',{exact:true}).waitFor();
 if(result.legs[0]?.instrumentId!==spy.contract)throw new Error('Loose limit did not choose SPYon');
 if(await panel.getByLabel('Maximum with one token issuer · %',{exact:true}).inputValue()!=='95'||!await panel.getByRole('button',{name:'Preview using wallet cash'}).isEnabled())throw new Error('Saved investment controls lost their state');
 await panel.getByLabel('Maximum with one token issuer · %',{exact:true}).fill('70');if(await preview.count())throw new Error('Unsaved rules retained old proposal');if(await panel.getByRole('button',{name:'Preview using wallet cash'}).isEnabled())throw new Error('Unsaved rules allowed a new proposal');await panel.getByRole('button',{name:'Save investment rules'}).click();await panel.getByText('Saved revision 2',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Preview using wallet cash'}).click();await preview.getByText('SPY · bstock · 100 USDT budget',{exact:true}).waitFor();
 if(result.legs[0]?.instrumentId!==spyb.contract)throw new Error('Tight limit did not switch to SPYB');
 await panel.screenshot({path:'.runtime/outputs/mandate-investment-rules-fixture-mobile.png'});
 await controls.getByLabel('SPYB · bStocks',{exact:true}).uncheck();if(await preview.count())throw new Error('Representation edit retained an obsolete result');
 await panel.getByRole('button',{name:'Save investment rules'}).click();await panel.getByText('Saved revision 3',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Preview using wallet cash'}).click();await preview.getByText('No allocation is available.',{exact:true}).waitFor();
 if(result.status!=='infeasible')throw new Error('Unselected representation was substituted');
 await panel.getByLabel('Choose another investment',{exact:true}).selectOption('MSFT');await panel.getByRole('button',{name:'Add investment target',exact:true}).click();if(await panel.getByLabel('Target allocation SPY · %',{exact:true}).inputValue()!=='50'||await panel.getByLabel('Target allocation MSFT · %',{exact:true}).inputValue()!=='50')throw new Error('New target weights are inconsistent');await panel.getByRole('button',{name:'Remove target allocation MSFT',exact:true}).click();if(await panel.getByLabel('Target allocation SPY · %',{exact:true}).inputValue()!=='100')throw new Error('Removing a target left invalid weights');
 for(const [route,heading] of [['cash-rules','Cash rules and commitments'],['rebalance','Target drift and rebalance'],['cash-raising','Raise cash for a need'],['inflows','Incoming funds'],['recurring','Recurring checks'],['records','Saved records and evidence']]){
  await page.goto('http://127.0.0.1:3110/'+route,{waitUntil:'networkidle'});
  await panel.getByRole('heading',{name:heading,exact:true}).first().waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile overflow on '+route);
 }
 await page.goto('http://127.0.0.1:3110/portfolio-exit',{waitUntil:'networkidle'});await panel.getByRole('heading',{name:'Your wallet at a glance'}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile overflow');if(errors.length)throw new Error(errors.join('; '));
 console.log('Synthetic funded portfolio smoke passed: focused routes, holdings, investment rules and proposal guards, mobile layout and page errors.');
}finally{await browser.close();}
