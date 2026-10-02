import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublicClient,http,keccak256,parseAbi} from 'viem';
import {bsc} from 'viem/chains';
import {AAOIB,BSC_USDT,BinanceReadClient,bindQuote,inspectBuild,type RouteIntent} from '@mandate/connectors';

// Read-only capability research. Never persist a quote ID, calldata, wallet address, or signature.
const wallet=('0x'+createHash('sha256').update('mandate-roundtrip-unfunded-research').digest('hex').slice(0,40)) as `0x${string}`;
const client=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY||'',process.env.BINANCE_WEB3_API_SECRET||'');
const rpc=createPublicClient({chain:bsc,transport:http('https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
const loupe=parseAbi(['function facetAddress(bytes4) view returns (address)']);
const erc20=parseAbi(['function decimals() view returns (uint8)']);
const checkedAt=new Date().toISOString();
const instruments={AAOIB,MSFTon:'0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3',SPYon:'0x6a708ead771238919d85930b5a0f10454e1c331a'} as const;
const symbol=process.argv[2]??'AAOIB';
if(!(symbol in instruments))throw new Error('Choose AAOIB, MSFTon, or SPYon.');
const stockToken=instruments[symbol as keyof typeof instruments];
const vendor=process.argv[3]??null;
if(vendor&&!['LiquidMesh','Pancake','PcsXRfq','InchFusion','CowSwap'].includes(vendor))throw new Error('Unrecognized research vendor.');

type LegReport={
 direction:'BUY'|'SELL';inputAtomic:string;fromToken:string;toToken:string;
 quote:{state:string;code:string;routeCount:number|null;bound:boolean;mode:string|null;vendor:string|null;outputAtomic:string|null;routeProtocols:string[]};
 build:{state:string;code:string|null;shapeChecked:boolean;reasons:string[];router:string|null;selector:string|null;minReceiveAtomic:string|null;calldataBytes:number|null};
};

async function leg(direction:'BUY'|'SELL',fromToken:string,toToken:string,inputAtomic:string):Promise<LegReport>{
 const intent:RouteIntent={chainId:'56',fromToken,toToken,amount:inputAtomic,wallet};
 const quote=await client.get('/api/v1/dex/aggregator/quote',{binanceChainId:'56',fromTokenAddress:fromToken,toTokenAddress:toToken,amount:inputAtomic,userWalletAddress:wallet,...(vendor?{vendor}:{})});
 const bound=bindQuote(quote.body,intent,quote.finishedAt);
 const routes=(quote.body as {data?:unknown[]}|null)?.data;
 const route=Array.isArray(routes)?routes.find((candidate:unknown)=>{
  const value=candidate as {quoteId?:unknown};return value?.quoteId===bound?.quoteId;
 }) as {dexRouterList?:{dexProtocol?:{dexName?:unknown}}[]}|undefined:undefined;
 const routeProtocols=Array.isArray(route?.dexRouterList)?route.dexRouterList.map(x=>x?.dexProtocol?.dexName).filter((x):x is string=>typeof x==='string'):[];
 const report:LegReport={direction,inputAtomic,fromToken,toToken,
  quote:{state:quote.state,code:quote.code,routeCount:Array.isArray(routes)?routes.length:null,bound:!!bound,mode:bound?.mode??null,vendor:bound?.vendorName??null,outputAtomic:bound?.toTokenAmount??null,routeProtocols},
  build:{state:'NOT_ATTEMPTED',code:null,shapeChecked:false,reasons:['NO_BOUND_QUOTE'],router:null,selector:null,minReceiveAtomic:null,calldataBytes:null}};
 if(!bound)return report;
 const build=await client.get('/api/v1/dex/aggregator/swap',{binanceChainId:'56',fromTokenAddress:fromToken,toTokenAddress:toToken,amount:inputAtomic,userWalletAddress:wallet,quoteId:bound.quoteId,slippagePercent:'0.5',approveTransaction:'false'});
 const inspected=inspectBuild(build.body,bound,build.finishedAt);
 report.build={state:build.state,code:build.code,shapeChecked:inspected.identityAndShapeChecked,reasons:inspected.reasons,router:inspected.txTo,selector:inspected.txSelector,minReceiveAtomic:inspected.minReceiveAmount,calldataBytes:inspected.txDataBytes};
 return report;
}

async function codeObservation(router:string|null,selector:string|null,blockNumber:bigint){
 if(!router||!selector)return {state:'NOT_AVAILABLE'};
 try{
  const code=await rpc.getBytecode({address:router as `0x${string}`,blockNumber});
  const facet=await rpc.readContract({address:router as `0x${string}`,abi:loupe,functionName:'facetAddress',args:[selector as `0x${string}`],blockNumber});
  const facetCode=await rpc.getBytecode({address:facet,blockNumber});
  return {state:code&&facetCode?'CODE_OBSERVED':'CODE_MISSING',routerCodeHash:code?keccak256(code):null,facet,facetCodeHash:facetCode?keccak256(facetCode):null};
 }catch{return {state:'UNKNOWN'};}
}

const report:Record<string,unknown>={checkedAt,chainId:56,instrument:symbol,requestedVendor:vendor,wallet:'deterministic unfunded research address',mode:'READ_ONLY',executionCertified:false};
try{
 const blockNumber=await rpc.getBlockNumber();
 report.blockNumber=blockNumber.toString();
 const [paymentDecimals,stockDecimals]=await Promise.all([
  rpc.readContract({address:BSC_USDT,abi:erc20,functionName:'decimals',blockNumber}),
  rpc.readContract({address:stockToken as `0x${string}`,abi:erc20,functionName:'decimals',blockNumber})]);
 report.decimals={USDT:Number(paymentDecimals),stockToken:Number(stockDecimals)};
 if(paymentDecimals!==18)throw new Error('USDT precision changed; the 10 USDT research amount is invalid.');
 const buy=await leg('BUY',BSC_USDT,stockToken,'10000000000000000000');
 report.buy=buy;
 if(buy.quote.outputAtomic&&buy.build.shapeChecked){
  const sell=await leg('SELL',stockToken,BSC_USDT,buy.quote.outputAtomic);
  report.sell=sell;
  if(sell.quote.outputAtomic){
   const buyInput=BigInt(buy.inputAtomic),sellOutput=BigInt(sell.quote.outputAtomic);
   report.roundTrip={buyInputAtomic:buy.inputAtomic,sellQuotedOutputAtomic:sell.quote.outputAtomic,lossAtomic:(buyInput-sellOutput).toString(),note:'Sequential ephemeral quotes for an unfunded address; not executable or a realized return.'};
  }
  report.codeObservations={buy:await codeObservation(buy.build.router,buy.build.selector,blockNumber),sell:await codeObservation(sell.build.router,sell.build.selector,blockNumber)};
 }else report.sell={state:'NOT_ATTEMPTED',reason:'BUY_ROUTE_NOT_SHAPE_CHECKED'};
}catch(error){report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
report.gates={calldataSemantics:'UNVERIFIED',marketEligibility:'UNVERIFIED',walletSigning:'UNVERIFIED',simulation:'NOT_RUN',settlement:'NOT_RUN'};
const dir=path.resolve('data/capabilities');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,`roundtrip-${symbol.toLowerCase()}${vendor?'-'+vendor.toLowerCase():''}-latest.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
