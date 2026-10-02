import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublicClient,http,keccak256,type Address} from 'viem';
import {bsc} from 'viem/chains';
import {BinanceReadClient,bindQuote,type RouteIntent} from '@mandate/connectors';
import {buildDirectSwap,PANCAKE_V3,pancakeFactoryAbi,pancakePoolAbi,pancakeQuoterAbi} from '../apps/api/src/pancake-direct.ts';

// Read-only proof. The deterministic address is unfunded. No wallet calls or transaction submission.
const wallet=('0x'+createHash('sha256').update('mandate-direct-pool-unfunded-research').digest('hex').slice(0,40)) as Address;
const rpc=createPublicClient({chain:bsc,transport:http('https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
const signed=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY||'',process.env.BINANCE_WEB3_API_SECRET||'');
const checkedAt=new Date().toISOString();
const report:Record<string,unknown>={checkedAt,chainId:56,instrument:'SPYon',mode:'READ_ONLY',wallet:'deterministic unfunded research address',executionCertified:false,
 sources:{deployments:'https://github.com/pancakeswap/pancake-v3-contracts/blob/main/deployments/bscMainnet.json',routerInterface:'https://github.com/pancakeswap/pancake-v3-contracts/blob/main/projects/v3-periphery/contracts/interfaces/ISwapRouter.sol'}};

async function directQuote(tokenIn:Address,tokenOut:Address,amountIn:bigint,blockNumber:bigint){
 const result=await rpc.simulateContract({address:PANCAKE_V3.quoter,abi:pancakeQuoterAbi,functionName:'quoteExactInputSingle',args:[{tokenIn,tokenOut,amountIn,fee:PANCAKE_V3.fee,sqrtPriceLimitX96:0n}],account:wallet,blockNumber});
 return {amountOut:result.result[0],gasEstimate:result.result[3]};
}

async function binanceQuote(tokenIn:Address,tokenOut:Address,amountIn:bigint){
 const intent:RouteIntent={chainId:'56',fromToken:tokenIn,toToken:tokenOut,amount:amountIn.toString(),wallet};
 const response=await signed.get('/api/v1/dex/aggregator/quote',{binanceChainId:'56',fromTokenAddress:tokenIn,toTokenAddress:tokenOut,amount:intent.amount,userWalletAddress:wallet,vendor:'Pancake'});
 const bound=bindQuote(response.body,intent,response.finishedAt);
 return {state:response.state,code:response.code,mode:bound?.mode??null,vendor:bound?.vendorName??null,quotedOutAtomic:bound?.toTokenAmount??null};
}

try{
 const blockNumber=await rpc.getBlockNumber();
 report.blockNumber=blockNumber.toString();
 const pool=await rpc.readContract({address:PANCAKE_V3.factory,abi:pancakeFactoryAbi,functionName:'getPool',args:[PANCAKE_V3.usdt,PANCAKE_V3.spyOn,PANCAKE_V3.fee],blockNumber});
 if(pool==='0x0000000000000000000000000000000000000000')throw new Error('DIRECT_POOL_MISSING');
 const [poolFactory,token0,token1,fee,liquidity,routerCode,poolCode]=await Promise.all([
  rpc.readContract({address:pool,abi:pancakePoolAbi,functionName:'factory',blockNumber}),
  rpc.readContract({address:pool,abi:pancakePoolAbi,functionName:'token0',blockNumber}),
  rpc.readContract({address:pool,abi:pancakePoolAbi,functionName:'token1',blockNumber}),
  rpc.readContract({address:pool,abi:pancakePoolAbi,functionName:'fee',blockNumber}),
  rpc.readContract({address:pool,abi:pancakePoolAbi,functionName:'liquidity',blockNumber}),
  rpc.getBytecode({address:PANCAKE_V3.router,blockNumber}),
  rpc.getBytecode({address:pool,blockNumber})]);
 const tokens=[token0.toLowerCase(),token1.toLowerCase()].sort();
 const expected=[PANCAKE_V3.usdt.toLowerCase(),PANCAKE_V3.spyOn.toLowerCase()].sort();
 const routerCodeHash=routerCode?keccak256(routerCode):null;
 const poolVerified=poolFactory.toLowerCase()===PANCAKE_V3.factory.toLowerCase()&&tokens[0]===expected[0]&&tokens[1]===expected[1]&&fee===PANCAKE_V3.fee&&liquidity>0n&&!!poolCode&&routerCodeHash===PANCAKE_V3.routerCodeHash;
 report.pool={address:pool,factory:poolFactory,token0,token1,fee,liquidity:liquidity.toString(),poolCodeHash:poolCode?keccak256(poolCode):null,router:PANCAKE_V3.router,routerCodeHash,identityChecked:poolVerified};
 if(!poolVerified)throw new Error('DIRECT_POOL_IDENTITY_UNVERIFIED');
 const amountIn=10n*10n**18n;
 const buy=await directQuote(PANCAKE_V3.usdt,PANCAKE_V3.spyOn,amountIn,blockNumber);
 const sell=await directQuote(PANCAKE_V3.spyOn,PANCAKE_V3.usdt,buy.amountOut,blockNumber);
 const buyBuild=buildDirectSwap({direction:'BUY',recipient:wallet,amountIn,quotedOut:buy.amountOut,nowMs:Date.now()});
 const sellBuild=buildDirectSwap({direction:'SELL',recipient:wallet,amountIn:buy.amountOut,quotedOut:sell.amountOut,nowMs:Date.now()});
 const [binanceBuy,binanceSell]=await Promise.all([binanceQuote(PANCAKE_V3.usdt,PANCAKE_V3.spyOn,amountIn),binanceQuote(PANCAKE_V3.spyOn,PANCAKE_V3.usdt,buy.amountOut)]);
 report.buy={inputAtomic:amountIn.toString(),directOutAtomic:buy.amountOut.toString(),quoterGasEstimate:buy.gasEstimate.toString(),minimumOutAtomic:buyBuild.amountOutMinimum.toString(),calldataSelector:buyBuild.data.slice(0,10),binance:binanceBuy};
 report.sell={inputAtomic:buy.amountOut.toString(),directOutAtomic:sell.amountOut.toString(),quoterGasEstimate:sell.gasEstimate.toString(),minimumOutAtomic:sellBuild.amountOutMinimum.toString(),calldataSelector:sellBuild.data.slice(0,10),binance:binanceSell};
 report.gates={poolIdentity:'CHECKED',calldataSemantics:'KNOWN_PANCAKE_V3_INTERFACE',walletMarketAccess:'UNVERIFIED',walletFunds:'UNVERIFIED',transactionSimulation:'NOT_RUN',userAuthorization:'NOT_REQUESTED',settlement:'NOT_RUN'};
}catch(error){report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
const dir=path.resolve('data/capabilities');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'pancake-direct-latest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
