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
 await panel.getByRole('button',{name:'Update wallet balances'}).click();
 try{await panel.locator('.capital-state').filter({hasText:'Wallet read at BNB Chain block #'}).waitFor({timeout:15000});}catch(error){throw new Error(`Wallet capital did not load: ${await panel.locator('.capital-state').innerText()} ${await panel.locator('[role="alert"]').allInnerTexts()}`,{cause:error});}
 await page.goto('http://127.0.0.1:3110/holdings',{waitUntil:'domcontentloaded'});
 const holdings=page.getByLabel('Wallet cash and commitments').getByLabel('Tracked portfolio exposure');
 await holdings.getByText('Tracked exposure resolved',{exact:false}).waitFor();
 if(await holdings.locator('.capital-all-tokens tbody tr').count()!==14)throw new Error('Expected all 14 tracked token versions in expandable evidence');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile holdings overflow');
 if(errors.length)throw new Error(errors.join('; '));
 console.log('Signed disposable-wallet smoke passed: live capital refresh, chain-observed holdings and mobile layout. No transaction or saved rule was requested.');
}finally{await browser.close();}
