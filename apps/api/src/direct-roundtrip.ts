import type {DirectAttempt} from '@mandate/store';
import {PANCAKE_V3} from './pancake-direct.ts';

// A receipt is complete only when four separately confirmed wallet actions
// link the same exact stock quantity and each has a recorded network fee.
export function directRoundTrip(attempts:DirectAttempt[],buyHash:string){
 const confirmed=attempts.filter(a=>a.state==='confirmed'&&a.settlement?.status==='success'&&a.transactionHash&&a.settlement.gasCostWei!==undefined);
 const usdt=PANCAKE_V3.usdt.toLowerCase(),stockToken=PANCAKE_V3.spyOn.toLowerCase(),router=PANCAKE_V3.router.toLowerCase();
 const buy=confirmed.find(a=>a.kind==='swap'&&a.direction==='BUY'&&a.transactionHash===buyHash.toLowerCase()&&a.to===router&&a.tokenIn===usdt&&a.tokenOut===stockToken&&a.settlement?.spentAtomic==='1000000000000000000'&&a.settlement.receivedAtomic&&BigInt(a.settlement.receivedAtomic)>0n);
 if(!buy?.settlement?.receivedAtomic||!buy.settlement.spentAtomic)return null;
 const stock=buy.settlement.receivedAtomic,buyBlock=BigInt(buy.settlement.blockNumber);
 const sell=confirmed.find(a=>a.kind==='swap'&&a.direction==='SELL'&&a.wallet===buy.wallet&&a.to===router&&a.tokenIn===stockToken&&a.tokenOut===usdt&&a.amountInAtomic===stock&&a.settlement?.spentAtomic===stock&&a.settlement.receivedAtomic&&BigInt(a.settlement.receivedAtomic)>0n&&BigInt(a.settlement.blockNumber)>buyBlock);
 if(!sell?.settlement?.receivedAtomic)return null;
 const sellBlock=BigInt(sell.settlement.blockNumber);
 const latestApproval=(direction:'BUY'|'SELL',amount:string,token:string,after:bigint,before:bigint)=>confirmed.filter(a=>a.kind==='approval'&&a.direction===direction&&a.wallet===buy.wallet&&a.to===token&&a.tokenIn===token&&a.amountInAtomic===amount&&BigInt(a.settlement!.blockNumber)>after&&BigInt(a.settlement!.blockNumber)<before).sort((a,b)=>BigInt(a.settlement!.blockNumber)>BigInt(b.settlement!.blockNumber)?-1:1)[0];
 const buyApproval=latestApproval('BUY',buy.amountInAtomic,usdt,0n,buyBlock),sellApproval=latestApproval('SELL',stock,stockToken,buyBlock,sellBlock);
 if(!buyApproval?.transactionHash||!sellApproval?.transactionHash||!buy.transactionHash||!sell.transactionHash)return null;
 const fees=[buyApproval,buy,sellApproval,sell].map(a=>BigInt(a.settlement!.gasCostWei!));
 return {status:'VERIFIED_ROUND_TRIP' as const,buyApprovalHash:buyApproval.transactionHash,buyHash:buy.transactionHash,sellApprovalHash:sellApproval.transactionHash,sellHash:sell.transactionHash,
  boughtStockAtomic:stock,soldStockAtomic:stock,usdtSpentAtomic:buy.settlement.spentAtomic,usdtReceivedAtomic:sell.settlement.receivedAtomic,
  usdtDifferenceAtomic:(BigInt(sell.settlement.receivedAtomic)-BigInt(buy.settlement.spentAtomic)).toString(),networkFeesWei:fees.reduce((sum,fee)=>sum+fee,0n).toString(),
  buyBlock:buy.settlement.blockNumber,sellBlock:sell.settlement.blockNumber};
}
