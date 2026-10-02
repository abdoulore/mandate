import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {passportDefinitions} from '../apps/api/src/passports.ts';

// These API tests model a freshly observed market. Keep their synthetic profile
// evidence independent of the production snapshot's 24-hour expiry.
export function freshPassportRoot(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mandate-test-passports-'));
 const file=path.join(root,'data','capabilities','passports-latest.json');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const observedAt=new Date().toISOString();
 fs.writeFileSync(file,JSON.stringify({schemaVersion:'1.0',profiles:passportDefinitions().map(p=>({
  symbol:p.symbol,contract:p.contract,issuer:p.issuer,underlying:p.underlying,chainId:56,
  observedAt,state:'OBSERVED',underlyingName:`${p.underlying} synthetic test profile`,
  tokenToShareRatio:'1',assetType:p.category==='Stock'?1:3,reason:null
 }))}));
 return root;
}
