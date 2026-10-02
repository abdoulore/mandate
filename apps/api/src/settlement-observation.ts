import {createPublicClient,http,keccak256,toHex,type Hash} from 'viem';
import {bsc} from 'viem/chains';

const transferTopic=keccak256(toHex('Transfer(address,address,uint256)'));
const addressPattern=/^0x[0-9a-fA-F]{40}$/;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
const topicAddressPattern=/^0x0{24}[0-9a-fA-F]{40}$/;
const amountPattern=/^0x[0-9a-fA-F]{64}$/;

export type SettlementObservation={
 chainId:56;
 wallet:string;
 transactionHash:string;
 transactionSender:string;
 transactionTo:string|null;
 chainStatus:'success'|'reverted';
 blockNumber:string;
 blockHash:string;
 headNumber:string;
 confirmations:string;
 observedAt:string;
 gasUsed:string;
 effectiveGasPriceWei:string;
 transactionGasCostWei:string;
 walletTransfers:{token:string;logIndex:number;from:string;to:string;amountAtomic:string;direction:'in'|'out'}[];
 economicCompletion:'unverified';
};

// Receipt logs are a chain observation, not proof of RFQ fill, token accounting,
// fees beyond gas, or the wallet's final balance. No ledger method consumes this.
export async function readSettlementObservation(wallet:string,transactionHash:string):Promise<SettlementObservation>{
 if(!addressPattern.test(wallet)||!hashPattern.test(transactionHash))throw new Error('INVALID_SETTLEMENT_INPUT');
 const owner=wallet.toLowerCase(),hash=transactionHash.toLowerCase() as Hash;
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0})});
 if(await client.getChainId()!==56)throw new Error('CHAIN_MISMATCH');
 const [receipt,tx,head]=await Promise.all([client.getTransactionReceipt({hash}),client.getTransaction({hash}),client.getBlock()]);
 if(receipt.transactionHash.toLowerCase()!==hash||tx.hash.toLowerCase()!==hash||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||head.number===null||!head.hash)throw new Error('UNVERIFIED_RECEIPT');
 if(head.number<receipt.blockNumber||head.number-receipt.blockNumber+1n<12n)throw new Error('CONFIRMATIONS_REQUIRED');
 const age=Date.now()-Number(head.timestamp)*1000;if(age< -10000||age>60000)throw new Error('STALE_RPC_HEAD');
 if(receipt.logs.length>5000)throw new Error('TOO_MANY_RECEIPT_LOGS');
 const canonical=await client.getBlock({blockNumber:receipt.blockNumber});
 if(canonical.hash!==receipt.blockHash)throw new Error('BLOCK_CHANGED');
 const transfers:SettlementObservation['walletTransfers']=[];
 for(const log of receipt.logs){
  if(log.removed||log.blockHash!==receipt.blockHash||log.transactionHash.toLowerCase()!==hash||log.logIndex===null)throw new Error('UNVERIFIED_LOG');
  if(log.topics[0]!==transferTopic)continue;
  if(log.topics.length!==3||!topicAddressPattern.test(log.topics[1]??'')||!topicAddressPattern.test(log.topics[2]??'')||!amountPattern.test(log.data))throw new Error('UNDECODABLE_TRANSFER_LOG');
  const from='0x'+log.topics[1]!.slice(-40).toLowerCase(),to='0x'+log.topics[2]!.slice(-40).toLowerCase();
  if(from===to||BigInt(log.data)===0n)continue;
  if(from===owner)transfers.push({token:log.address.toLowerCase(),logIndex:log.logIndex,from,to,amountAtomic:BigInt(log.data).toString(),direction:'out'});
  if(to===owner)transfers.push({token:log.address.toLowerCase(),logIndex:log.logIndex,from,to,amountAtomic:BigInt(log.data).toString(),direction:'in'});
 }
 if(receipt.status==='reverted'&&transfers.length)throw new Error('REVERTED_RECEIPT_WITH_TRANSFERS');
 if((await client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw new Error('BLOCK_CHANGED');
 return {chainId:56,wallet:owner,transactionHash:hash,transactionSender:tx.from.toLowerCase(),transactionTo:tx.to?.toLowerCase()??null,chainStatus:receipt.status,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash.toLowerCase(),headNumber:head.number.toString(),confirmations:(head.number-receipt.blockNumber+1n).toString(),observedAt:new Date().toISOString(),gasUsed:receipt.gasUsed.toString(),effectiveGasPriceWei:receipt.effectiveGasPrice.toString(),transactionGasCostWei:(receipt.gasUsed*receipt.effectiveGasPrice).toString(),walletTransfers:transfers,economicCompletion:'unverified'};
}
