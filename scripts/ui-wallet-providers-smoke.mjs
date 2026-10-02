import {chromium} from '@playwright/test';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const address='0x1111111111111111111111111111111111111111';
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.addInitScript(walletAddress=>{
    const calls=[];
    const makeProvider=(name,flag)=>({[flag]:true,request:async({method})=>{
      calls.push(name+':'+method);
      if(method==='eth_requestAccounts'||method==='eth_accounts')return [walletAddress];
      if(method==='eth_chainId')return '0x38';
      throw new Error('Unexpected wallet method '+method);
    }});
    const binance=makeProvider('binance','isBinance');
    const metamask=makeProvider('metamask','isMetaMask');
    window.binancew3w={ethereum:binance};
    window.ethereum={providers:[binance,metamask],request:async()=>{throw new Error('Aggregator must not be used');}};
    window.__providerCalls=calls;
  },address);
  await page.route('**/api/v1/wallet/challenge',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Expected test stop after wallet selection'})}));
  await page.goto(origin,{waitUntil:'networkidle',timeout:90000});
  await page.getByRole('button',{name:'Connect wallet'}).click();
  const picker=page.getByLabel('Choose a wallet');
  await picker.getByRole('button',{name:'MetaMask'}).click();
  await page.getByText('Expected test stop after wallet selection').waitFor();
  const calls=await page.evaluate(()=>window.__providerCalls);
  if(!calls.includes('metamask:eth_requestAccounts')||calls.includes('binance:eth_requestAccounts'))throw new Error('Wrong provider received the account request');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw new Error('Mobile wallet picker overflows');
  if(errors.length)throw new Error(errors.join('; '));
  console.log('Wallet provider smoke passed: multi-wallet picker selected MetaMask without asking Binance for accounts.');
} finally {
  await browser.close();
}
