import {BinanceReadClient} from '@mandate/connectors';
import {assessPortfolio} from '@mandate/core';
import {evaluatePassport,type CapitalView,type MarketMarks,type Instrument,type ScenarioQuote,type MandateInput} from '@mandate/domain';
import {passportDefinitions,passportCatalogue} from './passports.ts';
export const MARKET_SOURCE='https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data';
export async function readPortfolioMarks():Promise<MarketMarks>{
 const result:MarketMarks={observedAt:new Date().toISOString(),items:[],source:MARKET_SOURCE};
 if(!process.env.BINANCE_WEB3_API_KEY||!process.env.BINANCE_WEB3_API_SECRET)return result;
 const defs=passportDefinitions(),client=new BinanceReadClient(process.env.BINANCE_WEB3_API_KEY,process.env.BINANCE_WEB3_API_SECRET);
 const o=await client.get('/api/v1/dex/market/rwa/price',{binanceChainId:'56',tokenContractAddresses:defs.map(p=>p.contract).join(',')});result.observedAt=o.finishedAt;
 const data=(o.body as {data?:unknown}|null)?.data;if(o.state!=='AVAILABLE'||!Array.isArray(data))return result;
 for(const d of data){const p=defs.find(p=>p.contract===String(d.tokenContractAddress).toLowerCase()&&p.issuer===d.platformId);if(p&&String(d.binanceChainId)==='56'&&typeof d.tokenPrice==='string'&&Number.isSafeInteger(d.tokenPriceUpdatedAt)&&d.tokenPriceUpdatedAt>0)result.items.push({contract:p.contract,issuer:p.issuer,price:d.tokenPrice,updatedAt:new Date(d.tokenPriceUpdatedAt).toISOString()});}
 return result;
}
export function withPortfolio(capital:CapitalView,marks:MarketMarks):CapitalView{return {...capital,marketEvidence:marks,portfolio:assessPortfolio(capital.checkpoint,passportDefinitions(),marks,capital.pending??[])};}
export function researchCandidates(root:string,input:MandateInput){
 const passports=passportCatalogue(root);
 const candidates:Instrument[]=passports.items.map(p=>({id:p.contract,contract:p.contract,underlying:p.underlying,name:p.symbol,issuer:p.issuer,category:p.category,accounting:p.facts.accounting.value,leveraged:p.leveraged!==false,evidenceMode:'research',executionCertified:false,researchEligible:evaluatePassport(p,{allowLeveraged:input.allowLeveraged,requireDirectOwnership:false}).researchEligible}));
 const quotes:ScenarioQuote[]=candidates.map(i=>({instrumentId:i.id,costBps:input.scenario==='expensive'&&i.underlying==='NVDA'&&i.issuer==='ondo'?220:i.issuer==='ondo'?4:15,available:!(input.scenario==='missing'&&i.underlying==='SGOV'),evidenceMode:'synthetic',reason:input.scenario==='missing'&&i.underlying==='SGOV'?'Treasury scenario quote is unavailable':undefined}));
 return {candidates,quotes,passports};
}
