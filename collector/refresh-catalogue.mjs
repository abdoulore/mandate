/** Two-call, read-only RWA catalogue refresh for a persistent public deployment. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {get} from './api.mjs';
import {CollectorBudget} from './budget.mjs';

const platforms=['ondo','bstock'];

export function catalogueRows(responses,capturedAt){
  if(responses.length!==platforms.length||!Number.isFinite(Date.parse(capturedAt)))throw new Error('CATALOGUE_FRAME_INVALID');
  const rows=[];
  for(let i=0;i<platforms.length;i++){
    const platform=platforms[i],response=responses[i];
    if(response?.success!==true||response?.http===429)throw new Error('CATALOGUE_SOURCE_UNAVAILABLE');
    const tokens=response?.data?.list??response?.data;
    if(!Array.isArray(tokens)||tokens.length<10)throw new Error('CATALOGUE_SOURCE_INCOMPLETE');
    for(const token of tokens){
      if(!/^0x[0-9a-f]{40}$/i.test(token.tokenContractAddress||'')||
         (token.platformId&&token.platformId!==platform)||!token.tokenSymbol||!token.underlyingTicker)throw new Error('CATALOGUE_TOKEN_INVALID');
      rows.push({ts:capturedAt,tk:token.underlyingTicker,sym:token.tokenSymbol,plat:platform,
        addr:token.tokenContractAddress,type:token.assetType,px:token.tokenPrice,ref:token.referencePrice,
        ratio:token.tokenToShareRatio,open:token.statusInfo?.openState,status:token.statusInfo?.marketStatus,
        reason:token.statusInfo?.reasonCode,nextOpen:token.statusInfo?.nextOpenTime,
        vol24h:token.volume24H,mcap:token.marketCap});
    }
  }
  return rows;
}

export async function refreshCatalogue({root=process.cwd(),key=process.env.BINANCE_WEB3_API_KEY,
  secret=process.env.BINANCE_WEB3_API_SECRET,getImpl=get,now=()=>new Date()}={}){
  if(!key||!secret)throw new Error('COLLECTOR_CREDENTIALS_MISSING');
  const budget=new CollectorBudget(2),responses=[];
  for(const platformId of platforms){
    responses.push(await getImpl('/api/v1/dex/market/rwa/tokens',
      {binanceChainId:'56',platformId},{budget,retries:0}));
  }
  const capturedAt=now().toISOString();
  const rows=catalogueRows(responses,capturedAt);
  const directory=path.join(root,'data','live');
  await fs.mkdir(directory,{recursive:true});
  const destination=path.join(directory,'catalogue.jsonl');
  const temporary=path.join(directory,`catalogue-${process.pid}-${randomUUID()}.tmp`);
  try{
    await fs.writeFile(temporary,rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx',mode:0o600});
    await fs.rename(temporary,destination);
  }finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
  return {capturedAt,platforms,tokenCount:rows.length,requests:budget.used,executionEnabled:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
  if(!args.includes('--run')){
    console.log('Dry run. To refresh the read-only catalogue: --run --max-requests 2 --interval-min 15');
  }else{
    const max=Number(option('--max-requests')),interval=Number(option('--interval-min'));
    if(max!==2||!Number.isInteger(interval)||interval<5||interval>60)throw new Error('COLLECTOR_SCHEDULE_INVALID');
    for(;;){
      try{console.log(JSON.stringify(await refreshCatalogue()));}
      catch(error){console.error(`Catalogue refresh failed: ${error instanceof Error?error.message:'UNKNOWN'}`);if(args.includes('--once'))process.exitCode=1;}
      if(args.includes('--once'))break;
      await new Promise(resolve=>setTimeout(resolve,interval*60_000));
    }
  }
}
