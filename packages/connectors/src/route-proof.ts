export const AAOIB='0x10343ef7da3301493d7ecb647d68a288c6c1db2f';
export const MULTIPLIER_SCALE=10n**18n;
const address=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)?value.toLowerCase():null;
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const atomic=(value:unknown)=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)?value:null;
const percentBps=(value:string)=>{if(!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))return null;const [whole,fraction='']=value.split('.');const bps=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));return bps<=10000n?bps:null;};

export function uiAmount(raw:bigint,multiplier:bigint):bigint{
 if(raw<0n||multiplier<=0n||raw>=(1n<<256n)||multiplier>=(1n<<256n))throw new Error('Invalid token amount or UI multiplier');
 const adjusted=raw*multiplier/MULTIPLIER_SCALE;
 if(adjusted>=(1n<<256n))throw new Error('UI amount exceeds uint256');
 return adjusted;
}

export type RouteIntent={chainId:'56';fromToken:string;toToken:string;amount:string;wallet:string};
// Historical cost evidence is bound to the exact research pair and size.
// The AAOI underlying or another USD amount cannot stand in for AAOIB.
export function costIdentityForAAOIBRoute(intent:RouteIntent,paymentToken:string){
 if(intent.chainId!=='56'||address(intent.fromToken)!==address(paymentToken)||address(intent.toToken)!==AAOIB||intent.amount!=='10000000000000000000')return null;
 return {ticker:'AAOIB' as const,platform:'bstock' as const,side:'buy' as const,usd:10 as const};
}
export type BoundQuote={quoteId:string;mode:'SWAP'|'RFQ';receivedAt:string;intent:RouteIntent;fromTokenAmount:string;toTokenAmount:string;approveTarget:string|null;vendorName:string|null};
export function bindQuote(body:unknown,intent:RouteIntent,receivedAt:string):BoundQuote|null{
 const root=object(body),routes=root?.data;
 if(root?.success!==true||!Array.isArray(routes)||!atomic(intent.amount)||BigInt(intent.amount)<=0n||!address(intent.wallet)||!address(intent.fromToken)||!address(intent.toToken))return null;
 for(const candidate of routes){
  const route=object(candidate),from=object(route?.fromToken),to=object(route?.toToken);
  if(!route||route.binanceChainId!==intent.chainId||route.fromTokenAmount!==intent.amount||address(from?.tokenContractAddress)!==address(intent.fromToken)||address(to?.tokenContractAddress)!==address(intent.toToken))continue;
  const outputAmount=atomic(route.toTokenAmount);
  if(typeof route.quoteId!=='string'||!route.quoteId||outputAmount===null||BigInt(outputAmount)<=0n||!['SWAP','RFQ'].includes(String(route.executionMode)))continue;
  if(route.approveTarget!=null&&!address(route.approveTarget))continue;
  return {quoteId:route.quoteId,mode:route.executionMode as 'SWAP'|'RFQ',receivedAt,intent,fromTokenAmount:intent.amount,toTokenAmount:outputAmount,approveTarget:address(route.approveTarget),vendorName:typeof route.vendorName==='string'?route.vendorName:null};
 }
 return null;
}

// This only verifies identity and response shape. It never certifies calldata or typed data for signing.
export function inspectBuild(body:unknown,quote:BoundQuote,observedAt:string,requestedSlippagePercent='0.5'){
 const root=object(body),data=object(root?.data),router=object(data?.routerResult),from=object(router?.fromToken),to=object(router?.toToken),tx=object(data?.tx),rfq=object(data?.rfq);
 const ageMs=Date.parse(observedAt)-Date.parse(quote.receivedAt);
 const reasons:string[]=[];
 if(!Number.isFinite(ageMs)||ageMs<0||ageMs>=30000)reasons.push('QUOTE_EXPIRED_OR_CLOCK_UNKNOWN');
 if(root?.success!==true||!data||!router)reasons.push('BUILD_UNAVAILABLE');
 if(router?.binanceChainId!==quote.intent.chainId||router?.fromTokenAmount!==quote.fromTokenAmount||address(from?.tokenContractAddress)!==address(quote.intent.fromToken)||address(to?.tokenContractAddress)!==address(quote.intent.toToken))reasons.push('QUOTE_BUILD_IDENTITY_MISMATCH');
 if(router?.toTokenAmount!==quote.toTokenAmount||(quote.vendorName!==null&&router?.vendorName!==quote.vendorName))reasons.push('QUOTE_BUILD_ROUTE_MISMATCH');
 if(data?.executionMode!==quote.mode)reasons.push('EXECUTION_MODE_MISMATCH');
 if(quote.mode==='SWAP'&&(!tx||address(tx.from)!==address(quote.intent.wallet)||!address(tx.to)||typeof tx.data!=='string'||!/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2})*$/.test(tx.data)||!atomic(tx.value)))reasons.push('SWAP_TX_SHAPE_INVALID');
 if(quote.mode==='SWAP'&&tx){
  const minimum=atomic(tx.minReceiveAmount);
  const minAtomic=minimum===null?null:BigInt(minimum),bps=percentBps(requestedSlippagePercent);
  const floor=bps===null?null:BigInt(quote.toTokenAmount)*(10000n-bps)/10000n;
  if(minAtomic===null||floor===null||minAtomic<=0n||minAtomic<floor||minAtomic>BigInt(quote.toTokenAmount)||tx.slippagePercent!==requestedSlippagePercent)reasons.push('SWAP_LIMITS_MISMATCH');
  if(tx.value!=='0')reasons.push('UNEXPECTED_NATIVE_VALUE');
 }
 if(quote.mode==='RFQ'&&(!rfq||typeof rfq.typedDataToSign!=='string'||!rfq.typedDataToSign))reasons.push('RFQ_TYPED_DATA_MISSING');
 return {identityAndShapeChecked:reasons.length===0,executable:false,reasons,mode:quote.mode,ageMs,hasTransaction:!!tx,hasRfq:!!rfq,txTo:address(tx?.to),txValue:atomic(tx?.value),minReceiveAmount:atomic(tx?.minReceiveAmount),slippagePercent:typeof tx?.slippagePercent==='string'?tx.slippagePercent:null,txSelector:typeof tx?.data==='string'&&/^0x[0-9a-fA-F]{8,}$/.test(tx.data)?tx.data.slice(0,10).toLowerCase():null,txDataBytes:typeof tx?.data==='string'&&/^0x[0-9a-fA-F]*$/.test(tx.data)?(tx.data.length-2)/2:null,typedDataPresent:typeof rfq?.typedDataToSign==='string'&&rfq.typedDataToSign.length>0};
}
