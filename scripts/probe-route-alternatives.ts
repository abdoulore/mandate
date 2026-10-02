import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublicClient,http,keccak256,parseAbi} from 'viem';
import {bsc} from 'viem/chains';
import {AAOIB,BSC_USDT,BinanceReadClient,bindQuote,inspectBuild,type RouteIntent} from '@mandate/connectors';

// Read-only research. Never persist quote IDs, raw calldata, credentials, or wallet signatures.
const wallet=('0x'+createHash('sha256').update('pegwatch-aaoib-quote-research-only').digest('hex').slice(0,40)) as `0x${string}`;
const intent:RouteIntent={chainId:'56',fromToken:BSC_USDT,toToken:AAOIB,amount:'10000000000000000000',wallet};
const client=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY||'',process.env.BINANCE_WEB3_API_SECRET||'');
const rpc=createPublicClient({chain:bsc,transport:http('https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
const loupe=parseAbi(['function facetAddress(bytes4) view returns (address)']);
const checkedAt=new Date().toISOString();
const blockNumber=await rpc.getBlockNumber();

async function fingerprint(target:string|null,selector:string|null){
 if(!target||!/^0x[0-9a-f]{40}$/.test(target)||!selector||!/^0x[0-9a-f]{8}$/.test(selector))return {state:'NOT_AVAILABLE'};
 try{
  const router=target as `0x${string}`;
  const routerCode=await rpc.getBytecode({address:router,blockNumber});
  let facet:string|null=null,facetCodeHash:string|null=null;
  try{
   facet=await rpc.readContract({address:router,abi:loupe,functionName:'facetAddress',args:[selector as `0x${string}`],blockNumber});
   if(facet&&facet!=='0x0000000000000000000000000000000000000000'){
    const facetCode=await rpc.getBytecode({address:facet as `0x${string}`,blockNumber});
    facetCodeHash=facetCode&&facetCode!=='0x'?keccak256(facetCode):null;
   }
  }catch{/* A non-Diamond route may not expose the loupe. */}
  return {state:routerCode&&routerCode!=='0x'?'CODE_OBSERVED':'NO_CODE',routerCodeHash:routerCode&&routerCode!=='0x'?keccak256(routerCode):null,facet,facetCodeHash};
 }catch{return {state:'RPC_UNKNOWN'};}
}

async function probe(vendor:'LiquidMesh'|'Pancake'){
 const params={binanceChainId:intent.chainId,fromTokenAddress:intent.fromToken,toTokenAddress:intent.toToken,amount:intent.amount,userWalletAddress:intent.wallet,vendor};
 const quote=await client.get('/api/v1/dex/aggregator/quote',params);
 const bound=bindQuote(quote.body,intent,quote.finishedAt);
 const routeCount=Array.isArray((quote.body as {data?:unknown[]}|null)?.data)?(quote.body as {data:unknown[]}).data.length:null;
 if(!bound||bound.vendorName!==vendor)return {vendor,quote:{httpStatus:quote.httpStatus,code:quote.code,state:quote.state,routeCount,bound:!!bound,returnedVendor:bound?.vendorName??null},build:{state:'NOT_ATTEMPTED',reason:bound?'VENDOR_FILTER_MISMATCH':'NO_BOUND_QUOTE'}};
 const build=await client.get('/api/v1/dex/aggregator/swap',{binanceChainId:intent.chainId,fromTokenAddress:intent.fromToken,toTokenAddress:intent.toToken,amount:intent.amount,userWalletAddress:intent.wallet,quoteId:bound.quoteId,slippagePercent:'0.5',approveTransaction:'false'});
 const inspection=inspectBuild(build.body,bound,build.finishedAt);
 const chain=inspection.mode==='SWAP'?await fingerprint(inspection.txTo,inspection.txSelector):{state:'NO_SWAP_TX'};
 return {vendor,quote:{httpStatus:quote.httpStatus,code:quote.code,state:quote.state,routeCount,bound:true,returnedVendor:bound.vendorName,mode:bound.mode},build:{httpStatus:build.httpStatus,code:build.code,state:build.state,identityAndShapeChecked:inspection.identityAndShapeChecked,reasons:inspection.reasons,txTo:inspection.txTo,txSelector:inspection.txSelector,txDataBytes:inspection.txDataBytes,txValue:inspection.txValue,chain},executionCertified:false};
}

const routes=[];
for(const vendor of ['LiquidMesh','Pancake'] as const)routes.push(await probe(vendor));
const output={checkedAt,chainId:56,blockNumber:blockNumber.toString(),wallet:'deterministic unfunded research address',amount:'10 BSC USDT',routes,executionCertified:false,note:'Ephemeral quotes and builds were inspected only. Vendor labels and code hashes do not verify calldata semantics, eligibility, or simulation.'};
const dir=path.resolve('data/capabilities');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'route-alternatives-latest.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
