import {describe,expect,it} from 'vitest';
import type {DirectAttempt} from '@mandate/store';
import {directRoundTrip} from '../apps/api/src/direct-roundtrip.ts';
import {PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';

const cash='1000000000000000000',stock='1278310148654030',proceeds='993895483757431244';
const hashes=['0x'+'1'.repeat(64),'0x'+'2'.repeat(64),'0x'+'3'.repeat(64),'0x'+'4'.repeat(64)];
function attempt(kind:'approval'|'swap',direction:'BUY'|'SELL',hash:string,block:string,amount:string,gas:string,spentAtomic?:string,receivedAtomic?:string):DirectAttempt{
 const tokenIn=(direction==='BUY'?PANCAKE_V3.usdt:PANCAKE_V3.spyOn).toLowerCase(),tokenOut=(direction==='BUY'?PANCAKE_V3.spyOn:PANCAKE_V3.usdt).toLowerCase();
 return {id:hash,wallet:'0x'+'a'.repeat(40),kind,direction,chainId:56,to:kind==='approval'?tokenIn:PANCAKE_V3.router.toLowerCase(),data:'0x12345678',valueAtomic:'0',tokenIn,tokenOut,amountInAtomic:amount,minimumOutAtomic:'0',deadline:'1',preparedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),state:'confirmed',transactionHash:hash,settlement:{status:'success',blockNumber:block,blockHash:'0x'+'e'.repeat(64),confirmations:'12',observedAt:new Date().toISOString(),gasCostWei:gas,...(spentAtomic===undefined?{}:{spentAtomic,receivedAtomic})}};
}
describe('direct round-trip receipt',()=>{
 const records=()=>[
  attempt('approval','BUY',hashes[0]!,'10',cash,'10'),
  attempt('swap','BUY',hashes[1]!,'11',cash,'20',cash,stock),
  attempt('approval','SELL',hashes[2]!,'12',stock,'30'),
  attempt('swap','SELL',hashes[3]!,'13',stock,'40',stock,proceeds),
 ];
 it('links the exact bought and sold quantity and accounts for all four network fees',()=>{
  expect(directRoundTrip(records(),hashes[1]!)).toMatchObject({status:'VERIFIED_ROUND_TRIP',usdtSpentAtomic:cash,usdtReceivedAtomic:proceeds,boughtStockAtomic:stock,soldStockAtomic:stock,usdtDifferenceAtomic:'-6104516242568756',networkFeesWei:'100'});
 });
 it('withholds a complete receipt if token flow, an approval or a network fee is missing',()=>{
  const partial=records();partial[3]!.settlement!.spentAtomic='1';expect(directRoundTrip(partial,hashes[1]!)).toBeNull();
  const missingFee=records();delete missingFee[0]!.settlement!.gasCostWei;expect(directRoundTrip(missingFee,hashes[1]!)).toBeNull();
  expect(directRoundTrip(records(),hashes[0]!)).toBeNull();
  expect(directRoundTrip(records().filter(a=>a.kind==='swap'),hashes[1]!)).toBeNull();
 });
});
