import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {passportDefinitions,inspectProfile,passportCatalogue} from '../apps/api/src/passports.ts';
import {evaluatePassport} from '../packages/domain/src/passports.ts';
import {createApp} from '../apps/api/src/app.ts';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const now=Date.parse('2026-09-27T12:00:00Z');
function record(p=passportDefinitions()[0]){return inspectProfile(p,{data:{binanceChainId:'56',tokenContractAddress:p.contract,platformId:p.issuer,underlyingTicker:p.underlying,underlyingFullName:'Underlying name',assetType:p.category==='Stock'?1:3,tokenToShareRatio:'1.002'}},true,new Date(now).toISOString());}
function root(){const r=fs.mkdtempSync(path.join(os.tmpdir(),'mandate-passports-'));roots.push(r);fs.mkdirSync(path.join(r,'research/passports'),{recursive:true});fs.mkdirSync(path.join(r,'data/capabilities'),{recursive:true});fs.writeFileSync(path.join(r,'research/passports/launch.json'),JSON.stringify({schemaVersion:'1.0',profiles:passportDefinitions().map(p=>record(p))}));return r;}
it('binds the underlying profile to chain, contract, issuer, ticker and asset type',()=>{
 const p=passportDefinitions()[0];expect(record(p).state).toBe('OBSERVED');
 for(const field of ['binanceChainId','tokenContractAddress','platformId','underlyingTicker','assetType','tokenToShareRatio']){const data={binanceChainId:'56',tokenContractAddress:p.contract,platformId:p.issuer,underlyingTicker:p.underlying,underlyingFullName:'Name',assetType:1,tokenToShareRatio:'1',[field]:'wrong'};expect(inspectProfile(p,{data},true,new Date(now).toISOString()).state).toBe('UNKNOWN');}
 expect(inspectProfile(p,null,false,new Date(now).toISOString()).tokenToShareRatio).toBeNull();
});
it('uses sourced leverage and ownership facts to exclude research candidates',()=>{
 const items=passportCatalogue(root(),now).items,policy={allowLeveraged:false,requireDirectOwnership:false};
 expect(items.filter(p=>evaluatePassport(p,policy).researchEligible)).toHaveLength(12);
 expect(items.filter(p=>evaluatePassport(p,{...policy,allowLeveraged:true}).researchEligible)).toHaveLength(14);
 expect(items.filter(p=>evaluatePassport(p,{...policy,requireDirectOwnership:true}).researchEligible)).toHaveLength(0);
 expect(items.every(p=>!p.executionAllowed&&p.facts.rights.effectiveAt===null)).toBe(true);
});
it('expires observations and excludes stale or missing profiles',()=>{const r=root(),stale=passportCatalogue(r,now+86400001);expect(stale.items.every(p=>p.profile.state==='STALE')).toBe(true);expect(evaluatePassport(stale.items[0],{allowLeveraged:true,requireDirectOwnership:false}).researchEligible).toBe(false);expect(passportCatalogue('missing-root',now).items.every(p=>p.profile.state==='UNKNOWN')).toBe(true);});
it('does not fall back to healthy recorded data when the latest refresh is failed or corrupt',()=>{const r=root(),runtime=path.join(r,'data/capabilities/passports-latest.json');fs.writeFileSync(runtime,'broken');expect(passportCatalogue(r,now).items.every(p=>p.profile.state==='UNKNOWN')).toBe(true);const row=record();fs.writeFileSync(runtime,JSON.stringify({schemaVersion:'1.0',profiles:[{...row,state:'UNKNOWN',underlyingName:null,tokenToShareRatio:null,reason:'PROFILE_UNAVAILABLE'}]}));expect(passportCatalogue(r,now).items[0].profile).toMatchObject({state:'UNKNOWN',tokenToShareRatio:null});fs.writeFileSync(runtime,JSON.stringify({schemaVersion:'1.0',profiles:[{...row,contract:'0xwrong'},null]}));expect(passportCatalogue(r,now).items[0].profile.state).toBe('UNKNOWN');});
it('exposes research eligibility only and rejects invalid policy input',async()=>{const app=createApp(root());try{const result=await app.inject({method:'POST',url:'/v1/instruments/eligibility',payload:{allowLeveraged:true,requireDirectOwnership:true}});expect(result.json().items.every((r:{researchEligible:boolean;executionAllowed:boolean})=>!r.researchEligible&&!r.executionAllowed)).toBe(true);expect((await app.inject({method:'POST',url:'/v1/instruments/eligibility',payload:{allowLeveraged:'true'}})).statusCode).toBe(400);}finally{await app.close();}});
