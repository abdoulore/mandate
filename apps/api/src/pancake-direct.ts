import {decodeFunctionData,encodeFunctionData,parseAbi,parseUnits,type Address,type Hex} from 'viem';
import {BSC_USDT} from '@mandate/connectors';

// Deployment addresses: pancakeswap/pancake-v3-contracts/deployments/bscMainnet.json.
// Interface: projects/v3-periphery/contracts/interfaces/ISwapRouter.sol.
export const PANCAKE_V3={
 factory:'0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as Address,
 quoter:'0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997' as Address,
 router:'0x1b81D678ffb9C0263b24A97847620C99d213eB14' as Address,
 spyOn:'0x6a708ead771238919d85930b5a0f10454e1c331a' as Address,
 usdt:BSC_USDT as Address,
 fee:2500,
 routerCodeHash:'0x61002a11263b2c38ff8d5ded90a655987ed98f171a31840ee0014dd7052bccda' as Hex,
} as const;

export const pancakeRouterAbi=parseAbi([
 'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
]);
export const pancakeFactoryAbi=parseAbi(['function getPool(address,address,uint24) view returns (address)']);
export const pancakePoolAbi=parseAbi([
 'function factory() view returns (address)',
 'function token0() view returns (address)',
 'function token1() view returns (address)',
 'function fee() view returns (uint24)',
 'function liquidity() view returns (uint128)',
]);
export const pancakeQuoterAbi=parseAbi([
 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);

export type DirectDirection='BUY'|'SELL';
export type DirectSwapIntent={direction:DirectDirection;recipient:Address;amountIn:bigint;quotedOut:bigint;nowMs:number};

// Compare the pool quote with a separately sourced token reference mark.
// This is a conservative demo cap, not a guarantee of fair value or USDT parity.
export function assessReferenceCost(direction:DirectDirection,amountIn:bigint,quotedOut:bigint,tokenPrice:string,updatedAtMs:number,nowMs:number){
 if(!Number.isSafeInteger(updatedAtMs)||!Number.isSafeInteger(nowMs)||updatedAtMs>nowMs+10000||nowMs-updatedAtMs>300000)return {checked:false,reason:'REFERENCE_STALE' as const,deviationBps:null};
 let priceAtomic:bigint;try{priceAtomic=parseUnits(tokenPrice,18);}catch{return {checked:false,reason:'REFERENCE_INVALID' as const,deviationBps:null};}
 if(priceAtomic<=0n||amountIn<=0n||quotedOut<=0n)return {checked:false,reason:'REFERENCE_INVALID' as const,deviationBps:null};
 const stockAtomic=direction==='BUY'?quotedOut:amountIn;
 const cashAtomic=direction==='BUY'?amountIn:quotedOut;
 const fairCashAtomic=stockAtomic*priceAtomic/10n**18n;
 if(fairCashAtomic<=0n)return {checked:false,reason:'REFERENCE_INVALID' as const,deviationBps:null};
 const deviationBps=(cashAtomic-fairCashAtomic)*10000n/fairCashAtomic;
 const checked=direction==='BUY'?deviationBps<=200n:deviationBps>=-200n;
 return {checked,reason:checked?'WITHIN_LIMIT' as const:'COST_LIMIT_EXCEEDED' as const,deviationBps:deviationBps.toString()};
}

// This prepares a transparent Pancake V3 single-pool transaction; it never sends one.
// The caller must separately prove pool identity, current quote, wallet state and simulation.
export function buildDirectSwap(intent:DirectSwapIntent){
 const {direction,recipient,amountIn,quotedOut,nowMs}=intent;
 if(!/^0x[0-9a-fA-F]{40}$/.test(recipient)||!Number.isSafeInteger(nowMs)||nowMs<=0)throw new Error('INVALID_DIRECT_SWAP_IDENTITY');
 if(amountIn<=0n||quotedOut<=0n)throw new Error('INVALID_DIRECT_SWAP_AMOUNT');
 if(direction==='BUY'&&amountIn>10n*10n**18n)throw new Error('DIRECT_BUY_CAP_EXCEEDED');
 if(direction==='SELL'&&(amountIn>2n*10n**16n||quotedOut>11n*10n**18n))throw new Error('DIRECT_SELL_CAP_EXCEEDED');
 const tokenIn=direction==='BUY'?PANCAKE_V3.usdt:PANCAKE_V3.spyOn;
 const tokenOut=direction==='BUY'?PANCAKE_V3.spyOn:PANCAKE_V3.usdt;
 const deadline=BigInt(Math.floor(nowMs/1000)+120);
 const amountOutMinimum=quotedOut*995n/1000n;
 if(amountOutMinimum<=0n)throw new Error('DIRECT_MINIMUM_ZERO');
 const params={tokenIn,tokenOut,fee:PANCAKE_V3.fee,recipient,deadline,amountIn,amountOutMinimum,sqrtPriceLimitX96:0n};
 const data=encodeFunctionData({abi:pancakeRouterAbi,functionName:'exactInputSingle',args:[params]});
 const decoded=decodeFunctionData({abi:pancakeRouterAbi,data});
 if(decoded.functionName!=='exactInputSingle'||decoded.args[0].tokenIn.toLowerCase()!==tokenIn.toLowerCase()||decoded.args[0].tokenOut.toLowerCase()!==tokenOut.toLowerCase()||decoded.args[0].recipient.toLowerCase()!==recipient.toLowerCase()||decoded.args[0].amountIn!==amountIn||decoded.args[0].amountOutMinimum!==amountOutMinimum||decoded.args[0].deadline!==deadline||decoded.args[0].fee!==PANCAKE_V3.fee)throw new Error('DIRECT_CALLDATA_MISMATCH');
 return {chainId:56 as const,to:PANCAKE_V3.router,from:recipient,value:0n,data,tokenIn,tokenOut,amountIn,quotedOut,amountOutMinimum,deadline,fee:PANCAKE_V3.fee};
}
