import {createPublicClient,http,isAddress,keccak256,parseAbi,type Address} from 'viem';
import {bsc} from 'viem/chains';
import {BSC_USDT} from '@mandate/connectors';

const tokenAbi=parseAbi([
 'function balanceOf(address) view returns (uint256)',
 'function allowance(address,address) view returns (uint256)',
 'function decimals() view returns (uint8)'
]);
const loupeAbi=parseAbi(['function facetAddress(bytes4) view returns (address)']);
const observedRouter='0xb44446b0c8e56988c34f7ff73ae904982b5fdda5';
const observedRouterHash='0xb6f35276cf3608595df59a3cfa5fb06a3309e64e387b0ea4f60875fdc4c696a0';
const observedSelector='0xad43f73d';
const observedFacet='0xa9fa1b56f4d7bd25375c2d40b4c8e36a9509e603';
const observedFacetHash='0x5ae2caa18a9d1d2dc528e6a1e9edf284883c023a617cc269b96620e4712d8ba0';
const zeroAddress='0x0000000000000000000000000000000000000000';

export type ReadinessInput={owner:string;spender:string|null;router:string;selector:string|null;requiredAtomic:string};
export type ReadinessObservation={blockNumber:bigint;observedAt:string;chainId:number;paymentDecimals:number;paymentBalance:bigint;allowance:bigint|null;nativeBalance:bigint;routerCodeHash:string|null;facet:string|null;facetCodeHash:string|null};

// Balances and code fingerprints are observations at one block. They do not certify a swap.
export function summarizeWalletReadiness(input:ReadinessInput,observation:ReadinessObservation){
 const required=BigInt(input.requiredAtomic);
 const precisionMatches=observation.paymentDecimals===18;
 const fingerprintMatches=input.router.toLowerCase()===observedRouter&&input.selector?.toLowerCase()===observedSelector&&observation.routerCodeHash===observedRouterHash&&observation.facet?.toLowerCase()===observedFacet&&observation.facetCodeHash===observedFacetHash;
 return {
  state:'OBSERVED' as const,blockNumber:observation.blockNumber.toString(),observedAt:observation.observedAt,
  chainId:observation.chainId,paymentDecimals:observation.paymentDecimals,paymentBalanceAtomic:observation.paymentBalance.toString(),requiredAtomic:required.toString(),
  balanceCoversAmount:precisionMatches?observation.paymentBalance>=required:null,allowanceAtomic:observation.allowance?.toString()??null,allowanceCoversAmount:precisionMatches&&observation.allowance!==null?observation.allowance>=required:null,
  bnbBalanceAtomic:observation.nativeBalance.toString(),bnbPresent:observation.nativeBalance>0n,
  paymentPrecisionMatches:precisionMatches,routerFingerprintMatches:fingerprintMatches,
  spenderCandidate:input.spender,router:input.router,facet:observation.facet,
  executionCertified:false as const,
  note:'Read-only balances, allowance and code observations. Approval is not requested. Gas sufficiency, eligibility, calldata semantics and execution remain unverified.'
 };
}

export async function readWalletReadiness(input:ReadinessInput){
 if(!isAddress(input.owner)||!isAddress(input.router)||(input.spender!==null&&!isAddress(input.spender))||!/^0x[0-9a-fA-F]{8}$/.test(input.selector??'')||!/^[1-9]\d*$/.test(input.requiredAtomic))throw new Error('Invalid wallet readiness request');
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
 const chainId=await client.getChainId();if(chainId!==56)throw new Error('Unexpected chain');
 const blockNumber=await client.getBlockNumber();
 const owner=input.owner as Address,router=input.router as Address,spender=input.spender as Address|null,selector=input.selector as `0x${string}`;
 const [paymentBalance,allowance,nativeBalance,paymentDecimals,routerCode,facet]=await Promise.all([
  client.readContract({address:BSC_USDT,abi:tokenAbi,functionName:'balanceOf',args:[owner],blockNumber}),
  spender?client.readContract({address:BSC_USDT,abi:tokenAbi,functionName:'allowance',args:[owner,spender],blockNumber}):Promise.resolve(null),
  client.getBalance({address:owner,blockNumber}),
  client.readContract({address:BSC_USDT,abi:tokenAbi,functionName:'decimals',blockNumber}),
  client.getBytecode({address:router,blockNumber}),
  client.readContract({address:router,abi:loupeAbi,functionName:'facetAddress',args:[selector],blockNumber}).catch(()=>null)
 ]);
 const liveFacet=facet&&facet.toLowerCase()!==zeroAddress?facet:null;
 const facetCode=liveFacet?await client.getBytecode({address:liveFacet,blockNumber}).catch(()=>null):null;
 return summarizeWalletReadiness(input,{blockNumber,observedAt:new Date().toISOString(),chainId,paymentDecimals:Number(paymentDecimals),paymentBalance,allowance,nativeBalance,routerCodeHash:routerCode?keccak256(routerCode):null,facet:liveFacet,facetCodeHash:facetCode?keccak256(facetCode):null});
}
