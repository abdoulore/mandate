import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BinanceReadClient,BSC_USDT,type Observation} from '@mandate/connectors';
const client=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY||'',process.env.BINANCE_WEB3_API_SECRET||'');
const dir=path.resolve('data/capabilities');fs.mkdirSync(dir,{recursive:true});
const observations:Observation[]=[];
for(const platform of ['', 'ondo','bstock']){
 const o=await client.get(platform?'/api/v1/dex/market/rwa/tokens':'/api/v1/dex/market/rwa/platforms',platform?{binanceChainId:'56',platformId:platform}:{});observations.push(o);
 if(o.code==='40304')break;await new Promise(r=>setTimeout(r,400));
}
const ondo=observations.find(o=>o.request.platformId==='ondo');
const body=ondo?.body as {data?:{list?:Record<string,unknown>[]} | Record<string,unknown>[]}|undefined;
const tokens=Array.isArray(body?.data)?body.data:body?.data?.list||[];
const token=tokens.find(t=>t.underlyingTicker==='NVDA');
if(ondo?.state==='AVAILABLE'&&token){const probe='0x'+createHash('sha256').update('pegwatch-quote-probe').digest('hex').slice(0,40);observations.push(await client.get('/api/v1/dex/aggregator/quote',{binanceChainId:'56',fromTokenAddress:BSC_USDT,toTokenAddress:String(token.tokenContractAddress),amount:'10000000000000000000',userWalletAddress:probe}));}
const checkedAt=new Date().toISOString();const name=checkedAt.replace(/[:.]/g,'-');
fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify({checkedAt,mode:'read-only',probeWallet:'unfunded research address; not the execution signer',observations},null,2));
const summary={checkedAt,executionEnabled:false,mode:'read-only',checks:observations.map(o=>{const b=o.body as {data?:unknown;success?:unknown}|null;const q=Array.isArray(b?.data)?b.data[0] as Record<string,unknown>:undefined;return {endpoint:o.endpoint,platform:o.request.platformId||null,httpStatus:o.httpStatus,code:o.code,state:o.state,latencyMs:Date.parse(o.finishedAt)-Date.parse(o.startedAt),executionMode:o.endpoint.endsWith('/quote')?q?.executionMode||'not returned':null};}),unverified:['Actual user wallet and authorization','Build and signing','Simulation entitlement','Mainnet settlement and reconciliation','Production hosting access'],note:'A returned research quote is not a filled trade. No signing, submission or broadcasting was attempted.'};
fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
