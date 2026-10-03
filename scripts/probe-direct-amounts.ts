import {createPublicClient,http,keccak256,type Address} from 'viem';
import {bsc} from 'viem/chains';
import {buildDirectSwap,PANCAKE_V3,pancakeFactoryAbi,pancakePoolAbi,pancakeQuoterAbi} from '../apps/api/src/pancake-direct.ts';

// Public-chain reads only. A quote at one block does not establish an executable minimum.
const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
const owner='0x1111111111111111111111111111111111111111' as Address;
const amounts=['0.01','0.1','1','5','10'] as const;
const report:{checkedAt:string;blockNumber?:string;pool?:Address;results:Array<{inputUsdt:string;quotedSpyOnAtomic?:string;minimumSpyOnAtomic?:string;quoterGasEstimate?:string;state:string}>;error?:string}={checkedAt:new Date().toISOString(),results:[]};

try{
 if(await client.getChainId()!==56)throw new Error('WRONG_CHAIN');
 const blockNumber=await client.getBlockNumber();report.blockNumber=blockNumber.toString();
 const pool=await client.readContract({address:PANCAKE_V3.factory,abi:pancakeFactoryAbi,functionName:'getPool',args:[PANCAKE_V3.usdt,PANCAKE_V3.spyOn,PANCAKE_V3.fee],blockNumber});
 if(pool==='0x0000000000000000000000000000000000000000')throw new Error('POOL_MISSING');
 report.pool=pool;
 const [factory,token0,token1,fee,liquidity,routerCode,poolCode]=await Promise.all([
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'factory',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'token0',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'token1',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'fee',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'liquidity',blockNumber}),
  client.getBytecode({address:PANCAKE_V3.router,blockNumber}),
  client.getBytecode({address:pool,blockNumber}),
 ]);
 const actual=[token0.toLowerCase(),token1.toLowerCase()].sort();
 const expected=[PANCAKE_V3.usdt.toLowerCase(),PANCAKE_V3.spyOn.toLowerCase()].sort();
 if(factory.toLowerCase()!==PANCAKE_V3.factory.toLowerCase()||actual[0]!==expected[0]||actual[1]!==expected[1]||fee!==PANCAKE_V3.fee||liquidity<=0n||!poolCode||!routerCode||keccak256(routerCode)!==PANCAKE_V3.routerCodeHash)throw new Error('POOL_IDENTITY_UNVERIFIED');
 for(const inputUsdt of amounts){
  try{
   const [whole,fraction='']=inputUsdt.split('.');
   const amountIn=BigInt(whole)*10n**18n+BigInt((fraction+'0'.repeat(18)).slice(0,18));
   const quote=await client.simulateContract({address:PANCAKE_V3.quoter,abi:pancakeQuoterAbi,functionName:'quoteExactInputSingle',args:[{tokenIn:PANCAKE_V3.usdt,tokenOut:PANCAKE_V3.spyOn,amountIn,fee:PANCAKE_V3.fee,sqrtPriceLimitX96:0n}],account:owner,blockNumber});
   const built=buildDirectSwap({direction:'BUY',recipient:owner,amountIn,quotedOut:quote.result[0],nowMs:Date.now()});
   report.results.push({inputUsdt,quotedSpyOnAtomic:quote.result[0].toString(),minimumSpyOnAtomic:built.amountOutMinimum.toString(),quoterGasEstimate:quote.result[3].toString(),state:'QUOTE_AVAILABLE'});
  }catch(error){report.results.push({inputUsdt,state:error instanceof Error?error.message.split('\n')[0].slice(0,180):'QUOTE_FAILED'});}
 }
}catch(error){report.error=error instanceof Error?error.message.split('\n')[0].slice(0,180):'PROBE_FAILED';process.exitCode=1;}
console.log(JSON.stringify(report,null,2));
