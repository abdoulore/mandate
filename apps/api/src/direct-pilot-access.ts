import {isAddress} from 'viem';

function allowedWallets(){
 const entries=(process.env.MANDATE_DIRECT_PILOT_WALLETS??'').split(',').map(value=>value.trim()).filter(Boolean);
 if(entries.length===0||entries.some(value=>!isAddress(value)))return new Set<string>();
 return new Set(entries.map(value=>value.toLowerCase()));
}

export function directPilotAccess(wallet:string){
 const allowed=isAddress(wallet)&&allowedWallets().has(wallet.toLowerCase());
 const fullRouteEnabled=allowed&&process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true';
 return {
  approvalEnabled:allowed&&process.env.MANDATE_DIRECT_APPROVAL_ENABLED==='true',
  swapEnabled:fullRouteEnabled||(allowed&&process.env.MANDATE_DIRECT_SWAP_TRIAL_ENABLED==='true'),
  fullRouteEnabled,
 };
}

export function directPilotConfigured(){
 const hasWallet=allowedWallets().size>0;
 const fullRouteEnabled=hasWallet&&process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true';
 return {
  approvalEnabled:hasWallet&&process.env.MANDATE_DIRECT_APPROVAL_ENABLED==='true',
  swapEnabled:fullRouteEnabled||(hasWallet&&process.env.MANDATE_DIRECT_SWAP_TRIAL_ENABLED==='true'),
  fullRouteEnabled,
 };
}
