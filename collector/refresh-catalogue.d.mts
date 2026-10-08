export function refreshCatalogue(options?: {
  root?: string;
  key?: string;
  secret?: string;
  getImpl?: (endpoint:string, params:{binanceChainId:string;platformId:string},
    options:{budget:{consume:()=>void};retries:number})=>Promise<unknown>;
  now?: ()=>Date;
}): Promise<{
  capturedAt:string;
  platforms:string[];
  tokenCount:number;
  requests:number;
  executionEnabled:false;
}>;
