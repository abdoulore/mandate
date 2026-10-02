// Browser fixture for the Lab's read-only saved-record viewer. No wallet or chain transaction is sent.
import {chromium} from '@playwright/test';
import {encodeAbiParameters} from 'viem';

const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const address='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64),now=new Date().toISOString();
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const str=s=>encodeAbiParameters([{type:'string'}],[s]);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checkpoint={accountId:'smoke',wallet:address,asset:{chainId:56,contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18},balanceAtomic:'25000000000000000000',blockNumber:'123',blockHash:'0x'+'b'.repeat(64),observedAt:now,positions:[],evidenceMode:'observed'};
const proposal={id:'saved-proposal',createdAt:now,mandateRevision:1,scenario:'normal',result:{status:'feasible',legs:[],reasons:['Reserve kept outside budget.']},inputs:{checkpoint,funding:{balanceAtomic:checkpoint.balanceAtomic,protectedAtomic:'5000000000000000000',heldAtomic:'0'},marks:{source:'Recorded mark fixture'}}};
const receipt={id:'review-1',revision:1,createdAt:now,proof:{transactionHash:hash,blockNumber:'90'},classification:{kind:'external',netAtomic:'10000000000000000000',confirmations:'34',reasons:['Source was reviewed as external funding.']}};
const fulfill=(route,value)=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
try{
 await page.addInitScript(({address,zero,one,decimals,usdt,aaoi,name})=>{window.binancew3w={ethereum:{request:async({method,params})=>{
  if(method==='eth_accounts')return [address];if(method==='eth_chainId')return '0x38';if(method==='eth_blockNumber')return '0x7b';if(method==='eth_getCode')return '0x6001';if(method==='eth_getBalance')return zero;
  if(method==='eth_call'){const data=params[0].data;if(data.startsWith('0x70a08231'))return zero;if(data==='0x313ce567')return decimals;if(data==='0x06fdde03')return name;if(data==='0x95d89b41')return params[0].to.toLowerCase()==='0x10343ef7da3301493d7ecb647d68a288c6c1db2f'?aaoi:usdt;if(data==='0xa60bf13d'||data==='0xdc767007')return one;if(data==='0x18160ddd'||data==='0x97a4064f'||data==='0x9bea6429')return zero;}
  throw new Error('Unexpected wallet method '+method);
 }}};},{address,zero:word(0),one:word(10n**18n),decimals:word(18),usdt:str('USDT'),aaoi:str('AAOIB'),name:str('Tether USD')});
 await page.route('**/api/v1/wallet/session',route=>fulfill(route,{session:{address,chainId:56,expiresAt:Date.now()+3600000}}));
 await page.route('**/api/v1/capital**',route=>{const path=new URL(route.request().url()).pathname;switch(path){
  case '/api/v1/capital':return fulfill(route,{state:'NOT_OBSERVED',policy:{reserveFloor:'0',operatingBudget:'0',obligations:[]},revision:0});
  case '/api/v1/capital/mandates':return fulfill(route,{latest:null,history:[]});
  case '/api/v1/capital/proposals':return fulfill(route,{items:[proposal]});
  case '/api/v1/capital/rebalances':case '/api/v1/capital/cash-raising':return fulfill(route,{items:[]});
  case '/api/v1/capital/inflows':return fulfill(route,{items:[{record:receipt,proposalId:proposal.id}]});
  case '/api/v1/capital/history':return fulfill(route,{items:[{id:'checkpoint-1',record:checkpoint}],policies:[]});
  case '/api/v1/capital/recurring':return fulfill(route,{schedules:[],firings:[]});
  default:throw new Error('Unexpected capital request '+path);
 }});
 await page.goto(origin+'/saved-evidence-lab',{waitUntil:'networkidle',timeout:90000});

 const lab=page.getByLabel('Saved wallet evidence and receipt inspection');
 await lab.getByText('Investment proposal',{exact:true}).first().waitFor();
 if(!(await lab.innerText()).includes('synthetic route costs'))throw new Error('Decision did not expose synthetic cost basis');
 if(!(await lab.innerText()).includes('Reserve kept outside budget.'))throw new Error('Decision reasons missing');
 await lab.getByRole('button',{name:'Incoming receipts'}).click();
 await lab.getByText('Incoming USDT receipt review',{exact:true}).first().waitFor();
 if(!(await lab.innerText()).includes('not a Mandate trade-execution receipt'))throw new Error('Incoming proof confused with execution receipt');
 if(!(await lab.innerText()).includes('Linked initial research proposal'))throw new Error('Receipt-to-proposal link missing');
 await lab.getByRole('button',{name:'Wallet checkpoints'}).click();
 await lab.getByText('Wallet checkpoint',{exact:true}).first().waitFor();
 if(!(await lab.innerText()).includes('not current spendable cash'))throw new Error('Checkpoint freshness limit missing');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile overflow');
 if(errors.length)throw new Error(errors.join('; '));
 console.log('Saved evidence Lab smoke passed: decision inputs/reasons, incoming receipt distinction/link, wallet checkpoint and mobile layout.');
}finally{await browser.close();}
