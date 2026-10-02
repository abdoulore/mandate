import {createHash} from 'node:crypto';
import {createPublicClient,http,parseAbi,type Address} from 'viem';
import {bsc} from 'viem/chains';
import {BSC_USDT,AAOIB} from '@mandate/connectors';
import {capitalCheckpointSchema,type CapitalCheckpoint,type CapitalView} from '@mandate/domain';
import type {Ledger} from '@mandate/store';
import {passportDefinitions} from './passports.ts';
export const capitalAccountId=(wallet:string)=>'bsc-usdt:'+createHash('sha256').update(wallet.toLowerCase()).digest('hex').slice(0,40);
const abi=parseAbi(['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)','function symbol() view returns (string)','function uiMultiplier() view returns (uint256)']);
export async function readCapitalCheckpoint(wallet:string):Promise<CapitalCheckpoint>{
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0})});
 if(await client.getChainId()!==56)throw new Error('Unexpected chain');
 const block=await client.getBlock();if(block.number===null||!block.hash)throw new Error('Unidentified block');
 const blockAge=Date.now()-Number(block.timestamp)*1000;if(blockAge< -10000||blockAge>60000)throw new Error('RPC head is not current');
 const owner=wallet.toLowerCase() as Address,usdt=BSC_USDT as Address,blockNumber=block.number,defs=passportDefinitions();
 const contracts=defs.flatMap(p=>[{address:p.contract as Address,abi,functionName:'balanceOf' as const,args:[owner] as const},{address:p.contract as Address,abi,functionName:'decimals' as const},{address:p.contract as Address,abi,functionName:'symbol' as const},{address:p.contract as Address,abi,functionName:'uiMultiplier' as const}]);
 const [cash,decimals,symbol,reads]=await Promise.all([
  client.readContract({address:usdt,abi,functionName:'balanceOf',args:[owner],blockNumber}),client.readContract({address:usdt,abi,functionName:'decimals',blockNumber}),client.readContract({address:usdt,abi,functionName:'symbol',blockNumber}),
  client.multicall({contracts,blockNumber,allowFailure:true}).catch(()=>[])
 ]);
 if(Number(decimals)!==18||symbol!=='USDT')throw new Error('Unexpected payment identity or accounting');
 const positions:CapitalCheckpoint['positions']=defs.map((p,n)=>{const values=[0,1,2,3].map(j=>{const r=reads[n*4+j];return r?.status==='success'?r.result:null;});const [raw,d,s,m]=values;
  if(typeof raw==='bigint'&&Number(d)===18&&typeof s==='string'&&s.toUpperCase()===p.symbol.toUpperCase()&&typeof m==='bigint'&&m>0n)return {contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:raw.toString(),multiplierAtomic:m.toString(),adjustedAtomic:(raw*m/10n**18n).toString(),accountingVersion:'bep677-floor-v1',state:'OBSERVED'};
  if(p.issuer==='ondo'&&typeof raw==='bigint'&&Number(d)===18&&typeof s==='string'&&s.toUpperCase()===p.symbol.toUpperCase())return {contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:raw.toString(),multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'raw-token-v1',state:'OBSERVED'};
  return {contract:p.contract,symbol:p.symbol,decimals:18,rawAtomic:null,multiplierAtomic:null,adjustedAtomic:null,accountingVersion:'unknown',state:'UNKNOWN',reason:'IDENTITY_OR_ACCOUNTING_READ_UNAVAILABLE'};
 });
 const after=await client.getBlock({blockNumber});if(after.hash!==block.hash)throw new Error('Block changed during read');
 return capitalCheckpointSchema.parse({accountId:capitalAccountId(owner),wallet:owner,asset:{chainId:56,contract:BSC_USDT.toLowerCase(),decimals:18},balanceAtomic:cash.toString(),blockNumber:blockNumber.toString(),blockHash:block.hash.toLowerCase(),observedAt:new Date().toISOString(),positions,evidenceMode:'observed'});
}
export async function capitalView(ledger:Ledger,wallet:string,now=Date.now()):Promise<CapitalView>{
 const accountId=capitalAccountId(wallet),s=await ledger.capitalState(accountId);
 if(!s)return {state:'NOT_OBSERVED',executionAllowed:false,accountId,revision:0,decimals:18,balanceAtomic:'0',protectedAtomic:'0',heldAtomic:'0',availableAtomic:'0',shortfallAtomic:'0',checkpointId:null,checkpoint:null,policy:{reserveFloor:'0',operatingBudget:'0',obligations:[]},policyRevision:0};
 const age=now-Date.parse(s.checkpoint.observedAt),state=s.health!=='OBSERVED'?'UNKNOWN':age<0||!Number.isFinite(age)||age>60000?'STALE':'OBSERVED';
 return {...s,state,availableAtomic:state==='OBSERVED'?s.availableAtomic:'0',executionAllowed:false};
}
