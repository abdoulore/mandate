import {isAddress} from 'viem';

function allowedWallets(){
 const entries=(process.env.MANDATE_DIRECT_PILOT_WALLETS??'').split(',').map(value=>value.trim()).filter(Boolean);
 if(entries.length===0||entries.some(value=>!isAddress(value)))return new Set<string>();
 return new Set(entries.map(value=>value.toLowerCase()));
}

export function directPilotAccess(wallet:string){
 const allowed=isAddress(wallet)&&allowedWallets().has(wallet.toLowerCase());
 const fullRouteEnabled=allowed&&process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true';
 const planExecutionEnabled=allowed&&process.env.MANDATE_PLAN_DIRECT_ENABLED==='true';
 const buyApprovalEnabled=allowed&&process.env.MANDATE_DIRECT_APPROVAL_ENABLED==='true';
 const buyTrialEnabled=allowed&&process.env.MANDATE_DIRECT_SWAP_TRIAL_ENABLED==='true';
 const sellTrialEnabled=allowed&&process.env.MANDATE_DIRECT_SELL_TRIAL_ENABLED==='true'&&/^0x[0-9a-fA-F]{64}$/.test(process.env.MANDATE_DIRECT_SELL_TRIAL_BUY_HASH??'');
 return {
  approvalEnabled:buyApprovalEnabled||sellTrialEnabled,
  buyApprovalEnabled,
  swapEnabled:planExecutionEnabled||fullRouteEnabled||buyTrialEnabled||sellTrialEnabled,
  buyTrialEnabled,sellTrialEnabled,
  fullRouteEnabled,
  planExecutionEnabled,
 };
}

export function directPilotConfigured(){
 const hasWallet=allowedWallets().size>0;
 const fullRouteEnabled=hasWallet&&process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true';
 const planExecutionEnabled=hasWallet&&process.env.MANDATE_PLAN_DIRECT_ENABLED==='true';
 const buyApprovalEnabled=hasWallet&&process.env.MANDATE_DIRECT_APPROVAL_ENABLED==='true';
 const buyTrialEnabled=hasWallet&&process.env.MANDATE_DIRECT_SWAP_TRIAL_ENABLED==='true';
 const sellTrialEnabled=hasWallet&&process.env.MANDATE_DIRECT_SELL_TRIAL_ENABLED==='true'&&/^0x[0-9a-fA-F]{64}$/.test(process.env.MANDATE_DIRECT_SELL_TRIAL_BUY_HASH??'');
 return {
  approvalEnabled:buyApprovalEnabled||sellTrialEnabled,
  buyApprovalEnabled,
  swapEnabled:planExecutionEnabled||fullRouteEnabled||buyTrialEnabled||sellTrialEnabled,
  buyTrialEnabled,sellTrialEnabled,
  fullRouteEnabled,
  planExecutionEnabled,
 };
}
