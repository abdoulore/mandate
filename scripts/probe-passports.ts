import fs from 'node:fs';
import {BinanceReadClient} from '../packages/connectors/src/index.ts';
import {passportDefinitions,inspectProfile} from '../apps/api/src/passports.ts';
const client=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY!,process.env.BINANCE_WEB3_API_SECRET!);
const profiles=[];
for(const p of passportDefinitions()){
 const observation=await client.get('/api/v1/dex/market/rwa/underlying-profile',{binanceChainId:'56',tokenContractAddress:p.contract});
 const profile=inspectProfile(p,observation.body,observation.state==='AVAILABLE',observation.finishedAt);profiles.push(profile);console.log(p.symbol,profile.state,profile.reason??'identity matched');
}
fs.mkdirSync('data/capabilities',{recursive:true});
fs.writeFileSync('data/capabilities/passports-latest.json',JSON.stringify({schemaVersion:'1.0',profiles},null,2)+'\n');
