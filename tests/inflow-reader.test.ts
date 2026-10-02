import {afterEach,describe,it,expect} from 'vitest';
import {createServer,type Server} from 'node:http';
import {encodeAbiParameters,keccak256,toHex} from 'viem';
import {readInflowProof} from '../apps/api/src/inflows.ts';
const wallet='0x'+'1'.repeat(40),sender='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64),token='0x55d398326f99059ff775485246999027b3197955',topic=keccak256(toHex('Transfer(address,address,uint256)')),word=(n:bigint)=>'0x'+n.toString(16).padStart(64,'0'),addressTopic=(s:string)=>'0x'+'0'.repeat(24)+s.slice(2);
let server:Server|undefined,old=process.env.MANDATE_BSC_RPC_URL;
afterEach(async()=>{if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;if(old===undefined)delete process.env.MANDATE_BSC_RPC_URL;else process.env.MANDATE_BSC_RPC_URL=old;});
async function rpc(options:{failed?:boolean;canonicalMismatch?:boolean;confirmationsLow?:boolean;outgoing?:boolean;wrongSymbol?:boolean}={}){
 const incoming={address:token,topics:[topic,addressTopic(sender),addressTopic(wallet)],data:word(10n*10n**18n),blockNumber:'0x5a',blockHash,transactionHash:hash,transactionIndex:'0x0',logIndex:'0x1',removed:false};
 server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);let result:unknown=null;
  if(q.method==='eth_chainId')result='0x38';
  if(q.method==='eth_getTransactionByHash')result={hash,blockHash,blockNumber:'0x5a',transactionIndex:'0x0',from:sender,to:token,value:'0x0',gas:'0x10000',gasPrice:'0x1',nonce:'0x0',input:'0x',type:'0x0',v:'0x1b',r:word(1n),s:word(1n)};
  if(q.method==='eth_getTransactionReceipt')result={transactionHash:hash,transactionIndex:'0x0',blockHash,blockNumber:'0x5a',from:sender,to:token,cumulativeGasUsed:'0x100',gasUsed:'0x100',effectiveGasPrice:'0x1',contractAddress:null,logsBloom:'0x'+'0'.repeat(512),type:'0x0',status:options.failed?'0x0':'0x1',logs:[incoming,...(options.outgoing?[{...incoming,address:'0x'+'3'.repeat(40),topics:[topic,addressTopic(wallet),addressTopic(sender)],logIndex:'0x0'}]:[])]};
  if(q.method==='eth_getBlockByNumber'){const canonical=q.params[0]!=='latest';result={number:canonical?'0x5a':options.confirmationsLow?'0x64':'0x69',hash:canonical?(options.canonicalMismatch?'0x'+'d'.repeat(64):blockHash):'0x'+'c'.repeat(64),parentHash:word(0n),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16),nonce:'0x0000000000000000',difficulty:'0x0',totalDifficulty:'0x0',size:'0x1',gasLimit:'0x100000',gasUsed:'0x100',miner:sender,extraData:'0x',transactions:[],uncles:[],sha3Uncles:word(0n),transactionsRoot:word(0n),stateRoot:word(0n),receiptsRoot:word(0n),logsBloom:'0x'+'0'.repeat(512)};}
  if(q.method==='eth_call')result=q.params[0].data==='0x313ce567'?word(18n):encodeAbiParameters([{type:'string'}],[options.wrongSymbol?'FAKE':'USDT']);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 });await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw new Error();process.env.MANDATE_BSC_RPC_URL='http://127.0.0.1:'+address.port;
}
describe('public-RPC incoming receipt reader',()=>{
 it('decodes fixed-USDT transfers and preserves outgoing asset evidence',async()=>{await rpc({outgoing:true});const p=await readInflowProof(wallet,hash);expect(p.incoming).toEqual([{logIndex:1,from:sender,to:wallet,amountAtomic:'10000000000000000000'}]);expect(p.outgoingAssets).toHaveLength(1);expect(p).toMatchObject({wallet,transactionHash:hash,blockNumber:'90',headNumber:'105',token,decimals:18});});
 it('rejects failed receipts',async()=>{await rpc({failed:true});await expect(readInflowProof(wallet,hash)).rejects.toThrow('UNVERIFIED_RECEIPT');});
 it('rejects canonical block mismatches and insufficient confirmation depth',async()=>{await rpc({canonicalMismatch:true});await expect(readInflowProof(wallet,hash)).rejects.toThrow('UNVERIFIED_PAYMENT_IDENTITY');});
 it('requires twelve confirmations and the actual payment identity',async()=>{await rpc({confirmationsLow:true});await expect(readInflowProof(wallet,hash)).rejects.toThrow('CONFIRMATIONS_REQUIRED');});
 it('rejects unexpected token identity',async()=>{await rpc({wrongSymbol:true});await expect(readInflowProof(wallet,hash)).rejects.toThrow('UNVERIFIED_PAYMENT_IDENTITY');});
});
