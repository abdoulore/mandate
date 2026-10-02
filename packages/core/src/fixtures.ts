import type {Instrument,MandateInput,ScenarioQuote} from '@mandate/domain';
export const instruments:Instrument[]=[
 {id:'scenario:SPY:ondo',underlying:'SPY',name:'S&P 500 exposure',issuer:'ondo',category:'Equity ETF',accounting:'Ratio-adjusted token accounting',leveraged:false,evidenceMode:'synthetic',executionCertified:false},
 {id:'scenario:SPY:bstock',underlying:'SPY',name:'S&P 500 exposure',issuer:'bstock',category:'Equity ETF',accounting:'Issuer multiplier adapter required',leveraged:false,evidenceMode:'synthetic',executionCertified:false},
 {id:'scenario:NVDA:ondo',underlying:'NVDA',name:'NVIDIA exposure',issuer:'ondo',category:'Individual stock',accounting:'Ratio-adjusted token accounting',leveraged:false,evidenceMode:'synthetic',executionCertified:false},
 {id:'scenario:NVDA:bstock',underlying:'NVDA',name:'NVIDIA exposure',issuer:'bstock',category:'Individual stock',accounting:'Issuer multiplier adapter required',leveraged:false,evidenceMode:'synthetic',executionCertified:false},
 {id:'scenario:SGOV:ondo',underlying:'SGOV',name:'Short Treasury exposure',issuer:'ondo',category:'Treasury ETF',accounting:'Ratio-adjusted token accounting',leveraged:false,evidenceMode:'synthetic',executionCertified:false},
 {id:'scenario:TQQQ:ondo',underlying:'TQQQ',name:'Leveraged Nasdaq exposure',issuer:'ondo',category:'Leveraged ETF',accounting:'Daily leveraged underlying',leveraged:true,evidenceMode:'synthetic',executionCertified:false},
];
export const defaultMandate:MandateInput={balance:'4000',reserveFloor:'1200',operatingBudget:'20',obligations:[{id:'monthly',label:'Monthly commitments',amount:'1200'}],maxIssuerBps:7000,maxCostBps:30,allowLeveraged:false,allocations:[{underlying:'SPY',weightBps:4000},{underlying:'NVDA',weightBps:3500},{underlying:'SGOV',weightBps:2500}],scenario:'normal'};
export function quotesFor(scenario:MandateInput['scenario']):ScenarioQuote[]{
 const costs=[4,15,2,6,3,5];
 return instruments.map((i,n)=>({instrumentId:i.id,costBps:scenario==='expensive'&&i.id==='scenario:NVDA:ondo'?220:costs[n],available:!(scenario==='missing'&&i.underlying==='SGOV'),reason:scenario==='missing'&&i.underlying==='SGOV'?'Source observation missing. Trading state is unknown.':undefined,evidenceMode:'synthetic'}));
}
