import {createPublicClient,http,keccak256,toHex,type Hash} from 'viem';
import {bsc} from 'viem/chains';
import type {DirectAttempt} from '@mandate/store';
import {PANCAKE_V3} from './pancake-direct.ts';
import {readSettlementObservation} from './settlement-observation.ts';

const approvalTopic=keccak256(toHex('Approval(address,address,uint256)'));
const addressTopic=(address:string)=>'0x'+'0'.repeat(24)+address.slice(2).toLowerCase();

// Fail closed if the observed transaction differs from the one whose wallet
// prompt was journaled. A successful swap additionally needs token-flow proof.
export async function readDirectSettlement(attempt:DirectAttempt){
 if(!attempt.transactionHash||attempt.state!=='submitted')throw new Error('DIRECT_ATTEMPT_NOT_SUBMITTED');
 const observed=await readSettlementObservation(attempt.wallet,attempt.transactionHash);
 const client=createPublicClient({chain:bsc,transport:http(process.env.MANDATE_BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0})});
 const tx=await client.getTransaction({hash:attempt.transactionHash as Hash});
 if(tx.hash.toLowerCase()!==attempt.transactionHash||tx.from.toLowerCase()!==attempt.wallet||tx.to?.toLowerCase()!==attempt.to||tx.input.toLowerCase()!==attempt.data.toLowerCase()||tx.value!==0n||tx.blockHash?.toLowerCase()!==observed.blockHash||tx.blockNumber?.toString()!==observed.blockNumber||observed.transactionSender!==attempt.wallet||observed.transactionTo!==attempt.to)throw new Error('DIRECT_TRANSACTION_MISMATCH');
 let spentAtomic:string|undefined,receivedAtomic:string|undefined;
 if(observed.chainStatus==='success'){
  if(attempt.kind==='approval'){
   const receipt=await client.getTransactionReceipt({hash:attempt.transactionHash as Hash});
   if(receipt.blockHash.toLowerCase()!==observed.blockHash||receipt.blockNumber.toString()!==observed.blockNumber||receipt.status!=='success')throw new Error('DIRECT_APPROVAL_NOT_OBSERVED');
   const approvals=receipt.logs.filter(log=>!log.removed&&log.address.toLowerCase()===attempt.tokenIn&&log.blockHash.toLowerCase()===observed.blockHash&&log.transactionHash.toLowerCase()===attempt.transactionHash&&log.topics.length===3&&log.topics[0]===approvalTopic&&log.topics[1]?.toLowerCase()===addressTopic(attempt.wallet)&&log.topics[2]?.toLowerCase()===addressTopic(PANCAKE_V3.router)&&/^0x[0-9a-fA-F]{64}$/.test(log.data));
   if(approvals.length!==1||BigInt(approvals[0]!.data)!==BigInt(attempt.amountInAtomic))throw new Error('DIRECT_APPROVAL_NOT_OBSERVED');
  }else{
   const spent=observed.walletTransfers.filter(t=>t.token===attempt.tokenIn&&t.direction==='out').reduce((sum,t)=>sum+BigInt(t.amountAtomic),0n);
   const received=observed.walletTransfers.filter(t=>t.token===attempt.tokenOut&&t.direction==='in').reduce((sum,t)=>sum+BigInt(t.amountAtomic),0n);
   if(spent!==BigInt(attempt.amountInAtomic)||received<BigInt(attempt.minimumOutAtomic))throw new Error('DIRECT_SWAP_FLOW_UNVERIFIED');
   spentAtomic=spent.toString();receivedAtomic=received.toString();
  }
 }
 return {status:observed.chainStatus,blockNumber:observed.blockNumber,blockHash:observed.blockHash,confirmations:observed.confirmations,observedAt:observed.observedAt,gasCostWei:observed.transactionGasCostWei,...(spentAtomic===undefined?{}:{spentAtomic,receivedAtomic})};
}
