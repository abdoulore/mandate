import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export type CostIdentity={ticker:string;platform:'ondo'|'bstock';side:'buy'|'sell';usd:number};
export type CostEvidence=CostIdentity&{
 observation:'measured'|'none';
 observedAt:string|null;
 pct:number|null;
 route:string|null;
 errorCode:string|null;
 source:{file:string;line:number;sha256:string}|null;
 executable:false;
 note:string;
};

const COST_FILE=/^cost-\d{4}-\d{2}-\d{2}\.jsonl$/;
type CostRow=Record<string,unknown>;

/** The newest exact collector attempt, including errors. An older successful
 * measurement never substitutes for a newer failed attempt. */
export function latestObservedCost(root:string,identity:CostIdentity):CostEvidence{
 const empty:CostEvidence={...identity,observation:'none',observedAt:null,pct:null,route:null,errorCode:null,source:null,executable:false,
  note:'No matching collector attempt was recorded for this exact token, issuer, side and USD size.'};
 if(!/^[A-Z0-9.-]{1,24}$/.test(identity.ticker)||!Number.isSafeInteger(identity.usd)||identity.usd<=0)return empty;
 let filenames:string[];
 try{filenames=fs.readdirSync(path.join(root,'data')).filter(name=>COST_FILE.test(name)).sort();}catch{return empty;}
 let latest:{time:number;row:CostRow;source:NonNullable<CostEvidence['source']>}|null=null;
 for(const filename of filenames){
  let content:string;
  try{content=fs.readFileSync(path.join(root,'data',filename),'utf8');}catch{continue;}
  const lines=content.split('\n');
  for(let index=0;index<lines.length;index++){
   const line=lines[index]!.replace(/\r$/,'');
   if(!line||!line.includes(`"${identity.ticker}"`))continue;
   let row:CostRow;
   try{const value:unknown=JSON.parse(line);if(!value||typeof value!=='object'||Array.isArray(value))continue;row=value as CostRow;}catch{continue;}
   if(row.tk!==identity.ticker||row.plat!==identity.platform||row.side!==identity.side||row.usd!==identity.usd||typeof row.ts!=='string')continue;
   const time=Date.parse(row.ts);
   if(!Number.isFinite(time)||latest&&time<latest.time)continue;
   latest={time,row,source:{file:`data/${filename}`,line:index+1,sha256:createHash('sha256').update(line,'utf8').digest('hex')}};
  }
 }
 if(!latest)return empty;
 const row:CostRow=latest.row;
 const observedAt=row.ts as string,source=latest.source;
 const errorCode=typeof row.err==='number'||typeof row.err==='string'?String(row.err):null;
 const pct=typeof row.pct==='number'&&Number.isFinite(row.pct)&&errorCode===null&&row.open!==false?row.pct:null;
 return {...identity,observation:pct===null?'none':'measured',observedAt,pct,
  route:typeof row.route==='string'&&row.route?row.route:null,errorCode,source,executable:false,
  note:pct===null?'The newest matching collector attempt has no measured cost. An older number is not substituted.':'Historical cost versus the quote’s token reference price; it is not a current executable fee or authorization.'};
}
