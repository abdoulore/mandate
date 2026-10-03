import {isAddress} from 'viem';

function allowedWallets(){
 const entries=(process.env.MANDATE_DIRECT_PILOT_WALLETS??'').split(',').map(value=>value.trim()).filter(Boolean);
 if(entries.length===0||entries.some(value=>!isAddress(value)))return new Set<string>();
 return new Set(entries.map(value=>value.toLowerCase()));
}

export function directPilotAccess(wallet:string){
 const allowed=isAddress(wallet)&&allowedWallets().has(wallet.toLowerCase());
 return {
  approvalEnabled:allowed&&process.env.MANDATE_DIRECT_APPROVAL_ENABLED==='true',
  swapEnabled:allowed&&process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true',
 };
}

export function directPilotConfigured(){
 const hasWallet=allowedWallets().size>0;
 return {
  approvalEnabled:hasWallet&&process.env.MANDATE_DIRECT_APPROVAL_ENABLED==='true',
  swapEnabled:hasWallet&&process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true',
 };
}
