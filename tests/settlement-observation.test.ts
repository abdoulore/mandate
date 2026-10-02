import {afterEach,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {keccak256,toHex} from 'viem';
import {readSettlementObservation} from '../apps/api/src/settlement-observation.ts';

const wallet='0x'+'1'.repeat(40),counterparty='0x'+'2'.repeat(40),token='0x'+'3'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
const topic=keccak256(toHex('Transfer(address,address,uint256)'));
const word=(n:bigint)=>'0x'+n.toString(16).padStart(64,'0');
const addressTopic=(s:string)=>'0x'+'0'.repeat(24)+s.slice(2);
let server:Server|undefined;
const originalRpc=process.env.MANDATE_BSC_RPC_URL;
afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;if(originalRpc===undefined)delete process.env.MANDATE_BSC_RPC_URL;else process.env.MANDATE_BSC_RPC_URL=originalRpc;});

async function rpc(options:{reverted?:boolean;wrongBlock?:boolean;lowConfirmations?:boolean;malformedLog?:boolean;wrongChain?:boolean}={}){
 const transfer={address:token,topics:[topic,addressTopic(wallet),addressTopic(counterparty)],data:options.malformedLog?'0x01':word(7n),blockNumber:'0x5a',blockHash,transactionHash:hash,transactionIndex:'0x0',logIndex:'0x1',removed:false};
 server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const query=JSON.parse(raw);let result:unknown=null;
  if(query.method==='eth_chainId')result=options.wrongChain?'0x1':'0x38';
  if(query.method==='eth_getTransactionByHash')result={hash,blockHash,blockNumber:'0x5a',transactionIndex:'0x0',from:wallet,to:counterparty,value:'0x0',gas:'0x10000',gasPrice:'0x2',nonce:'0x0',input:'0x',type:'0x0',v:'0x1b',r:word(1n),s:word(1n)};
  if(query.method==='eth_getTransactionReceipt')result={transactionHash:hash,transactionIndex:'0x0',blockHash,blockNumber:'0x5a',from:wallet,to:counterparty,cumulativeGasUsed:'0x100',gasUsed:'0x100',effectiveGasPrice:'0x2',contractAddress:null,logsBloom:'0x'+'0'.repeat(512),type:'0x0',status:options.reverted?'0x0':'0x1',logs:options.reverted?[]:[transfer]};
  if(query.method==='eth_getBlockByNumber'){const latest=query.params[0]==='latest';result={number:latest?(options.lowConfirmations?'0x64':'0x69'):'0x5a',hash:latest?'0x'+'c'.repeat(64):(options.wrongBlock?'0x'+'d'.repeat(64):blockHash),parentHash:word(0n),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16),nonce:'0x0000000000000000',difficulty:'0x0',totalDifficulty:'0x0',size:'0x1',gasLimit:'0x100000',gasUsed:'0x100',miner:wallet,extraData:'0x',transactions:[],uncles:[],sha3Uncles:word(0n),transactionsRoot:word(0n),stateRoot:word(0n),receiptsRoot:word(0n),logsBloom:'0x'+'0'.repeat(512)};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:query.id,result}));
 });await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('NO_TEST_SERVER');process.env.MANDATE_BSC_RPC_URL='http://127.0.0.1:'+address.port;
}

describe('read-only chain settlement observation',()=>{
 it('records a confirmed wallet transfer and gas without certifying economic completion',async()=>{await rpc();const observation=await readSettlementObservation(wallet,hash);expect(observation).toMatchObject({chainId:56,wallet,transactionHash:hash,chainStatus:'success',confirmations:'16',transactionGasCostWei:'512',economicCompletion:'unverified'});expect(observation.walletTransfers).toEqual([{token,logIndex:1,from:wallet,to:counterparty,amountAtomic:'7',direction:'out'}]);});
 it('retains a reverted transaction as a gas-cost observation, not a fill',async()=>{await rpc({reverted:true});const observation=await readSettlementObservation(wallet,hash);expect(observation.chainStatus).toBe('reverted');expect(observation.walletTransfers).toEqual([]);expect(observation.transactionGasCostWei).toBe('512');});
 it('rejects insufficient confirmation and noncanonical block evidence',async()=>{await rpc({lowConfirmations:true});await expect(readSettlementObservation(wallet,hash)).rejects.toThrow('CONFIRMATIONS_REQUIRED');});
 it('rejects a changed canonical block',async()=>{await rpc({wrongBlock:true});await expect(readSettlementObservation(wallet,hash)).rejects.toThrow('BLOCK_CHANGED');});
 it('rejects ambiguous transfer logs and the wrong chain',async()=>{await rpc({malformedLog:true});await expect(readSettlementObservation(wallet,hash)).rejects.toThrow('UNDECODABLE_TRANSFER_LOG');});
 it('requires BSC before observing a receipt',async()=>{await rpc({wrongChain:true});await expect(readSettlementObservation(wallet,hash)).rejects.toThrow('CHAIN_MISMATCH');});
});
