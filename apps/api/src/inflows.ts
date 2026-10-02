import {createPublicClient,http,parseAbi,keccak256,toHex,type Hash} from 'viem';
import {bsc} from 'viem/chains';
import {inflowProofSchema,type InflowProof} from '@mandate/domain';
const token='0x55d398326f99059ff775485246999027b3197955',transfer=keccak256(toHex('Transfer(address,address,uint256)')),abi=parseAbi(['function decimals() view returns (uint8)','function symbol() view returns (string)']);
export async function readInflowProof(wallet:string,transactionHash:string):Promise<InflowProof>{
 const owner=wallet.toLowerCase(),hash=transactionHash.toLowerCase() as Hash,client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0})});
 if(await client.getChainId()!==56)throw new Error('CHAIN_MISMATCH');
 const [receipt,tx,head]=await Promise.all([client.getTransactionReceipt({hash}),client.getTransaction({hash}),client.getBlock()]);
 if(receipt.status!=='success'||receipt.transactionHash.toLowerCase()!==hash||tx.hash.toLowerCase()!==hash||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||head.number===null||!head.hash)throw new Error('UNVERIFIED_RECEIPT');
 if(head.number-receipt.blockNumber+1n<12n)throw new Error('CONFIRMATIONS_REQUIRED');
 const age=Date.now()-Number(head.timestamp)*1000;if(age< -10000||age>60000)throw new Error('STALE_RPC_HEAD');
 const [canonical,decimals,symbol]=await Promise.all([client.getBlock({blockNumber:receipt.blockNumber}),client.readContract({address:token,abi,functionName:'decimals',blockNumber:receipt.blockNumber}),client.readContract({address:token,abi,functionName:'symbol',blockNumber:receipt.blockNumber})]);
 if(canonical.hash!==receipt.blockHash||Number(decimals)!==18||symbol!=='USDT'||receipt.logs.length>5000)throw new Error('UNVERIFIED_PAYMENT_IDENTITY');
 const proof:InflowProof={chainId:56,token,decimals:18,wallet:owner,transactionHash:hash,transactionSender:tx.from.toLowerCase(),blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash.toLowerCase(),headNumber:head.number.toString(),headHash:head.hash.toLowerCase(),observedAt:new Date().toISOString(),incoming:[],usdtOutgoingAtomic:'0',outgoingAssets:[]};
 for(const log of receipt.logs){if(log.topics[0]!==transfer)continue;const relevant=log.address.toLowerCase()===token;
  if(log.removed||log.blockHash!==receipt.blockHash||log.transactionHash.toLowerCase()!==hash||log.logIndex===null)throw new Error('UNVERIFIED_LOG');
  if(log.topics.length!==3||!/^0x[0-9a-fA-F]{64}$/.test(log.data)||log.topics.slice(1).some(t=>!/^0x0{24}[0-9a-fA-F]{40}$/.test(t!))){if(relevant)throw new Error('UNDECODABLE_PAYMENT_LOG');continue;}
  const from='0x'+log.topics[1]!.slice(-40).toLowerCase(),to='0x'+log.topics[2]!.slice(-40).toLowerCase(),amount=BigInt(log.data);if(amount===0n||from===to)continue;
  if(relevant&&to===owner)proof.incoming.push({logIndex:log.logIndex,from,to,amountAtomic:amount.toString()});
  if(from===owner){proof.outgoingAssets.push({contract:log.address.toLowerCase(),logIndex:log.logIndex,amountAtomic:amount.toString()});if(relevant)proof.usdtOutgoingAtomic=(BigInt(proof.usdtOutgoingAtomic)+amount).toString();}
 }
 // Recheck the receipt block after reading logs and identity.
 if((await client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw new Error('BLOCK_CHANGED');
 return inflowProofSchema.parse({...proof,observedAt:new Date().toISOString()});
}
