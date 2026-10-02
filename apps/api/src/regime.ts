import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {createHash} from 'node:crypto';

export type RegimeSource = {file:string;line:number;sha256:string};
export type RegimePoint = {ts:string;pct:number|null;err?:string;route?:string;venueCount?:number;source:RegimeSource;broken:boolean|null};
export type SweepObservation = {ts:string;pct:number|null;err?:string;venueCount?:number;source:RegimeSource;broken:boolean|null};
export type RegimeWindow = {ts:string;openCount:number;totalCount:number;source:RegimeSource};
type Row = Record<string,unknown>;
type SourceRow = {row:Row;source:RegimeSource};

const COST_FILE = /^cost-2026-09-(?:20|21|22|23|24|25)\.jsonl$/;
const UNIVERSE_FILE = /^universe-2026-09-(?:20|21|22|23|24|25)\.jsonl$/;
const SWEEP_FILE = 'sweep-all-2026-09-21T13-28.jsonl';

async function* rows(root:string,file:string):AsyncGenerator<SourceRow>{
 const full=path.join(root,'data',file);
 const input=fs.createReadStream(full,{encoding:'utf8'});
 const reader=readline.createInterface({input,crlfDelay:Infinity});
 let lineNumber=0;
 try{
  for await(const line of reader){
   lineNumber++;
   if(!line.trim())continue;
   try{
    const value:unknown=JSON.parse(line);
    if(value&&typeof value==='object'&&!Array.isArray(value))yield {
     row:value as Row,
     source:{file:`data/${file}`,line:lineNumber,sha256:createHash('sha256').update(line,'utf8').digest('hex')},
    };
   }catch{/* An incomplete append or malformed row is not an observation. */}
  }
 }finally{reader.close();input.destroy();}
}

function files(root:string,pattern:RegExp){
 try{return fs.readdirSync(path.join(root,'data')).filter(file=>pattern.test(file)).sort();}
 catch{return [] as string[];}
}

function timestamp(row:Row):row is Row&{ts:string}{return typeof row.ts==='string'&&Number.isFinite(Date.parse(row.ts));}
function tokenPlatform(row:Row):row is Row&{tk:string;plat:string}{return typeof row.tk==='string'&&typeof row.plat==='string'&&/^[A-Z0-9.-]{1,24}$/.test(row.tk)&&/^(ondo|bstock)$/.test(row.plat);}
function pct(row:Row){return typeof row.pct==='number'&&Number.isFinite(row.pct)?row.pct:null;}
function err(row:Row){return typeof row.err==='number'||typeof row.err==='string'?String(row.err):undefined;}
function costPoint({row,source}:SourceRow):RegimePoint{
 const value=pct(row),route=typeof row.route==='string'&&row.route.length?row.route:undefined;
 return {ts:row.ts as string,pct:value,...(err(row)===undefined?{}:{err:err(row)}),
  ...(route===undefined?{}:{route,venueCount:route.split('|').filter(Boolean).length}),source,broken:value===null?null:value>1};
}
function sweepPoint({row,source}:SourceRow):SweepObservation{
 const value=pct(row),count=typeof row.venues==='number'&&Number.isInteger(row.venues)&&row.venues>=0?row.venues:undefined;
 return {ts:row.ts as string,pct:value,...(err(row)===undefined?{}:{err:err(row)}),
  ...(count===undefined?{}:{venueCount:count}),source,broken:value===null?null:value>1};
}
type Cycle={ts:string;openCount:number;totalCount:number;ondoCount:number;ondoOpen:number;pausedCount:number;first:RegimeSource;pausedSource?:RegimeSource};
function cycleTime(ts:string){return new Date(Math.floor(Date.parse(ts)/(15*60_000))*(15*60_000)).toISOString();}
type RegimeIndex={points:Map<string,RegimePoint[]>;sweeps:Map<string,SweepObservation[]>;outages:RegimeWindow[];coverageGaps:RegimeWindow[];availableTokens:{token:string;platform:string}[]};
const indexCache=new Map<string,{signature:string;promise:Promise<RegimeIndex>}>();
function sourceFiles(root:string){return [...files(root,COST_FILE),...files(root,UNIVERSE_FILE),...(fs.existsSync(path.join(root,'data',SWEEP_FILE))?[SWEEP_FILE]:[])];}
function fileSignature(root:string,names:string[]){return names.map(name=>{const stat=fs.statSync(path.join(root,'data',name));return `${name}:${stat.size}:${stat.mtimeMs}`;}).join('|');}
function add<K,V>(map:Map<K,V[]>,key:K,value:V){const values=map.get(key)??[];values.push(value);map.set(key,values);}

async function buildIndex(root:string,costFiles:string[],universeFiles:string[],sweepPresent:boolean):Promise<RegimeIndex>{
 const points=new Map<string,RegimePoint[]>(),sweeps=new Map<string,SweepObservation[]>();
 const available=new Set<string>();
 for(const file of costFiles)for await(const observation of rows(root,file)){
  const {row}=observation;
  if(!timestamp(row)||!tokenPlatform(row)||row.side!=='buy'||row.usd!==10000)continue;
  const key=`${row.tk}/${row.plat}`;available.add(key);add(points,key,costPoint(observation));
 }
 if(sweepPresent)for await(const observation of rows(root,SWEEP_FILE)){
  const {row}=observation;
  if(!timestamp(row)||!tokenPlatform(row))continue;
  const key=`${row.tk}/${row.plat}`;available.add(key);add(sweeps,key,sweepPoint(observation));
 }
 const cycles=new Map<string,Cycle>();
 for(const file of universeFiles)for await(const {row,source} of rows(root,file)){
  if(!timestamp(row)||!tokenPlatform(row)||typeof row.open!=='boolean')continue;
  const ts=cycleTime(row.ts),key=`${file}:${ts}`;
  let cycle=cycles.get(key);
  if(!cycle){cycle={ts,openCount:0,totalCount:0,ondoCount:0,ondoOpen:0,pausedCount:0,first:source};cycles.set(key,cycle);}
  cycle.totalCount++;
  if(row.open)cycle.openCount++;
  if(row.plat==='ondo'){
   cycle.ondoCount++;
   if(row.open)cycle.ondoOpen++;
   if(row.open===false&&row.reason==='MARKET_PAUSED'){
    cycle.pausedCount++;
    cycle.pausedSource??=source;
   }
  }
 }
 const outages:RegimeWindow[]=[],coverageGaps:RegimeWindow[]=[];
 for(const cycle of cycles.values()){
  // A missing issuer is a coverage gap, never a market halt. A pause needs
  // a near-complete Ondo frame and explicit paused status on most rows.
  if(cycle.totalCount>=40&&cycle.ondoCount===0)coverageGaps.push({ts:cycle.ts,openCount:cycle.openCount,totalCount:cycle.totalCount,source:cycle.first});
  if(cycle.ondoCount>=400&&cycle.ondoOpen===0&&cycle.pausedCount/cycle.ondoCount>=.9)outages.push({ts:cycle.ts,openCount:cycle.openCount,totalCount:cycle.totalCount,source:cycle.pausedSource??cycle.first});
 }
 for(const series of points.values())series.sort((a,b)=>a.ts.localeCompare(b.ts));
 for(const series of sweeps.values())series.sort((a,b)=>a.ts.localeCompare(b.ts));
 outages.sort((a,b)=>a.ts.localeCompare(b.ts));
 coverageGaps.sort((a,b)=>a.ts.localeCompare(b.ts));
 const availableTokens=[...available].sort().map(key=>{const [tk,plat]=key.split('/');return {token:tk!,platform:plat!};});
 return {points,sweeps,outages,coverageGaps,availableTokens};
}

/** Historical collector evidence only. No row is a current executable quote. */
export async function readRegime(root:string,token:string,platform:'ondo'|'bstock'){
 const costFiles=files(root,COST_FILE),universeFiles=files(root,UNIVERSE_FILE),names=sourceFiles(root);
 const signature=fileSignature(root,names);
 let cached=indexCache.get(root);
 if(!cached||cached.signature!==signature){
  const promise=buildIndex(root,costFiles,universeFiles,names.includes(SWEEP_FILE));
  cached={signature,promise};indexCache.set(root,cached);
  if(indexCache.size>4)indexCache.delete(indexCache.keys().next().value!);
 }
 const index=await cached.promise;
 const key=`${token}/${platform}`,points=index.points.get(key)??[],sweepObservations=index.sweeps.get(key)??[];
 const observed=points.filter(point=>point.broken!==null);
 const brokenCount=observed.filter(point=>point.broken).length;
 const flips:{ts:string;from:'broken'|'healthy';to:'broken'|'healthy'}[]=[];
 for(let index=1;index<points.length;index++){
  const previous=points[index-1]!,point=points[index]!;
  const elapsed=Date.parse(point.ts)-Date.parse(previous.ts);
  if(previous.broken===null||point.broken===null||elapsed<0||elapsed>30*60_000)continue;
  if(previous.broken!==point.broken)flips.push({ts:point.ts,from:previous.broken?'broken':'healthy',to:point.broken?'broken':'healthy'});
 }
 const {availableTokens}=index;
 return {token,platform,side:'buy' as const,usd:10000 as const,points,flips,brokenCount,observedCount:observed.length,
  brokenPercent:observed.length?100*brokenCount/observed.length:null,
  windowStart:points[0]?.ts??null,windowEnd:points.at(-1)?.ts??null,
  outages:platform==='ondo'?index.outages:[],coverageGaps:platform==='ondo'?index.coverageGaps:[],sweepObservations,availableTokens};
}
