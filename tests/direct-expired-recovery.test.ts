import {describe,expect,it} from 'vitest';
import {buildDirectSwap,PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';
import {readExpiredSwapRecovery,type RecoveryChain} from '../apps/api/src/direct-expired-recovery.ts';
import type {DirectAttempt} from '@mandate/store';

const wallet='0x'+'1'.repeat(40),blockHash=('0x'+'a'.repeat(64)) as `0x${string}`;
function fixture(){
 const preparedAt=Date.now()-600000;
 const swap=buildDirectSwap({direction:'BUY',recipient:wallet as `0x${string}`,amountIn:10n**18n,quotedOut:10n**15n,nowMs:preparedAt});
 const attempt:DirectAttempt={id:'unknown',wallet,kind:'swap',direction:'BUY',chainId:56,to:PANCAKE_V3.router.toLowerCase(),data:swap.data,valueAtomic:'0',tokenIn:swap.tokenIn.toLowerCase(),tokenOut:swap.tokenOut.toLowerCase(),amountInAtomic:swap.amountIn.toString(),minimumOutAtomic:swap.amountOutMinimum.toString(),deadline:swap.deadline.toString(),preparedAt:new Date(preparedAt).toISOString(),expiresAt:new Date(preparedAt+20000).toISOString(),state:'submission_unknown',transactionHash:null,settlement:null};
 return attempt;
}
function chain(options:{spend?:boolean;tooEarly?:boolean;wrongChain?:boolean}={}):RecoveryChain{
 const now=BigInt(Math.floor(Date.now()/1000)),base=now-1000n;
 return {
  getChainId:async()=>options.wrongChain?1:56,
  getBlock:async blockNumber=>{const number=blockNumber??100n;return {number,hash:blockHash,timestamp:options.tooEarly&&number===88n?BigInt(fixture().deadline)+30n:base+number*10n};},
  getOutgoing:async()=>options.spend?[{transactionHash:blockHash}]:[],
 };
}

describe('expired unknown swap recovery',()=>{
 it('releases only after the finalized deadline window has no input-token spend',async()=>{
  const result=await readExpiredSwapRecovery(fixture(),chain());
  expect(result).toMatchObject({reason:'expired_without_observed_token_spend',throughBlockHash:blockHash});
  expect(BigInt(result.throughBlock)).toBeGreaterThanOrEqual(BigInt(result.fromBlock));
 });
 it('keeps the barrier if any wallet input-token spend was observed',async()=>{await expect(readExpiredSwapRecovery(fixture(),chain({spend:true}))).rejects.toThrow('DIRECT_RECOVERY_SPEND_OBSERVED');});
 it('keeps the barrier until the deadline is final and the chain is correct',async()=>{
  await expect(readExpiredSwapRecovery(fixture(),chain({tooEarly:true}))).rejects.toThrow('DIRECT_RECOVERY_TOO_EARLY');
  await expect(readExpiredSwapRecovery(fixture(),chain({wrongChain:true}))).rejects.toThrow('DIRECT_RECOVERY_WRONG_CHAIN');
 });
 it('never releases an approval or a known transaction hash',async()=>{
  await expect(readExpiredSwapRecovery({...fixture(),kind:'approval'},chain())).rejects.toThrow('DIRECT_RECOVERY_NOT_AVAILABLE');
  await expect(readExpiredSwapRecovery({...fixture(),transactionHash:blockHash},chain())).rejects.toThrow('DIRECT_RECOVERY_NOT_AVAILABLE');
 });
});
