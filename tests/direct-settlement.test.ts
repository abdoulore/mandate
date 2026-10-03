import {createServer,type Server} from 'node:http';
import {afterEach,describe,expect,it} from 'vitest';
import {keccak256,toHex} from 'viem';
import type {DirectAttempt} from '@mandate/store';
import {buildDirectSwap,PANCAKE_V3} from '../apps/api/src/pancake-direct.ts';
import {readDirectSettlement} from '../apps/api/src/direct-settlement.ts';

const wallet='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
const topic=keccak256(toHex('Transfer(address,address,uint256)'));
const word=(n:bigint)=>'0x'+n.toString(16).padStart(64,'0');
const addressTopic=(value:string)=>'0x'+'0'.repeat(24)+value.slice(2);
let server:Server|undefined;
const oldRpc=process.env.MANDATE_BSC_RPC_URL;
afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;if(oldRpc===undefined)delete process.env.MANDATE_BSC_RPC_URL;else process.env.MANDATE_BSC_RPC_URL=oldRpc;});
function attempt(kind:'swap'|'approval'='swap'):DirectAttempt{
 const swap=buildDirectSwap({direction:'BUY',recipient:wallet as `0x${string}`,amountIn:10n*10n**18n,quotedOut:10n**16n,nowMs:Date.now()});
 return {id:'attempt',wallet,kind,direction:'BUY',chainId:56,to:kind==='swap'?PANCAKE_V3.router.toLowerCase():PANCAKE_V3.usdt.toLowerCase(),data:kind==='swap'?swap.data:'0x095ea7b3'+'0'.repeat(64),valueAtomic:'0',tokenIn:PANCAKE_V3.usdt.toLowerCase(),tokenOut:PANCAKE_V3.spyOn.toLowerCase(),amountInAtomic:swap.amountIn.toString(),minimumOutAtomic:kind==='swap'?swap.amountOutMinimum.toString():'0',deadline:swap.deadline.toString(),preparedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+20000).toISOString(),state:'submitted',transactionHash:hash,settlement:null};
}
async function rpc(record:DirectAttempt,options:{wrongInput?:boolean;wrongTarget?:boolean;missingOutput?:boolean;shortOutput?:boolean;reverted?:boolean;allowanceLow?:boolean}={}){
 const transfer=(token:string,from:string,to:string,value:bigint,index:number)=>({address:token,topics:[topic,addressTopic(from),addressTopic(to)],data:word(value),blockNumber:'0x5a',blockHash,transactionHash:hash,transactionIndex:'0x0',logIndex:'0x'+index.toString(16),removed:false});
 const logs=options.reverted||record.kind==='approval'?[]:[transfer(record.tokenIn,wallet,PANCAKE_V3.router,BigInt(record.amountInAtomic),1),...options.missingOutput?[]:[transfer(record.tokenOut,PANCAKE_V3.router,wallet,options.shortOutput?1n:BigInt(record.minimumOutAtomic),2)]];
 server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const q=JSON.parse(raw),queries=Array.isArray(q)?q:[q];const results=queries.map((item:{id:number;method:string;params:unknown[]})=>{let result:unknown=null;
  if(item.method==='eth_chainId')result='0x38';
  if(item.method==='eth_getTransactionByHash')result={hash,blockHash,blockNumber:'0x5a',transactionIndex:'0x0',from:wallet,to:options.wrongTarget?PANCAKE_V3.quoter:record.to,value:'0x0',gas:'0x10000',gasPrice:'0x2',nonce:'0x0',input:options.wrongInput?'0xdeadbeef':record.data,type:'0x0',v:'0x1b',r:word(1n),s:word(1n)};
  if(item.method==='eth_getTransactionReceipt')result={transactionHash:hash,transactionIndex:'0x0',blockHash,blockNumber:'0x5a',from:wallet,to:record.to,cumulativeGasUsed:'0x100',gasUsed:'0x100',effectiveGasPrice:'0x2',contractAddress:null,logsBloom:'0x'+'0'.repeat(512),type:'0x0',status:options.reverted?'0x0':'0x1',logs};
  if(item.method==='eth_getBlockByNumber'){const latest=item.params[0]==='latest';result={number:latest?'0x69':'0x5a',hash:latest?'0x'+'c'.repeat(64):blockHash,parentHash:word(0n),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16),nonce:'0x0000000000000000',difficulty:'0x0',totalDifficulty:'0x0',size:'0x1',gasLimit:'0x100000',gasUsed:'0x100',miner:wallet,extraData:'0x',transactions:[],uncles:[],sha3Uncles:word(0n),transactionsRoot:word(0n),stateRoot:word(0n),receiptsRoot:word(0n),logsBloom:'0x'+'0'.repeat(512)};}
  if(item.method==='eth_call')result=word(options.allowanceLow?0n:BigInt(record.amountInAtomic));
  return {jsonrpc:'2.0',id:item.id,result};});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(q)?results:results[0]));
 });await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('NO_TEST_SERVER');process.env.MANDATE_BSC_RPC_URL='http://127.0.0.1:'+address.port;
}

describe('direct receipt reconciliation',()=>{
 it('accepts only the matching swap with sufficient output transfers',async()=>{const record=attempt();await rpc(record);expect(await readDirectSettlement(record)).toMatchObject({status:'success',blockNumber:'90',confirmations:'16'});});
 it('rejects a matching receipt without the output tokens',async()=>{const record=attempt();await rpc(record,{missingOutput:true});await expect(readDirectSettlement(record)).rejects.toThrow('DIRECT_SWAP_FLOW_UNVERIFIED');});
 it('rejects output below the recorded minimum',async()=>{const record=attempt();await rpc(record,{shortOutput:true});await expect(readDirectSettlement(record)).rejects.toThrow('DIRECT_SWAP_FLOW_UNVERIFIED');});
 it('rejects wrong calldata or destination even when the receipt succeeded',async()=>{const record=attempt();await rpc(record,{wrongInput:true});await expect(readDirectSettlement(record)).rejects.toThrow('DIRECT_TRANSACTION_MISMATCH');});
 it('rejects a transaction sent to another contract',async()=>{const record=attempt();await rpc(record,{wrongTarget:true});await expect(readDirectSettlement(record)).rejects.toThrow('DIRECT_TRANSACTION_MISMATCH');});
 it('requires the exact approval allowance at the receipt block',async()=>{const record=attempt('approval');await rpc(record,{allowanceLow:true});await expect(readDirectSettlement(record)).rejects.toThrow('DIRECT_APPROVAL_NOT_OBSERVED');});
 it('records a reverted matching transaction without treating it as a fill',async()=>{const record=attempt();await rpc(record,{reverted:true});expect((await readDirectSettlement(record)).status).toBe('reverted');});
});
