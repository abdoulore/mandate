import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readWalletReadiness} from '../apps/api/src/wallet-readiness.ts';

// Deterministic, unfunded address for public-RPC verification; no wallet key exists here.
const owner='0x'+createHash('sha256').update('pegwatch-aaoib-quote-research-only').digest('hex').slice(0,40);
const report=await readWalletReadiness({owner,spender:'0xb44446b0c8e56988c34f7ff73ae904982b5fdda5',router:'0xb44446b0c8e56988c34f7ff73ae904982b5fdda5',selector:'0xad43f73d',requiredAtomic:'10000000000000000000'});
const result={...report,wallet:'unfunded deterministic research address, not the connected user wallet',spenderCandidate:'observed router candidate',router:'observed router candidate'};
const dir=path.resolve('data/capabilities');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'wallet-readiness-latest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
