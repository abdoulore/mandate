import {describe,it,expect} from 'vitest';
import {decodeFunctionData} from 'viem';
import {assessReferenceCost,buildDirectSwap,PANCAKE_V3,pancakeRouterAbi} from '../apps/api/src/pancake-direct.ts';

const recipient='0x1111111111111111111111111111111111111111' as const;
const nowMs=Date.parse('2026-10-02T12:00:00Z');

describe('direct Pancake V3 transaction preparation',()=>{
 it('binds a 10 USDT buy to SPYon, the wallet, 0.5% minimum and a short deadline',()=>{
  const transaction=buildDirectSwap({direction:'BUY',recipient,amountIn:10n*10n**18n,quotedOut:12_829_022_819_485_697n,nowMs});
  const decoded=decodeFunctionData({abi:pancakeRouterAbi,data:transaction.data});
  expect(transaction.to).toBe(PANCAKE_V3.router);
  expect(transaction.value).toBe(0n);
  expect(decoded.functionName).toBe('exactInputSingle');
  if(decoded.functionName!=='exactInputSingle')throw new Error('Unexpected selector');
  expect(decoded.args[0].tokenIn.toLowerCase()).toBe(PANCAKE_V3.usdt.toLowerCase());
  expect(decoded.args[0].tokenOut.toLowerCase()).toBe(PANCAKE_V3.spyOn.toLowerCase());
  expect(decoded.args[0]).toMatchObject({fee:2500,recipient,amountIn:10n*10n**18n,amountOutMinimum:12_829_022_819_485_697n*995n/1000n,deadline:BigInt(Math.floor(nowMs/1000)+120)});
 });
 it('keeps a smaller buy within the same exact-input and minimum-output rules',()=>{
  const input=10n**16n,quoted=12_854_592_097_194n;
  const transaction=buildDirectSwap({direction:'BUY',recipient,amountIn:input,quotedOut:quoted,nowMs});
  const decoded=decodeFunctionData({abi:pancakeRouterAbi,data:transaction.data});
  expect(transaction.amountOutMinimum).toBe(quoted*995n/1000n);
  expect(decoded.functionName).toBe('exactInputSingle');
  if(decoded.functionName==='exactInputSingle')expect(decoded.args[0].amountIn).toBe(input);
 });
 it('binds the reverse sale and rejects an oversized trade',()=>{
  const sale=buildDirectSwap({direction:'SELL',recipient,amountIn:12_829_022_819_485_697n,quotedOut:9_935_733_702_015_095_466n,nowMs});
  expect(sale.tokenIn).toBe(PANCAKE_V3.spyOn);
  expect(sale.tokenOut).toBe(PANCAKE_V3.usdt);
  expect(()=>buildDirectSwap({direction:'BUY',recipient,amountIn:11n*10n**18n,quotedOut:1n,nowMs})).toThrow('DIRECT_BUY_CAP_EXCEEDED');
  expect(()=>buildDirectSwap({direction:'SELL',recipient,amountIn:3n*10n**16n,quotedOut:10n**18n,nowMs})).toThrow('DIRECT_SELL_CAP_EXCEEDED');
 });
 it('blocks stale marks and excessive buy or sell cost',()=>{
  const fresh=Date.parse('2026-10-02T12:00:00Z');
  expect(assessReferenceCost('BUY',10n*10n**18n,10n**16n,'1000',fresh,fresh).checked).toBe(true);
  expect(assessReferenceCost('BUY',10n*10n**18n,9n*10n**15n,'1000',fresh,fresh).reason).toBe('COST_LIMIT_EXCEEDED');
  expect(assessReferenceCost('SELL',10n**16n,9n*10n**18n,'1000',fresh,fresh).reason).toBe('COST_LIMIT_EXCEEDED');
  expect(assessReferenceCost('SELL',10n**16n,10n*10n**18n,'1000',fresh,fresh+300001).reason).toBe('REFERENCE_STALE');
 });
});
