import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,http,keccak256,parseAbi} from 'viem';
import {bsc} from 'viem/chains';

const dir=path.resolve('data/capabilities');
const evidence=JSON.parse(fs.readFileSync(path.join(dir,'aaoib-latest.json'),'utf8')) as {build?:{inspection?:{txTo?:string;txSelector?:string}}};
const router=evidence.build?.inspection?.txTo,selector=evidence.build?.inspection?.txSelector;
if(!router||!/^0x[0-9a-fA-F]{40}$/.test(router)||!selector||!/^0x[0-9a-fA-F]{8}$/.test(selector))throw new Error('Run npm run probe:instrument to obtain a current router and selector first.');
const rpc=createPublicClient({chain:bsc,transport:http('https://bsc-dataseed.bnbchain.org',{timeout:12000,retryCount:1})});
const blockNumber=await rpc.getBlockNumber();
const facet=await rpc.readContract({address:router as `0x${string}`,abi:parseAbi(['function facetAddress(bytes4) view returns (address)']),functionName:'facetAddress',args:[selector as `0x${string}`],blockNumber});
const [routerCode,facetCode]=await Promise.all([rpc.getBytecode({address:router as `0x${string}`,blockNumber}),rpc.getBytecode({address:facet,blockNumber})]);
async function ethereumExplorer(address:string){
 const url=`https://eth.blockscout.com/api/v2/smart-contracts/${address}`;
 try{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});const body=await response.json() as {is_verified?:boolean;name?:string;file_path?:string;deployed_bytecode?:`0x${string}`;abi?:unknown[]};return {url,httpStatus:response.status,verified:body.is_verified===true,name:body.name??null,file:body.file_path??null,codeHash:body.deployed_bytecode?keccak256(body.deployed_bytecode):null,abiPresent:Array.isArray(body.abi)&&body.abi.length>0};}
 catch{return {url,httpStatus:0,verified:false,name:null,file:null,codeHash:null,abiPresent:false};}
}
async function sourcifyLookup(address:string){
 const url=`https://sourcify.dev/server/v2/contract/56/${address}?fields=all`;
 try{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});const body=await response.json() as {match?:unknown;runtimeMatch?:unknown};return {url,httpStatus:response.status,state:response.status===404?'NOT_FOUND':response.ok&&(body.match||body.runtimeMatch)?'METADATA_AVAILABLE':'UNKNOWN'};}
 catch{return {url,httpStatus:0,state:'UNKNOWN'};}
}
async function signatureLookup(selector:string){
 const url=`https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`;
 try{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});const body=await response.json() as {count?:number};return {url,httpStatus:response.status,state:response.ok&&body.count===0?'NOT_FOUND':response.ok&&typeof body.count==='number'&&body.count>0?'CANDIDATES':'UNKNOWN',candidateCount:response.ok?body.count??null:null};}
 catch{return {url,httpStatus:0,state:'UNKNOWN',candidateCount:null};}
}
async function vendorDocumentation(){
 const url='https://docs.liquidmesh.io/docs/smart-contracts.md';
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});const body=await response.text();
  const documentedRouter=body.match(/EVM chains share the same router address[\s\S]*?(0x[0-9a-fA-F]{40})/)?.[1]?.toLowerCase()??null;
  const documentedApprovalContract=body.match(/EVM token approve contract[\s\S]*?(0x[0-9a-fA-F]{40})/)?.[1]?.toLowerCase()??null;
  return {url,httpStatus:response.status,state:response.ok&&documentedRouter?'OBSERVED':'UNKNOWN',documentedRouter,documentedApprovalContract,matchesOuterRouter:documentedRouter?documentedRouter===router!.toLowerCase():null,note:'The vendor documentation can describe an upstream route. A different outer router does not prove a bad route, but vendor labels do not verify its interface or spender.'};
 }catch{return {url,httpStatus:0,state:'UNKNOWN',documentedRouter:null,documentedApprovalContract:null,matchesOuterRouter:null};}
}
const [ethRouter,ethFacet,sourcify,selectorRegistry,vendorDocs]=await Promise.all([ethereumExplorer(router),ethereumExplorer(facet),sourcifyLookup(facet),signatureLookup(selector),vendorDocumentation()]);
const checkedAt=new Date().toISOString();
const result={checkedAt,chainId:56,blockNumber:blockNumber.toString(),router,selector,facet,bscRouterCodeHash:routerCode?keccak256(routerCode):null,bscFacetCodeHash:facetCode?keccak256(facetCode):null,ethereumRouter:ethRouter,ethereumFacet:ethFacet,sourcify,selectorRegistry,vendorDocs,sameRouterBytecode:!!routerCode&&ethRouter.codeHash===keccak256(routerCode),sameFacetBytecode:!!facetCode&&ethFacet.codeHash===keccak256(facetCode),calldataSemanticsVerified:false,executionCertified:false,note:'The Diamond selector mapping identifies the facet, but a code hash or unverified ABI does not explain the calldata arguments. Do not sign this payload without a verified interface and intent validation.'};
fs.writeFileSync(path.join(dir,'router-latest.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(dir,`router-${checkedAt.replace(/[:.]/g,'-')}.json`),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
