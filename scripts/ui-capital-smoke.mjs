import './smoke-output.mjs';
// A disposable unfunded signer exercises real API/chain capital reads.
// The browser wallet provider is mocked; it never sends a transaction.
import {chromium} from '@playwright/test';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters} from 'viem';
const origin=process.env.MANDATE_APP_ORIGIN||'http://127.0.0.1:3110',api='http://127.0.0.1:3110/api';
const signer=privateKeyToAccount(generatePrivateKey());
async function apiRequest(path,body,cookie){const response=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return response;}
const challengeResponse=await apiRequest('/v1/wallet/challenge',{address:signer.address,chainId:56});
const challenge=await challengeResponse.json();if(!challengeResponse.ok)throw new Error('Smoke sign-in challenge failed');
const signature=await signer.signMessage({message:challenge.message});
const verification=await apiRequest('/v1/wallet/verify',{challengeId:challenge.id,signature});
if(!verification.ok)throw new Error('Smoke read-only sign-in failed');
const cookie=verification.headers.get('set-cookie').split(';')[0];
const session=await verification.json();
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.setDefaultTimeout(60000);
page.on('pageerror',error=>errors.push(error.message));
const zero='0x'+'0'.repeat(64),multiplier='0x'+(10n**18n).toString(16).padStart(64,'0');
const string=value=>encodeAbiParameters([{type:'string'}],[value]);
try{
 await page.addInitScript(({address,zero,multiplier,name,usdt,aaoi})=>{window.binancew3w={ethereum:{request:async({method,params})=>{
  if(method==='eth_accounts')return [address];if(method==='eth_chainId')return '0x38';if(method==='eth_blockNumber')return '0x75dfe36';if(method==='eth_getCode')return '0x6001';if(method==='eth_getBalance')return zero;
  if(method==='eth_call'){const data=params[0].data,to=params[0].to.toLowerCase();if(data.startsWith('0x70a08231'))return zero;if(data==='0x313ce567')return '0x'+(18).toString(16).padStart(64,'0');if(data==='0x06fdde03')return name;if(data==='0x95d89b41')return to==='0x10343ef7da3301493d7ecb647d68a288c6c1db2f'?aaoi:usdt;if(data==='0xa60bf13d'||data==='0xdc767007')return multiplier;if(data==='0x18160ddd'||data==='0x97a4064f'||data==='0x9bea6429')return zero;}
  throw new Error('Unexpected wallet method '+method);
 }}};},{address:signer.address,zero,multiplier,name:string('Tether USD'),usdt:string('USDT'),aaoi:string('AAOIB')});
 await page.route('**/api/v1/wallet/session',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({session})}));
 await page.route('**/api/v1/capital**',async route=>{const req=route.request(),path=new URL(req.url()).pathname.slice(4);const r=await apiRequest(path,req.method()==='POST'?JSON.parse(req.postData()):undefined,cookie);await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});});
 await page.goto('http://127.0.0.1:3110/portfolio-exit',{waitUntil:'networkidle',timeout:90000});
 const panel=page.getByLabel('Wallet cash and commitments');await panel.waitFor();
 await panel.getByRole('button',{name:'Refresh capital'}).click();
 try{await panel.locator('.capital-state').filter({hasText:'Wallet read at BNB Chain block #'}).waitFor({timeout:15000});}catch(error){throw new Error(`Wallet capital did not load: ${await panel.locator('.capital-state').innerText()} ${await panel.locator('[role="alert"]').allInnerTexts()}`,{cause:error});}
 const portfolio=panel.getByLabel('Tracked portfolio exposure');await portfolio.getByText('Tracked exposure resolved',{exact:false}).waitFor();
 if(await portfolio.locator('tbody tr').count()!==14)throw new Error('Expected all 14 tracked instruments');
 if(await portfolio.getByText('Observed empty',{exact:true}).count()!==14)throw new Error('Empty holdings were not resolved from chain observations');
 const representations=panel.getByRole('group',{name:'Token versions to consider'});
 await representations.getByLabel('SPYon · Ondo',{exact:true}).check();await representations.getByLabel('SPYB · bStocks',{exact:true}).check();
 await panel.getByLabel('Ledger cash reserve').fill('2');
 await panel.getByLabel('Ledger operating budget').fill('0.25');
 await panel.getByRole('button',{name:'Add commitment'}).click();await panel.getByLabel('Commitment 1 name').fill('Rent');await panel.getByLabel('Commitment 1 amount').fill('1.5');
 await panel.getByRole('button',{name:'Add commitment'}).click();await panel.getByLabel('Commitment 2 name').fill('Tax');await panel.getByLabel('Commitment 2 amount').fill('0.5');await panel.getByLabel('Commitment 2 funding').selectOption('additional');
 await panel.getByRole('button',{name:'Save cash rules'}).click();
 await panel.getByText('Cash is 2.75 USDT below saved protections and pending holds.',{exact:false}).waitFor();
 await panel.getByRole('button',{name:'Save investment rules'}).click();await panel.getByText('Saved revision 1',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Preview using wallet cash'}).click();await panel.getByText('No allocation is available.',{exact:true}).waitFor();await panel.getByText('Research budget: 0 USDT',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'View wallet snapshots'}).click();await panel.getByText('Cash rules revision 1',{exact:true}).waitFor();
 await page.reload({waitUntil:'networkidle'});await panel.getByLabel('Ledger cash reserve').waitFor();
 if(await panel.getByLabel('Ledger cash reserve').inputValue()!=='2'||await panel.getByLabel('Commitment 2 funding').inputValue()!=='additional')throw new Error('Saved policy did not survive reload');
 await panel.getByText('Saved revision 1',{exact:true}).waitFor();if(!await representations.getByLabel('SPYon · Ondo',{exact:true}).isChecked()||!await representations.getByLabel('SPYB · bStocks',{exact:true}).isChecked())throw new Error('Exact mandate choices did not survive reload');
 const proposals=panel.getByLabel('Research proposal history');await proposals.getByText('No allocation · mandate 1',{exact:false}).waitFor();await proposals.getByText('No allocation · mandate 1',{exact:false}).click();await proposals.getByText('Inspect recorded input snapshot',{exact:true}).click();
 if(!await proposals.locator('pre').innerText().then(t=>t.includes('checkpoint')&&t.includes('candidates')&&t.includes('quotes')))throw new Error('Proposal input snapshot is incomplete');
 const original=(await (await apiRequest('/v1/capital/proposals',undefined,cookie)).json()).items[0];
 const originalRow=proposals.locator(`[data-proposal-id="${original.id}"]`);
 await panel.getByLabel('Ledger operating budget').fill('0.5');if(await originalRow.getByRole('button',{name:'Refresh and compare'}).isEnabled())throw new Error('Unsaved cash edits allowed revalidation');
 await panel.getByRole('button',{name:'Save cash rules'}).click();await originalRow.getByRole('button',{name:'Refresh and compare'}).click();
 const comparison=proposals.getByLabel('Proposal comparison');await comparison.getByText('Research inputs changed',{exact:true}).waitFor({timeout:60000});await comparison.getByText('Protected cash · USDT · cash',{exact:true}).click();await comparison.getByText('2.75',{exact:true}).waitFor();await comparison.getByText('3',{exact:true}).waitFor();
 const recorded=(await (await apiRequest('/v1/capital/proposals',undefined,cookie)).json()).items;
 if(recorded.length!==2||recorded[0].revalidation.parentProposalId!==original.id||JSON.stringify(recorded.find(p=>p.id===original.id))!==JSON.stringify(original))throw new Error('Revalidation changed original evidence or lost linkage');
 const rebalance=panel.getByLabel('Target drift and rebalance');await rebalance.getByRole('button',{name:'Preview rebalance'}).click();await rebalance.getByText('Rebalance blocked · mandate 1',{exact:false}).waitFor();const recordedRebalances=(await (await apiRequest('/v1/capital/rebalances',undefined,cookie)).json()).items;if(recordedRebalances.length!==1||recordedRebalances[0].result.executable!==false||recordedRebalances[0].inputs.checkpoint.positions.length!==14)throw new Error('Real API rebalance did not retain source data or blocked state');console.log('Real rebalance checks:',recordedRebalances[0].result.reasons.join(' '));await rebalance.getByText(recordedRebalances[0].result.reasons[0],{exact:true}).waitFor();await rebalance.screenshot({path:'.runtime/outputs/mandate-rebalance-real-api-mobile.png'});
 const cashTarget=panel.getByLabel('Net cash-raising planner');await cashTarget.getByRole('button',{name:'Preview cash target'}).click();await cashTarget.getByText('Cash target shortfall · 10 USDT · mandate 1',{exact:true}).waitFor();const cashModels=(await (await apiRequest('/v1/capital/cash-raising',undefined,cookie)).json()).items;if(cashModels.length!==1||cashModels[0].result.executable!==false||cashModels[0].result.modeledPayoutAtomic!=='0'||cashModels[0].result.shortfallAtomic!=='10000000000000000000'||cashModels[0].inputs.checkpoint.positions.length!==14)throw new Error('Real unfunded cash model lost shortfall or source data');await cashTarget.screenshot({path:'.runtime/outputs/mandate-cash-raising-real-api-mobile.png'});
 const incoming=panel.getByLabel('Incoming funds review');await incoming.getByText('No reviewed incoming transactions.',{exact:true}).waitFor();await incoming.getByLabel('Incoming transaction hash').fill('bad');if(await incoming.getByRole('button',{name:'Verify incoming transfer'}).isEnabled())throw new Error('Invalid inflow hash accepted');await incoming.getByLabel('Incoming transaction hash').fill('0x'+'0'.repeat(64));await incoming.getByRole('button',{name:'Verify incoming transfer'}).click();await panel.getByRole('alert').filter({hasText:'receipt could not be verified'}).waitFor();if((await (await apiRequest('/v1/capital/inflows',undefined,cookie)).json()).items.length!==0)throw new Error('Failed receipt import created an income event');
 await comparison.screenshot({path:'.runtime/outputs/mandate-revalidation-mobile.png'});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw new Error('Mobile capital overflow');
 if(await panel.getByLabel('Commitment 1 funding').evaluate(select=>select.getBoundingClientRect().width)<200)throw new Error('Mobile funding selector is clipped');
 await panel.getByRole('button',{name:'View wallet snapshots'}).click();await panel.getByText('Cash rules revision 2',{exact:true}).waitFor();
 await panel.screenshot({path:'.runtime/outputs/mandate-capital-mobile.png'});
 await page.clock.install();await page.clock.fastForward(61000);await panel.getByText('The wallet reading is over one minute old. Refresh before planning.',{exact:false}).waitFor();
 if(await cashTarget.getByRole('button',{name:'Preview cash target'}).isEnabled())throw new Error('Expired checkpoint permits cash modeling');
 if(await rebalance.getByRole('button',{name:'Preview rebalance'}).isEnabled())throw new Error('Expired checkpoint permits rebalance');
 if(await panel.getByRole('button',{name:'Preview using wallet cash'}).isEnabled())throw new Error('Expired checkpoint still permits preview');
 if(errors.length)throw new Error(errors.join('; '));
 console.log('Capital smoke passed: signed disposable session through web proxy, 14 real chain position reads, saved rules/reload/history, linked revalidation and cash comparison, original snapshot preserved, expiry and mobile layout.');
}finally{await browser.close();}
