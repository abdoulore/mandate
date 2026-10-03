import {createPublicClient,http,isAddress,keccak256,parseAbi,encodeFunctionData,decodeFunctionData,type Address} from 'viem';
import {bsc} from 'viem/chains';
import {BinanceReadClient} from '@mandate/connectors';
import {assessReferenceCost,buildDirectSwap,PANCAKE_V3,pancakeFactoryAbi,pancakePoolAbi,pancakeQuoterAbi,pancakeRouterAbi,type DirectDirection} from './pancake-direct.ts';

const tokenAbi=parseAbi([
 'function balanceOf(address) view returns (uint256)',
 'function allowance(address,address) view returns (uint256)',
 'function decimals() view returns (uint8)',
 'function approve(address,uint256) returns (bool)',
]);
const zero='0x0000000000000000000000000000000000000000';
const cap=2n*10n**16n;

// One inspection feeds the public read-only view and the optional, private
// preparation path. Only the latter can access the exact simulated calldata.
async function inspectDirect(ownerInput:string,direction:DirectDirection,sellAmountAtomic?:string,buyAmountAtomic?:string){
 if(!isAddress(ownerInput)||!['BUY','SELL'].includes(direction))throw new Error('INVALID_DIRECT_PREFLIGHT');
 if(direction==='SELL'&&(!sellAmountAtomic||!/^[1-9]\d*$/.test(sellAmountAtomic)||BigInt(sellAmountAtomic)>cap))throw new Error('INVALID_DIRECT_SELL_AMOUNT');
 if(direction==='BUY'&&buyAmountAtomic!==undefined&&(!/^[1-9]\d*$/.test(buyAmountAtomic)||BigInt(buyAmountAtomic)>10n*10n**18n))throw new Error('INVALID_DIRECT_BUY_AMOUNT');
 const owner=ownerInput as Address,tokenIn=direction==='BUY'?PANCAKE_V3.usdt:PANCAKE_V3.spyOn,tokenOut=direction==='BUY'?PANCAKE_V3.spyOn:PANCAKE_V3.usdt;
 const amountIn=direction==='BUY'?BigInt(buyAmountAtomic??'10000000000000000000'):BigInt(sellAmountAtomic!);
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
 if(await client.getChainId()!==56)throw new Error('DIRECT_WRONG_CHAIN');
 const block=await client.getBlock();
 if(!block.hash||Date.now()-Number(block.timestamp)*1000>60000||Date.now()-Number(block.timestamp)*1000< -10000)throw new Error('DIRECT_STALE_CHAIN');
 const blockNumber=block.number;
 const pool=await client.readContract({address:PANCAKE_V3.factory,abi:pancakeFactoryAbi,functionName:'getPool',args:[PANCAKE_V3.usdt,PANCAKE_V3.spyOn,PANCAKE_V3.fee],blockNumber});
 if(pool.toLowerCase()===zero)throw new Error('DIRECT_POOL_MISSING');
 const [poolFactory,token0,token1,poolFee,liquidity,routerCode,poolCode,inputDecimals,outputDecimals,balance,allowance,nativeBalance]=await Promise.all([
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'factory',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'token0',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'token1',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'fee',blockNumber}),
  client.readContract({address:pool,abi:pancakePoolAbi,functionName:'liquidity',blockNumber}),
  client.getBytecode({address:PANCAKE_V3.router,blockNumber}),client.getBytecode({address:pool,blockNumber}),
  client.readContract({address:tokenIn,abi:tokenAbi,functionName:'decimals',blockNumber}),
  client.readContract({address:tokenOut,abi:tokenAbi,functionName:'decimals',blockNumber}),
  client.readContract({address:tokenIn,abi:tokenAbi,functionName:'balanceOf',args:[owner],blockNumber}),
  client.readContract({address:tokenIn,abi:tokenAbi,functionName:'allowance',args:[owner,PANCAKE_V3.router],blockNumber}),
  client.getBalance({address:owner,blockNumber}),
 ]);
 const tokens=[token0.toLowerCase(),token1.toLowerCase()].sort(),expected=[PANCAKE_V3.usdt.toLowerCase(),PANCAKE_V3.spyOn.toLowerCase()].sort();
 const poolChecked=Boolean(poolFactory.toLowerCase()===PANCAKE_V3.factory.toLowerCase()&&tokens[0]===expected[0]&&tokens[1]===expected[1]&&poolFee===PANCAKE_V3.fee&&liquidity>0n&&poolCode&&routerCode&&keccak256(routerCode)===PANCAKE_V3.routerCodeHash);
 if(!poolChecked||inputDecimals!==18||outputDecimals!==18)throw new Error('DIRECT_POOL_IDENTITY_UNVERIFIED');
 const quote=await client.simulateContract({address:PANCAKE_V3.quoter,abi:pancakeQuoterAbi,functionName:'quoteExactInputSingle',args:[{tokenIn,tokenOut,amountIn,fee:PANCAKE_V3.fee,sqrtPriceLimitX96:0n}],account:owner,blockNumber});
 const quotedOut=quote.result[0];
 const transaction=buildDirectSwap({direction,recipient:owner,amountIn,quotedOut,nowMs:Date.now()});
 let reference={checked:false,reason:'REFERENCE_UNAVAILABLE' as string,deviationBps:null as string|null};
 let referencePrice:string|null=null,referenceUpdatedAt:string|null=null;
 if(process.env.BINANCE_WEB3_API_KEY&&process.env.BINANCE_WEB3_API_SECRET){
  const price=await new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY,process.env.BINANCE_WEB3_API_SECRET).get('/api/v1/dex/market/rwa/price',{binanceChainId:'56',tokenContractAddresses:PANCAKE_V3.spyOn});
  const rows=(price.body as {data?:unknown}|null)?.data;
  const row=Array.isArray(rows)?rows.find(x=>x&&typeof x==='object'&&String(x.tokenContractAddress).toLowerCase()===PANCAKE_V3.spyOn.toLowerCase()&&x.platformId==='ondo'&&String(x.binanceChainId)==='56'):null;
  if(price.state==='AVAILABLE'&&row&&typeof row.tokenPrice==='string'&&Number.isSafeInteger(row.tokenPriceUpdatedAt)){
   referencePrice=row.tokenPrice;referenceUpdatedAt=new Date(row.tokenPriceUpdatedAt).toISOString();
   reference=assessReferenceCost(direction,amountIn,quotedOut,row.tokenPrice,row.tokenPriceUpdatedAt,Date.now());
  }
 }
 let simulation:'NOT_RUN'|'PASSED'|'FAILED'='NOT_RUN',gasNeeded:bigint|null=null;
 if(reference.checked&&balance>=amountIn&&allowance>=amountIn&&nativeBalance>0n){
  try{
   const args=[{tokenIn,tokenOut,fee:PANCAKE_V3.fee,recipient:owner,deadline:transaction.deadline,amountIn,amountOutMinimum:transaction.amountOutMinimum,sqrtPriceLimitX96:0n}] as const;
   await client.simulateContract({address:PANCAKE_V3.router,abi:pancakeRouterAbi,functionName:'exactInputSingle',args,account:owner,blockNumber});
   const [gas,gasPrice]=await Promise.all([client.estimateContractGas({address:PANCAKE_V3.router,abi:pancakeRouterAbi,functionName:'exactInputSingle',args,account:owner}),client.getGasPrice()]);
   gasNeeded=gas*gasPrice*13n/10n;simulation='PASSED';
  }catch{simulation='FAILED';}
 }
 let approvalSimulation:'NOT_RUN'|'PASSED'|'FAILED'|'NOT_NEEDED'='NOT_RUN';
 let approvalGas:'UNKNOWN'|'CHECKED'|'BLOCKED'|'NOT_NEEDED'='UNKNOWN';
 let approvalGasBudget:bigint|null=null;
 let approvalReason='Approval precheck waits for a valid reference price and enough input tokens.';
 if(allowance>=amountIn){approvalSimulation='NOT_NEEDED';approvalGas='NOT_NEEDED';approvalReason='This amount is already covered by the observed spending limit.';}
 else if(reference.checked&&balance>=amountIn){
  const args=[PANCAKE_V3.router,amountIn] as const;
  try{
   const approval=await client.simulateContract({address:tokenIn,abi:tokenAbi,functionName:'approve',args,account:owner,blockNumber});
   approvalSimulation=approval.result===true?'PASSED':'FAILED';
  }catch{approvalSimulation='FAILED';}
  if(approvalSimulation==='FAILED')approvalReason='The token approval simulation did not pass at this block.';
  else if(nativeBalance===0n){approvalGas='BLOCKED';approvalReason='Approval simulation passed, but no BNB was observed for network gas.';}
  else{
   try{
    const [gas,gasPrice]=await Promise.all([
     client.estimateContractGas({address:tokenIn,abi:tokenAbi,functionName:'approve',args,account:owner,blockNumber}),
     client.getGasPrice(),
    ]);
    approvalGasBudget=gas*gasPrice*13n/10n;
    approvalGas=nativeBalance>=approvalGasBudget?'CHECKED':'BLOCKED';
    approvalReason=approvalGas==='CHECKED'?'Approval simulation passed; the observed BNB covers an indicative gas budget.':'Approval simulation passed, but observed BNB is below the indicative gas budget.';
   }catch{approvalReason='Approval simulation passed; its gas cost could not be estimated.';}
  }
 }
 const view={state:'READ_ONLY_CHECK' as const,executionEnabled:false,checkedAt:new Date().toISOString(),blockNumber:blockNumber.toString(),blockHash:block.hash,direction,assetIn:tokenIn,assetOut:tokenOut,amountInAtomic:amountIn.toString(),quotedOutAtomic:quotedOut.toString(),minimumOutAtomic:transaction.amountOutMinimum.toString(),pool,router:PANCAKE_V3.router,selector:transaction.data.slice(0,10),
  wallet:{balanceAtomic:balance.toString(),allowanceAtomic:allowance.toString(),bnbAtomic:nativeBalance.toString()},
  approvalPreview:{simulation:approvalSimulation,gas:approvalGas,gasBudgetAtomic:approvalGasBudget?.toString()??null,reason:approvalReason},
  gates:{poolIdentity:'CHECKED' as const,calldataMeaning:'CHECKED' as const,referenceCost:reference.checked?'CHECKED':'BLOCKED',funds:balance>=amountIn?'CHECKED':'BLOCKED',spendingPermission:allowance>=amountIn?'CHECKED':'BLOCKED',simulation,gas:gasNeeded===null?'UNKNOWN':nativeBalance>=gasNeeded?'CHECKED':'BLOCKED',authorization:'NOT_REQUESTED' as const,settlement:'NOT_RUN' as const},
  reference:{price:referencePrice,updatedAt:referenceUpdatedAt,deviationBps:reference.deviationBps,reason:reference.reason,maximumAdverseBps:200},
  gasBudgetAtomic:gasNeeded?.toString()??null,note:'Fresh wallet-specific research only. A new quote, simulation, user authorization, durable attempt and settlement proof are required before a trade.'};
 return {view,transaction};
}

// Public research never returns transaction calldata.
export async function readDirectPreflight(owner:string,direction:DirectDirection,sellAmountAtomic?:string,buyAmountAtomic?:string){return (await inspectDirect(owner,direction,sellAmountAtomic,buyAmountAtomic)).view;}
export async function readDirectPreparation(owner:string,direction:DirectDirection,sellAmountAtomic?:string,buyAmountAtomic?:string){return inspectDirect(owner,direction,sellAmountAtomic,buyAmountAtomic);}

export async function readDirectApprovalPreparation(owner:string,direction:DirectDirection,sellAmountAtomic?:string,buyAmountAtomic?:string){
 const {view}=await inspectDirect(owner,direction,sellAmountAtomic,buyAmountAtomic);
 const amount=BigInt(view.amountInAtomic),allowance=BigInt(view.wallet.allowanceAtomic);
 if(view.gates.poolIdentity!=='CHECKED'||view.gates.referenceCost!=='CHECKED'||view.gates.funds!=='CHECKED'||allowance>=amount)throw new Error('DIRECT_APPROVAL_NOT_NEEDED_OR_BLOCKED');
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
 if(await client.getChainId()!==56)throw new Error('DIRECT_WRONG_CHAIN');
 const ownerAddress=owner as Address,token=view.assetIn as Address;
 const args=[PANCAKE_V3.router,amount] as const;
 const simulation=await client.simulateContract({address:token,abi:tokenAbi,functionName:'approve',args,account:ownerAddress});
 if(simulation.result!==true)throw new Error('DIRECT_APPROVAL_SIMULATION_FAILED');
 const [gas,gasPrice,balance]=await Promise.all([client.estimateContractGas({address:token,abi:tokenAbi,functionName:'approve',args,account:ownerAddress}),client.getGasPrice(),client.getBalance({address:ownerAddress})]);
 if(balance<gas*gasPrice*13n/10n)throw new Error('DIRECT_APPROVAL_GAS_BLOCKED');
 const data=encodeFunctionData({abi:tokenAbi,functionName:'approve',args});
 const decoded=decodeFunctionData({abi:tokenAbi,data});
 if(decoded.functionName!=='approve'||decoded.args[0].toLowerCase()!==PANCAKE_V3.router.toLowerCase()||decoded.args[1]!==amount)throw new Error('DIRECT_APPROVAL_CALLDATA_MISMATCH');
 return {view,transaction:{chainId:56 as const,from:ownerAddress,to:token,data,value:0n,tokenIn:token,tokenOut:view.assetOut,amountIn:amount,amountOutMinimum:0n,deadline:BigInt(Math.floor(Date.now()/1000)+120)}};
}
