import {describe,it,expect} from 'vitest';
import {defaultMandate,instruments,quotesFor,previewInvestment,parseUnits,allocate,transitionAttempt,previewWithdrawal} from '@mandate/core';
import {createApp} from '../../apps/api/src/app';
import {summarizeWalletReadiness,type ReadinessInput} from '../../apps/api/src/wallet-readiness';
import {BinanceReadClient,signGet,BSC_USDT,AAOIB,bindQuote,inspectBuild,costIdentityForAAOIBRoute,uiAmount,type Observation,type RouteIntent} from '@mandate/connectors';
import {privateKeyToAccount} from 'viem/accounts';
const preview=(overrides:Record<string,unknown>={})=>previewInvestment({...defaultMandate,...overrides},instruments,quotesFor((overrides.scenario as 'normal')||'normal'),new Date('2026-09-22T00:00:00Z'));
describe('Money and policy invariants',()=>{
 it('keeps the reserve once and preserves every unit',()=>{const p=preview();expect(p.status).toBe('feasible');expect(p.reserveAtomic).toBe('1200000000');expect(p.investableAtomic).toBe('2780000000');expect(p.legs.reduce((n,l)=>n+BigInt(l.grossAtomic),0n)+BigInt(p.reserveAtomic)+BigInt(p.operatingAtomic)).toBe(4000000000n);});
 it('chooses the cheaper permitted 65/35 issuer mix',()=>{const p=preview();expect(p.legs.find(l=>l.underlying==='NVDA')?.issuer).toBe('bstock');expect(p.issuerExposure.every(i=>i.shareBps<=7000)).toBe(true);});
 it('changes investable funds for a new obligation',()=>{const p=preview({obligations:[...defaultMandate.obligations,{id:'new',label:'New expense',amount:'400'}]});expect(p.reserveAtomic).toBe('1600000000');expect(p.investableAtomic).toBe('2380000000');});
 it('rejects an impossible issuer limit without relaxing it',()=>{const p=preview({maxIssuerBps:4000});expect(p.status).toBe('infeasible');expect(p.legs).toHaveLength(0);});
 it('keeps unavailable data distinct from a market closure',()=>{const p=preview({scenario:'missing'});expect(p.status).toBe('infeasible');expect(p.excluded.some(x=>x.reason.includes('unknown'))).toBe(true);});
 it('rejects the poor quote and chooses an allowed alternative',()=>{const p=preview({scenario:'expensive'});expect(p.status).toBe('feasible');expect(p.excluded.some(x=>x.instrumentId==='scenario:NVDA:ondo')).toBe(true);});
 it('excludes leveraged exposure',()=>{expect(preview({allocations:[{underlying:'TQQQ',weightBps:10000}],maxIssuerBps:10000}).status).toBe('infeasible');});
 it('rejects overlapping obligation IDs',()=>{expect(()=>preview({obligations:[defaultMandate.obligations[0],defaultMandate.obligations[0]]})).toThrow();});
 it('does not invest a reserve shortfall',()=>{expect(preview({balance:'500'}).status).toBe('infeasible');});
 it('allocates small amounts without inventing units',()=>{for(let n=0n;n<150n;n++){const a=allocate(n,[3333,3333,3334]);expect(a.reduce((s,v)=>s+v,0n)).toBe(n);}});
 it('does not round through floating point',()=>{expect(parseUnits('9007199254740993.123456',6)).toBe(9007199254740993123456n);expect(()=>parseUnits('0.0000001',6)).toThrow();});
 it('is deterministic for identical evidence',()=>{expect(preview()).toEqual(preview());expect(preview().executable).toBe(false);});
 it('does not resubmit an unknown attempt',()=>{expect(()=>transitionAttempt('unknown','submitting')).toThrow();expect(transitionAttempt('unknown','settling')).toBe('settling');});
 it('keeps pending cancellation reconcilable',()=>{expect(transitionAttempt('cancellation_requested','reconciled')).toBe('reconciled');expect(()=>transitionAttempt('reconciled','submitting')).toThrow();});
 it('shows withdrawal shortfall without valuing unavailable positions as proceeds',()=>{const p=previewWithdrawal('400','0',[{id:'closed',maxNet:'1000',available:false},{id:'open',maxNet:'150',available:true}]);expect(p.coveredAtomic).toBe('150000000');expect(p.shortfallAtomic).toBe('250000000');});
});
describe('Application boundary',()=>{
 it('runs the same planner through the API',async()=>{const app=createApp();try{const r=await app.inject({method:'POST',url:'/v1/plans/preview',payload:defaultMandate});expect(r.statusCode).toBe(200);expect(r.json().decisionId).toBe(preview().decisionId);expect(r.json().executable).toBe(false);}finally{await app.close();}});
 it('rejects malformed money at the boundary',async()=>{const app=createApp();try{const r=await app.inject({method:'POST',url:'/v1/plans/preview',payload:{...defaultMandate,balance:'NaN'}});expect(r.statusCode).toBe(400);}finally{await app.close();}});
 it('exposes no execution endpoint',async()=>{const app=createApp();try{const r=await app.inject({method:'POST',url:'/v1/plans/execute',payload:{}});expect(r.statusCode).toBe(404);}finally{await app.close();}});
 it('binds signature to exact build path',()=>{expect(signGet('test','2026-09-22T00:00:00Z','/build/a?x=1')).not.toBe(signGet('test','2026-09-22T00:00:00Z','/a?x=1'));});
 it('cannot use the read connector for submission',async()=>{await expect(new BinanceReadClient('test','test').get('/api/v1/dex/aggregator/order/submit')).rejects.toThrow('read-only');});
 it('requires a wallet session before requesting a wallet-bound research route',async()=>{const app=createApp();try{const r=await app.inject({method:'POST',url:'/v1/routes/AAOIB/research',payload:{amount:'10'}});expect(r.statusCode).toBe(401);expect(r.json().error).toBe('WALLET_SESSION_REQUIRED');}finally{await app.close();}});
 it('keeps direct-pool preflight read-only and bound to the signed wallet',async()=>{
  const account=privateKeyToAccount('0x'+'22'.repeat(32) as `0x${string}`),origin='http://127.0.0.1:3110',seen:Array<{owner:string;buyAmountAtomic?:string}>=[];
  const app=createApp(process.cwd(),{directReader:async(owner,_direction,_sellAmountAtomic,buyAmountAtomic)=>{seen.push({owner,buyAmountAtomic});return {state:'READ_ONLY_CHECK' as const,executionEnabled:false,owner,gates:{authorization:'NOT_REQUESTED' as const},note:'No transaction prepared.'};}});
  try{
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/preflight',headers:{origin},payload:{direction:'BUY'}})).statusCode).toBe(401);
   const challenge=(await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:account.address,chainId:56}})).json();
   const signature=await account.signMessage({message:challenge.message});
   const verified=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:challenge.id,signature}});
   const cookie=String(verified.headers['set-cookie']).split(';')[0];
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/preflight',headers:{origin,cookie},payload:{direction:'BUY',sellAmountAtomic:'1'}})).statusCode).toBe(400);
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/preflight',headers:{origin,cookie},payload:{direction:'BUY',buyAmountAtomic:'10000000000000000001'}})).statusCode).toBe(400);
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/preflight',headers:{origin,cookie},payload:{direction:'SELL',sellAmountAtomic:'1',buyAmountAtomic:'1'}})).statusCode).toBe(400);
   const result=await app.inject({method:'POST',url:'/v1/routes/SPYon/preflight',headers:{origin,cookie},payload:{direction:'BUY',buyAmountAtomic:'1000000000000000000'}});
   expect(result.json()).toMatchObject({state:'READ_ONLY_CHECK',executionEnabled:false,owner:account.address.toLowerCase()});
   expect(JSON.stringify(result.json())).not.toContain('calldata');
   expect(seen).toEqual([{owner:account.address.toLowerCase(),buyAmountAtomic:'1000000000000000000'}]);
   expect((await app.inject({method:'POST',url:'/v1/routes/SPYon/preflight',headers:{origin:'https://wrong.example',cookie},payload:{direction:'BUY'}})).statusCode).toBe(403);
  }finally{await app.close();}
 });
 it('binds read-only research to the signed session address and never returns calldata',async()=>{
  const account=privateKeyToAccount('0x'+'11'.repeat(32) as `0x${string}`),origin='http://127.0.0.1:3110',seen:{endpoint:string;params:Record<string,string>}[]=[],readinessCalls:ReadinessInput[]=[];let failReadiness=false;
  const fake={get:async(endpoint:string,params:Record<string,string>={}):Promise<Observation>=>{
   seen.push({endpoint,params});const quote=endpoint.endsWith('/quote');
   return {schemaVersion:'2.0',endpoint,request:params,startedAt:'2026-09-23T00:00:00.000Z',finishedAt:'2026-09-23T00:00:00.500Z',httpStatus:200,state:'AVAILABLE',code:'0',body:quote?{success:true,data:[{quoteId:'test-quote',binanceChainId:'56',fromTokenAmount:params.amount,toTokenAmount:'90000000000000000',executionMode:'SWAP',approveTarget:'0x3333333333333333333333333333333333333333',fromToken:{tokenContractAddress:BSC_USDT},toToken:{tokenContractAddress:AAOIB}}]}:{success:true,data:{routerResult:{binanceChainId:'56',fromTokenAmount:params.amount,toTokenAmount:'90000000000000000',fromToken:{tokenContractAddress:BSC_USDT},toToken:{tokenContractAddress:AAOIB}},executionMode:'SWAP',tx:{from:account.address,to:'0x2222222222222222222222222222222222222222',data:'0x12345678',value:'0',minReceiveAmount:'89550000000000000',slippagePercent:'0.5'}}}};
  }};
  const app=createApp(process.cwd(),{researchClient:fake,readinessReader:async input=>{readinessCalls.push(input);if(failReadiness)throw new Error('RPC unavailable');return summarizeWalletReadiness(input,{blockNumber:123n,observedAt:'2026-09-23T00:00:01Z',chainId:56,paymentDecimals:18,paymentBalance:10n**19n,allowance:0n,nativeBalance:10n**15n,routerCodeHash:null,facet:null,facetCodeHash:null});}});
  try{
   const challenge=await app.inject({method:'POST',url:'/v1/wallet/challenge',headers:{origin},payload:{address:account.address,chainId:56}});
   expect(challenge.statusCode).toBe(200);
   const c=challenge.json(),signature=await account.signMessage({message:c.message});
   const verification=await app.inject({method:'POST',url:'/v1/wallet/verify',headers:{origin},payload:{challengeId:c.id,signature}});
   expect(verification.statusCode).toBe(200);
   const cookie=String(verification.headers['set-cookie']).split(';')[0];
   const result=await app.inject({method:'POST',url:'/v1/routes/AAOIB/research',headers:{origin,cookie},payload:{amount:'10'}});
   expect(result.statusCode).toBe(200);
   expect(result.json()).toMatchObject({state:'SHAPE_CHECKED',executionEnabled:false,mode:'SWAP',walletCheck:{state:'OBSERVED',balanceCoversAmount:true,allowanceCoversAmount:false,executionCertified:false}});
   expect(result.json().costEvidence).toMatchObject({ticker:'AAOIB',platform:'bstock',side:'buy',usd:10,observation:'none',pct:null,executable:false});
   expect(result.json().executionReview).toMatchObject({state:'BLOCKED',preparationAllowed:false,executable:false});
   expect(result.json().executionReview.costEvidence).toEqual(result.json().costEvidence);
   expect(result.json().executionReview.gates.find((g:{id:string})=>g.id==='interface').state).toBe('UNKNOWN');
   expect(JSON.stringify(result.json())).not.toContain('0x12345678');
   expect(seen).toHaveLength(2);
   expect(seen.every(call=>call.params.userWalletAddress===account.address.toLowerCase())).toBe(true);
   expect(readinessCalls).toEqual([{owner:account.address.toLowerCase(),spender:'0x3333333333333333333333333333333333333333',router:'0x2222222222222222222222222222222222222222',selector:'0x12345678',requiredAtomic:'10000000000000000000'}]);
   failReadiness=true;
   const failedRead=await app.inject({method:'POST',url:'/v1/routes/AAOIB/research',headers:{origin,cookie},payload:{amount:'10'}});
   expect(failedRead.json()).toMatchObject({state:'SHAPE_CHECKED',walletCheck:{state:'UNKNOWN',reason:'CHAIN_READ_FAILED'},executionEnabled:false});
   const wrongOrigin=await app.inject({method:'POST',url:'/v1/routes/AAOIB/research',headers:{origin:'https://wrong.example',cookie},payload:{amount:'10'}});
   expect(wrongOrigin.statusCode).toBe(403);
  }finally{await app.close();}
 });
});

describe('AAOIB accounting and research route boundary',()=>{
 const intent:RouteIntent={chainId:'56',fromToken:'0x55d398326f99059fF775485246999027B3197955',toToken:AAOIB,amount:'10000000000000000000',wallet:'0x1111111111111111111111111111111111111111'};
 it('binds historical cost lookup to the exact AAOIB route identity',()=>{
  expect(costIdentityForAAOIBRoute(intent,BSC_USDT)).toEqual({ticker:'AAOIB',platform:'bstock',side:'buy',usd:10});
  expect(costIdentityForAAOIBRoute({...intent,amount:'10000000000000000000000'},BSC_USDT)).toBeNull();
  expect(costIdentityForAAOIBRoute({...intent,toToken:'0x1111111111111111111111111111111111111111'},BSC_USDT)).toBeNull();
 });
 const quote={success:true,data:[{quoteId:'route-1',binanceChainId:'56',fromTokenAmount:intent.amount,toTokenAmount:'93000000000000000',executionMode:'SWAP',approveTarget:'0x2222222222222222222222222222222222222222',fromToken:{tokenContractAddress:intent.fromToken},toToken:{tokenContractAddress:intent.toToken}}]};
 it('reports one-block funding, allowance and router drift without certifying execution',()=>{
  const request:ReadinessInput={owner:intent.wallet,spender:'0x2222222222222222222222222222222222222222',router:'0xb44446b0c8e56988c34f7ff73ae904982b5fdda5',selector:'0xad43f73d',requiredAtomic:intent.amount};
  const observed={blockNumber:123n,observedAt:'2026-09-23T00:00:00Z',chainId:56,paymentDecimals:18,paymentBalance:9n*10n**18n,allowance:20n*10n**18n,nativeBalance:0n,routerCodeHash:'0xb6f35276cf3608595df59a3cfa5fb06a3309e64e387b0ea4f60875fdc4c696a0',facet:'0xa9fA1b56f4d7Bd25375C2d40B4c8e36A9509e603',facetCodeHash:'0x5ae2caa18a9d1d2dc528e6a1e9edf284883c023a617cc269b96620e4712d8ba0'};
  expect(summarizeWalletReadiness(request,observed)).toMatchObject({blockNumber:'123',balanceCoversAmount:false,allowanceCoversAmount:true,bnbPresent:false,routerFingerprintMatches:true,executionCertified:false});
  expect(summarizeWalletReadiness(request,{...observed,facetCodeHash:'0xdead'}).routerFingerprintMatches).toBe(false);
  expect(summarizeWalletReadiness(request,{...observed,paymentDecimals:6})).toMatchObject({paymentPrecisionMatches:false,balanceCoversAmount:null,allowanceCoversAmount:null});
 });
 it('uses 18-decimal multiplier with truncation and bounds',()=>{
  expect(uiAmount(10n*10n**18n,2n*10n**18n)).toBe(20n*10n**18n);
  expect(uiAmount(3n,5n*10n**17n)).toBe(1n);
  expect(()=>uiAmount(-1n,10n**18n)).toThrow();
  expect(()=>uiAmount(1n,0n)).toThrow();
 });
 it('rejects a quote for the wrong contract, amount or mode',()=>{
  expect(bindQuote(quote,intent,'2026-09-23T00:00:00Z')?.mode).toBe('SWAP');
  expect(bindQuote(quote,{...intent,amount:'1'},'2026-09-23T00:00:00Z')).toBeNull();
  expect(bindQuote(quote,{...intent,toToken:'0x3333333333333333333333333333333333333333'},'2026-09-23T00:00:00Z')).toBeNull();
  expect(bindQuote({success:true,data:[{...quote.data[0],executionMode:'OTHER'}]},intent,'2026-09-23T00:00:00Z')).toBeNull();
 });
 it('keeps a matching unsigned build non-executable and rejects changed sender or expiry',()=>{
  const bound=bindQuote(quote,intent,'2026-09-23T00:00:00Z')!;
  const build={success:true,data:{routerResult:{binanceChainId:'56',fromTokenAmount:intent.amount,toTokenAmount:bound.toTokenAmount,fromToken:{tokenContractAddress:intent.fromToken},toToken:{tokenContractAddress:intent.toToken}},executionMode:'SWAP',tx:{from:intent.wallet,to:'0x2222222222222222222222222222222222222222',data:'0x12345678',value:'0',minReceiveAmount:'92535000000000000',slippagePercent:'0.5'}}};
  expect(inspectBuild(build,bound,'2026-09-23T00:00:01Z')).toMatchObject({identityAndShapeChecked:true,executable:false});
  expect(inspectBuild({...build,data:{...build.data,tx:{...build.data.tx,from:'0x3333333333333333333333333333333333333333'}}},bound,'2026-09-23T00:00:01Z').reasons).toContain('SWAP_TX_SHAPE_INVALID');
  expect(inspectBuild({...build,data:{...build.data,routerResult:{...build.data.routerResult,toTokenAmount:'1'}}},bound,'2026-09-23T00:00:01Z').reasons).toContain('QUOTE_BUILD_ROUTE_MISMATCH');
  expect(inspectBuild({...build,data:{...build.data,tx:{...build.data.tx,minReceiveAmount:'93000000000000001'}}},bound,'2026-09-23T00:00:01Z').reasons).toContain('SWAP_LIMITS_MISMATCH');
  expect(inspectBuild({...build,data:{...build.data,tx:{...build.data.tx,minReceiveAmount:'1'}}},bound,'2026-09-23T00:00:01Z').reasons).toContain('SWAP_LIMITS_MISMATCH');
  expect(inspectBuild({...build,data:{...build.data,tx:{...build.data.tx,slippagePercent:'5'}}},bound,'2026-09-23T00:00:01Z').reasons).toContain('SWAP_LIMITS_MISMATCH');
  expect(inspectBuild({...build,data:{...build.data,tx:{...build.data.tx,value:'1'}}},bound,'2026-09-23T00:00:01Z').reasons).toContain('UNEXPECTED_NATIVE_VALUE');
  expect(inspectBuild(build,bound,'2026-09-23T00:01:00Z').reasons).toContain('QUOTE_EXPIRED_OR_CLOCK_UNKNOWN');
 });
});
