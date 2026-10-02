import fs from 'node:fs';
import path from 'node:path';
import type {InstrumentPassport,PassportCatalogue,PassportFact} from '@mandate/domain';
export const PROFILE_SOURCE='https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data';
const ONDO='https://docs.ondo.finance/ondo-stocks/overview';
const BSTOCK='https://www.binance.com/en-NG/support/faq/detail/f0c03cd6509a4085b4cce1636f16be38';
const checkedAt='2026-09-27';
const fact=(value:string,source:string,scope:PassportFact['scope']='issuer-program'):PassportFact=>({value,source,scope,checkedAt,effectiveAt:null});
const definitions=[
 ['MSFTon','MSFT','ondo','0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3'],['AAOIon','AAOI','ondo','0x149bda9e7251dc36f536d1fe7f92a5ea203f4f3d'],['TQQQon','TQQQ','ondo','0xe42cfb20e00912409b77a602b5bdcff3c7acc5f4'],['QQQon','QQQ','ondo','0x0cde6936d305d5b34667fc46425e852efd73559a'],['SPYon','SPY','ondo','0x6a708ead771238919d85930b5a0f10454e1c331a'],['AAPLon','AAPL','ondo','0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4'],['NVDAon','NVDA','ondo','0xa9ee28c80f960b889dfbd1902055218cba016f75'],['SGOVon','SGOV','ondo','0xc008c5f579ec1450f20099c39f587547e27c7523'],
 ['MSFTB','MSFT','bstock','0x80106cb3ead06659a5ad19df39d9b4733863b9b0'],['AAOIB','AAOI','bstock','0x10343ef7da3301493d7ecb647d68a288c6c1db2f'],['TQQQB','TQQQ','bstock','0x462b5f13b7c7748279358962925c5de83bb9e598'],['QQQB','QQQ','bstock','0x205812cdbed920aff76c6580abd681a46d11efc7'],['SPYB','SPY','bstock','0x7138b48df7d98d7e3cc221bfe7192d0a178182d8'],['NVDAB','NVDA','bstock','0x02fca66c1d1afb4e2a7884261eb00f63598a7436'],
] as const;
export function passportDefinitions():InstrumentPassport[]{return definitions.map(([symbol,underlying,issuer,contract])=>{
 const source=issuer==='ondo'?ONDO:BSTOCK;
 const leverageSource=underlying==='TQQQ'?'https://prod.proshares.com/our-etfs/leveraged-and-inverse/tqqq':underlying==='SPY'?'https://www.ssga.com/us/en/institutional/etfs/state-street-spdr-sp-500-etf-trust-spy':underlying==='QQQ'?'https://www.invesco.com/qqq-etf/en/about.html':underlying==='SGOV'?'https://www.ishares.com/us/products/314116/ishares-0-3-month':PROFILE_SOURCE;
 const category=underlying==='TQQQ'?'Leveraged ETF':underlying==='SGOV'?'Treasury ETF':['SPY','QQQ'].includes(underlying)?'Equity ETF':'Stock';
 return {symbol,underlying,issuer,contract,chainId:56,category,leveraged:underlying==='TQQQ',leverageSource,directOwnership:false,
 facts:{issuer:fact(issuer==='ondo'?'Ondo Global Markets (BVI) Limited':'BTech Holdings Limited (ADGM)',source),
 exposure:fact(underlying==='TQQQ'?'Targets 3× the daily Nasdaq-100 return before fees; longer-period returns can differ.':underlying==='SGOV'?'Exposure to a 0–3 month US Treasury bill ETF; not cash or a stablecoin.':underlying==='SPY'?'ETF tracking the S&P 500 before expenses.':underlying==='QQQ'?'ETF tracking the Nasdaq-100.':'Tokenized economic exposure; not direct share ownership.',category==='Stock'?source:leverageSource,category==='Stock'?'issuer-program':'underlying'),
 accounting:fact(issuer==='ondo'?'Total-return exposure with net dividends reinvested. BNB Chain display multipliers can change displayed balances without changing raw token balances.':'Raw ERC-20 units and multiplier-adjusted display units differ. Net dividend reinvestment can change the multiplier.',source),
 rights:fact(issuer==='ondo'?'Offering documents govern rights. Tokens are not underlying shares; instrument-specific voting, redemption and collateral claims need review.':'No direct shareholder voting or cash-dividend rights. Offering documents govern token claims.',issuer==='ondo'?'https://app.ondo.finance/':source),
 access:fact(issuer==='ondo'?'Jurisdiction restrictions and issuer onboarding apply. Connected-wallet eligibility has not been established.':'Jurisdiction and integrator restrictions apply. Connected-wallet eligibility has not been established.',issuer==='ondo'?'https://docs.ondo.finance/ondo-stocks/eligibility':source)},
 unknowns:['Instrument offering-document version and effective date','Connected-wallet jurisdiction, KYC and redemption access','Current contract display multiplier and pending corporate-action effective date','Reviewed current collateral report and enforceability of claims','Trading route meaning, simulation and transaction authorization'],
 profile:{state:'UNKNOWN',observedAt:null,underlyingName:null,tokenToShareRatio:null,reason:'PROFILE_NOT_REFRESHED'},executionAllowed:false};
});}
export type ProfileRecord={symbol:string;contract:string;issuer:string;underlying:string;chainId:56;observedAt:string;state:'OBSERVED'|'UNKNOWN';underlyingName:string|null;tokenToShareRatio:string|null;assetType:number|null;reason:string|null};
export function inspectProfile(p:InstrumentPassport,body:unknown,available:boolean,observedAt:string):ProfileRecord{
 const d=(body as {data?:Record<string,unknown>}|null)?.data;
 const valid=available&&d&&String(d.binanceChainId)==='56'&&String(d.tokenContractAddress).toLowerCase()===p.contract&&d.platformId===p.issuer&&d.underlyingTicker===p.underlying&&d.assetType===(p.category==='Stock'?1:3)&&typeof d.underlyingFullName==='string'&&typeof d.tokenToShareRatio==='string'&&/^\d+(\.\d+)?$/.test(d.tokenToShareRatio)&&Number(d.tokenToShareRatio)>0;
 return {symbol:p.symbol,contract:p.contract,issuer:p.issuer,underlying:p.underlying,chainId:56,observedAt,state:valid?'OBSERVED':'UNKNOWN',underlyingName:valid?d.underlyingFullName as string:null,tokenToShareRatio:valid?d.tokenToShareRatio as string:null,assetType:valid&&typeof d.assetType==='number'?d.assetType:null,reason:valid?null:available?'PROFILE_IDENTITY_OR_FIELDS_INVALID':'PROFILE_UNAVAILABLE'};
}
export function passportCatalogue(root:string,now=Date.now()):PassportCatalogue{
 let rows:ProfileRecord[]=[];
 const runtime=path.join(root,'data/capabilities/passports-latest.json'),recorded=path.join(root,'research/passports/launch.json');
 try{const data=JSON.parse(fs.readFileSync(fs.existsSync(runtime)?runtime:recorded,'utf8'));if(data.schemaVersion==='1.0'&&Array.isArray(data.profiles))rows=data.profiles.filter((r:unknown)=>r&&typeof r==='object');}catch{/* Unreadable refresh never falls back to a healthy observation. */}
 const items=passportDefinitions().map(p=>{const matches=rows.filter(r=>r.symbol===p.symbol);if(matches.length!==1)return p;const row=matches[0];const age=now-Date.parse(row.observedAt);const fresh=Number.isFinite(age)&&age>=0&&age<=86400000;const valid=row.state==='OBSERVED'&&row.contract===p.contract&&row.issuer===p.issuer&&row.underlying===p.underlying&&row.chainId===56&&row.assetType===(p.category==='Stock'?1:3)&&typeof row.underlyingName==='string'&&typeof row.tokenToShareRatio==='string'&&/^\d+(\.\d+)?$/.test(row.tokenToShareRatio)&&Number(row.tokenToShareRatio)>0;
 p.profile={state:valid?(fresh?'OBSERVED':'STALE'):'UNKNOWN',observedAt:row.observedAt,underlyingName:valid?row.underlyingName:null,tokenToShareRatio:valid?row.tokenToShareRatio:null,reason:valid?(fresh?null:'PROFILE_OVER_24_HOURS_OLD'):row.reason??'INVALID_RECORDED_PROFILE'};
 // An API ETF label does not establish whether an ETF is leveraged.
 return p;});
 return {schemaVersion:'1.0',checkedAt:new Date(now).toISOString(),items};
}
