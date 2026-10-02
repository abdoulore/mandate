import {createHmac} from 'node:crypto';
export const BSC_USDT='0x55d398326f99059fF775485246999027B3197955';
// Only signed GETs that inspect catalogue data or construct unsigned route data.
const allowedPaths=new Set(['/api/v1/dex/market/rwa/platforms','/api/v1/dex/market/rwa/tokens','/api/v1/dex/market/rwa/underlying-profile','/api/v1/dex/market/rwa/price','/api/v1/dex/aggregator/quote','/api/v1/dex/aggregator/swap']);
export function signGet(secret:string,timestamp:string,requestPath:string){return createHmac('sha256',secret).update(timestamp+'GET'+requestPath).digest('base64');}
export type Observation={schemaVersion:'2.0';endpoint:string;request:Record<string,string>;startedAt:string;finishedAt:string;httpStatus:number;state:'AVAILABLE'|'UNKNOWN_DATA';code:string;body:unknown};
export class BinanceReadClient {
 constructor(private readonly key:string,private readonly secret:string) {if(!key||!secret)throw new Error('Binance API credentials are not configured.');}
 async get(endpoint:string,params:Record<string,string>={}):Promise<Observation>{
  if(!allowedPaths.has(endpoint))throw new Error('Endpoint is outside this read-only connector.');
  const query=new URLSearchParams(params).toString();const path='/build'+endpoint+(query?'?'+query:'');const startedAt=new Date().toISOString();
  try{
   const r=await fetch('https://web3.binance.com'+path,{headers:{'X-OC-APIKEY':this.key,'X-OC-TIMESTAMP':startedAt,'X-OC-SIGN':signGet(this.secret,startedAt,path),Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   const body:unknown=await r.json();const b=body as Record<string,unknown>;
   const ok=r.ok&&(b.success===true||String(b.code)==='0'||String(b.code)==='000000');
   return {schemaVersion:'2.0',endpoint,request:params,startedAt,finishedAt:new Date().toISOString(),httpStatus:r.status,state:ok?'AVAILABLE':'UNKNOWN_DATA',code:String(b.code??'UNKNOWN'),body};
  }catch(e){return {schemaVersion:'2.0',endpoint,request:params,startedAt,finishedAt:new Date().toISOString(),httpStatus:0,state:'UNKNOWN_DATA',code:e instanceof SyntaxError?'PARSE_ERROR':'TRANSPORT_ERROR',body:null};}
 }
}
export {AAOIB,MULTIPLIER_SCALE,uiAmount,bindQuote,inspectBuild,costIdentityForAAOIBRoute,type RouteIntent,type BoundQuote} from './route-proof.ts';
