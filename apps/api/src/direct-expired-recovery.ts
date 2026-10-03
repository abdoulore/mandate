import {createPublicClient,decodeFunctionData,http,parseAbiItem,type Address,type Hex} from 'viem';
import {bsc} from 'viem/chains';
import type {DirectAttempt} from '@mandate/store';
import {PANCAKE_V3,pancakeRouterAbi} from './pancake-direct.ts';

export type ExpiredSwapRecovery={reason:'expired_without_observed_token_spend';checkedAt:string;fromBlock:string;throughBlock:string;throughBlockHash:string;throughTimestamp:string};
type Block={number:bigint;hash:Hex|null;timestamp:bigint};
export type RecoveryChain={
 getChainId():Promise<number>;
 getBlock(blockNumber?:bigint):Promise<Block>;
 getOutgoing(token:Address,owner:Address,fromBlock:bigint,toBlock:bigint):Promise<unknown[]>;
};

function publicRecoveryChain():RecoveryChain{
 // BNB Chain's public dataseed rejects eth_getLogs even for a small range.
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RECOVERY_RPC_URL||'https://bsc-rpc.publicnode.com',{timeout:12000,retryCount:0})});
 const transfer=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
 return {
  getChainId:()=>client.getChainId(),
  getBlock:(blockNumber)=>client.getBlock(blockNumber===undefined?{}:{blockNumber}),
  getOutgoing:(token,owner,fromBlock,toBlock)=>client.getLogs({address:token,event:transfer,args:{from:owner},fromBlock,toBlock}),
 };
}

// A swap can only spend tokens while the router's calldata deadline is valid.
// Scan every finalized input-token Transfer from this wallet in that window.
// Any spend, incomplete RPC evidence, or an unexpired deadline keeps the barrier.
export async function readExpiredSwapRecovery(attempt:DirectAttempt,chain:RecoveryChain=publicRecoveryChain()):Promise<ExpiredSwapRecovery>{
 if(attempt.kind!=='swap'||attempt.state!=='submission_unknown'||attempt.transactionHash!==null||attempt.chainId!==56||attempt.to!==PANCAKE_V3.router.toLowerCase())throw new Error('DIRECT_RECOVERY_NOT_AVAILABLE');
 const preparedAt=Date.parse(attempt.preparedAt),deadline=BigInt(attempt.deadline);
 if(!Number.isFinite(preparedAt)||deadline<=0n||deadline*1000n<=BigInt(preparedAt)||deadline*1000n>BigInt(preparedAt+300000))throw new Error('DIRECT_RECOVERY_INVALID_WINDOW');
 try{
  const decoded=decodeFunctionData({abi:pancakeRouterAbi,data:attempt.data as Hex});
  if(decoded.functionName!=='exactInputSingle'||decoded.args[0].deadline!==deadline||decoded.args[0].tokenIn.toLowerCase()!==attempt.tokenIn||decoded.args[0].amountIn.toString()!==attempt.amountInAtomic||decoded.args[0].recipient.toLowerCase()!==attempt.wallet)throw new Error('DIRECT_RECOVERY_INVALID_PAYLOAD');
 }catch{throw new Error('DIRECT_RECOVERY_INVALID_PAYLOAD');}
 if(await chain.getChainId()!==56)throw new Error('DIRECT_RECOVERY_WRONG_CHAIN');
 const head=await chain.getBlock();
 if(!head.hash||head.number<12n||Math.abs(Date.now()-Number(head.timestamp)*1000)>60000)throw new Error('DIRECT_RECOVERY_STALE_CHAIN');
 const stable=await chain.getBlock(head.number-12n);
 if(!stable.hash||stable.timestamp<deadline+60n)throw new Error('DIRECT_RECOVERY_TOO_EARLY');
 async function firstAtOrAfter(timestamp:bigint){let low=0n,high=stable.number;while(low<high){const mid=(low+high)/2n,block=await chain.getBlock(mid);if(block.timestamp<timestamp)low=mid+1n;else high=mid;}return low;}
 const fromBlock=await firstAtOrAfter(BigInt(Math.floor(preparedAt/1000)-30));
 const throughBlock=await firstAtOrAfter(deadline+1n);
 if(throughBlock<fromBlock||throughBlock-fromBlock>1000n)throw new Error('DIRECT_RECOVERY_INVALID_WINDOW');
 const outgoing=await chain.getOutgoing(attempt.tokenIn as Address,attempt.wallet as Address,fromBlock,throughBlock);
 if(outgoing.length>0)throw new Error('DIRECT_RECOVERY_SPEND_OBSERVED');
 return {reason:'expired_without_observed_token_spend',checkedAt:new Date().toISOString(),fromBlock:fromBlock.toString(),throughBlock:throughBlock.toString(),throughBlockHash:stable.hash.toLowerCase(),throughTimestamp:stable.timestamp.toString()};
}
