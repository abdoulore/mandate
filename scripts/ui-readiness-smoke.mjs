import './smoke-output.mjs';
import {chromium} from '@playwright/test';
import {encodeAbiParameters} from 'viem';
import {reviewResearchExecution} from '../apps/api/src/execution-review.ts';

const address='0x1111111111111111111111111111111111111111';
const aaoi='0x10343ef7da3301493d7ecb647d68a288c6c1db2f';
const word=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
const values={aaoi,usdt:'0x55d398326f99059ff775485246999027b3197955',name:encodeAbiParameters([{type:'string'}],['Tether USD']),usdtSymbol:encodeAbiParameters([{type:'string'}],['USDT']),aaoiSymbol:encodeAbiParameters([{type:'string'}],['AAOIB']),decimals:word(18),supply:word(43319685347840000000000n),multiplier:word(10n**18n),zero:word(0)};
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.clock.install({time:new Date()});
 await page.addInitScript(({walletAddress,values})=>{
  window.binancew3w={ethereum:{request:async({method,params})=>{
   if(method==='eth_accounts')return [walletAddress];
   if(method==='eth_chainId')return '0x38';
   if(method==='eth_blockNumber')return '0x75dfe36';
   if(method==='eth_getCode')return '0x6001';
   if(method==='eth_getBalance')return '0x0';
   if(method==='eth_call'){
    const to=String(params[0].to).toLowerCase(),data=String(params[0].data).toLowerCase(),isAaoi=to===values.aaoi;
    if(data.startsWith('0x70a08231'))return values.zero;
    if(data==='0x313ce567')return values.decimals;
    if(data==='0x06fdde03')return values.name;
    if(data==='0x95d89b41')return isAaoi?values.aaoiSymbol:values.usdtSymbol;
    if(data==='0x18160ddd'||data==='0x9bea6429')return values.supply;
    if(data==='0xa60bf13d'||data==='0xdc767007')return values.multiplier;
    if(data==='0x97a4064f')return values.zero;
   }
   throw new Error('Unexpected wallet RPC '+method);
  }}};
 },{walletAddress:address,values});
 await page.route('**/api/v1/wallet/session',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({session:{address,chainId:56,expiresAt:Date.now()+3600000}})}));
 await page.route('**/api/v1/routes/AAOIB/research',route=>{
  const validUntil=new Date(Date.now()+30000).toISOString();
  const walletCheck={state:'OBSERVED',blockNumber:'123580358',observedAt:new Date().toISOString(),paymentDecimals:18,paymentBalanceAtomic:'0',requiredAtomic:'10000000000000000000',balanceCoversAmount:false,allowanceAtomic:'0',allowanceCoversAmount:false,bnbBalanceAtomic:'0',bnbPresent:false,paymentPrecisionMatches:true,routerFingerprintMatches:true,spenderCandidate:'0xb44446b0c8e56988c34f7ff73ae904982b5fdda5',executionCertified:false,note:'Read-only observations.'};
  const executionReview=reviewResearchExecution({shapeChecked:true,validUntil,checkedAt:new Date().toISOString(),wallet:walletCheck});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({instrument:'AAOIB',amount:'10',asset:'BSC USDT',state:'SHAPE_CHECKED',mode:'SWAP',vendorName:'LiquidMesh',toTokenAmount:'96646420666240184',validUntil,walletCheck,executionReview,executionEnabled:false,note:'Read-only research.'})});
 });
 await page.goto('http://127.0.0.1:3110/execution-review',{waitUntil:'networkidle',timeout:90000});
 await page.getByRole('heading',{name:'Wallet balance snapshot'}).waitFor();
 await page.getByRole('button',{name:'Get read-only quote'}).click();
 await page.getByText('Wallet readings at block #123580358').waitFor();
 if(!(await page.getByLabel('Connected-wallet preflight').innerText()).includes('Below the 10 USDT research amount'))throw new Error('Funding shortfall was not displayed');
 await page.getByText('Trading is unavailable',{exact:true}).waitFor();
 await page.getByText('See 9 trade-readiness checks',{exact:true}).click();
 const meaning=page.locator('.execution-gate').filter({hasText:'What the transaction would do'});
 if(!(await meaning.innerText()).includes('Unknown'))throw new Error('Unverified transaction meaning was hidden');
 await page.clock.fastForward(35000);
 await page.getByText('This research quote expired. Request a new one to see a current estimate.',{exact:true}).waitFor();
 const freshness=page.locator('.execution-gate').filter({hasText:'Quote still fresh'});
 if(!(await freshness.innerText()).includes('Blocked'))throw new Error('Expired quote remained checked');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile wallet preflight overflows horizontally');
 if(errors.length)throw new Error(errors.join('\n'));
 await page.screenshot({path:'.runtime/outputs/mandate-readiness-mobile.png',fullPage:true});
 console.log(JSON.stringify({passed:true,checks:['wallet snapshot','read-only route result','insufficient funding shown','unverified transaction meaning','quote expiry and blocked freshness','mobile layout','browser runtime errors']}));
}finally{await browser.close();}
