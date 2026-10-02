import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublicClient,http,parseAbi} from 'viem';
import {bsc} from 'viem/chains';
import {BinanceReadClient,BSC_USDT,AAOIB,bindQuote,inspectBuild,uiAmount,type RouteIntent} from '@mandate/connectors';

const abi=parseAbi([
 'function symbol() view returns (string)',
 'function decimals() view returns (uint8)',
 'function totalSupply() view returns (uint256)',
 'function uiMultiplier() view returns (uint256)',
 'function newUIMultiplier() view returns (uint256)',
 'function effectiveAt() view returns (uint256)',
 'function totalSupplyUI() view returns (uint256)',
 'function toUIAmount(uint256) view returns (uint256)'
]);
const rpc=createPublicClient({chain:bsc,transport:http('https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
const signed=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY||'',process.env.BINANCE_WEB3_API_SECRET||'');
const checkedAt=new Date().toISOString();
const dir=path.resolve('data/capabilities');fs.mkdirSync(dir,{recursive:true});
const probeWallet=('0x'+createHash('sha256').update('pegwatch-aaoib-quote-research-only').digest('hex').slice(0,40)) as `0x${string}`;
const outcome:Record<string,unknown>={checkedAt,instrument:'AAOIB',chainId:56,contract:AAOIB,mode:'research-only',executionCertified:false,wallet:'unfunded deterministic research address, not the connected user wallet',sources:{contract:'https://www.binance.com/en/support/announcement/detail/f198d9602f3b4604a9b15cd0a1529e32',accounting:'https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP-677.md',api:'https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/trading-api'}};

try{
 const block=await rpc.getBlock();
 const blockNumber=block.number;
 const code=await rpc.getBytecode({address:AAOIB,blockNumber});
 const methods=['symbol','decimals','totalSupply','uiMultiplier','newUIMultiplier','effectiveAt','totalSupplyUI'] as const;
 const calls=await Promise.allSettled(methods.map(functionName=>rpc.readContract({address:AAOIB,abi,functionName,blockNumber})));
 const values:Record<string,string|null>={};
 calls.forEach((result,i)=>{values[methods[i]]=result.status==='fulfilled'?String(result.value):null;});
 const raw=values.totalSupply?BigInt(values.totalSupply):null;
 const multiplier=values.uiMultiplier?BigInt(values.uiMultiplier):null;
 let computedSupply:string|null=null;
 if(raw!==null&&multiplier!==null)computedSupply=uiAmount(raw,multiplier).toString();
 let conversionMatches:null|boolean=null;
 if(raw!==null){try{conversionMatches=BigInt(await rpc.readContract({address:AAOIB,abi,functionName:'toUIAmount',args:[raw],blockNumber}))===BigInt(computedSupply??'-1');}catch{/* Optional extension. */}}
 outcome.chain={blockNumber:blockNumber.toString(),blockTimestamp:block.timestamp.toString(),codePresent:!!code&&code!=='0x',...values,computedSupplyUIAtomic:computedSupply,supplyUIAgrees:computedSupply!==null&&values.totalSupplyUI!==null?computedSupply===values.totalSupplyUI:null,conversionMatches};
 const usdtDecimals=await rpc.readContract({address:BSC_USDT,abi,functionName:'decimals',blockNumber});
 outcome.paymentToken={contract:BSC_USDT,decimals:Number(usdtDecimals),observedBlock:blockNumber.toString()};
 const amount=(10n*10n**BigInt(usdtDecimals)).toString();
 const intent:RouteIntent={chainId:'56',fromToken:BSC_USDT,toToken:AAOIB,amount,wallet:probeWallet};
 const profile=await signed.get('/api/v1/dex/market/rwa/underlying-profile',{binanceChainId:'56',tokenContractAddress:AAOIB});
 const profileData=(profile.body as {data?:Record<string,unknown>}|null)?.data;
 outcome.profile={httpStatus:profile.httpStatus,code:profile.code,state:profile.state,data:profile.state==='AVAILABLE'&&profileData?{binanceChainId:profileData.binanceChainId,tokenContractAddress:profileData.tokenContractAddress,platformId:profileData.platformId,underlyingTicker:profileData.underlyingTicker,underlyingFullName:profileData.underlyingFullName,tokenToShareRatio:profileData.tokenToShareRatio,assetType:profileData.assetType,protections:profileData.protections}:null};
 const quote=await signed.get('/api/v1/dex/aggregator/quote',{binanceChainId:intent.chainId,fromTokenAddress:intent.fromToken,toTokenAddress:intent.toToken,amount:intent.amount,userWalletAddress:intent.wallet});
 const quoteBody=quote.body as {data?:unknown[]}|null;
 const bound=bindQuote(quote.body,intent,quote.finishedAt);
 outcome.quote={httpStatus:quote.httpStatus,code:quote.code,state:quote.state,routeCount:Array.isArray(quoteBody?.data)?quoteBody.data.length:null,bound:bound?{quoteId:bound.quoteId,mode:bound.mode,fromTokenAmount:bound.fromTokenAmount,toTokenAmount:bound.toTokenAmount,approveTarget:bound.approveTarget,vendorName:bound.vendorName,receivedAt:bound.receivedAt}:null};
 if(bound){
  const build=await signed.get('/api/v1/dex/aggregator/swap',{binanceChainId:intent.chainId,fromTokenAddress:intent.fromToken,toTokenAddress:intent.toToken,amount:intent.amount,userWalletAddress:intent.wallet,quoteId:bound.quoteId,slippagePercent:'0.5',approveTransaction:'false'});
  outcome.build={httpStatus:build.httpStatus,code:build.code,state:build.state,inspection:inspectBuild(build.body,bound,build.finishedAt)};
 }else outcome.build={state:'NOT_ATTEMPTED',reason:'No quote passed identity and mode checks.'};
}catch(error){outcome.error=error instanceof Error?error.message:String(error);}
outcome.gates={issuerIdentity:'sourced',accounting:'requires on-chain results and corporate-action review',eligibility:'unverified for connected wallet',route:'research wallet only',walletSigning:'unverified for trade',simulation:'unverified',settlement:'unverified'};
const name=checkedAt.replace(/[:.]/g,'-');
fs.writeFileSync(path.join(dir,`aaoib-${name}.json`),JSON.stringify(outcome,null,2));
fs.writeFileSync(path.join(dir,'aaoib-latest.json'),JSON.stringify(outcome,null,2));
console.log(JSON.stringify(outcome,null,2));
