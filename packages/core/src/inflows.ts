import {inflowProofSchema,inflowReviewSchema,type InflowProof,type InflowReview,type InflowClassification} from '@mandate/domain';
export function classifyInflow(value:InflowProof,review:InflowReview='unclassified',now=Date.now(),knownSettlement=false):InflowClassification{
 const proof=inflowProofSchema.parse(value);inflowReviewSchema.parse(review);
 const confirmations=BigInt(proof.headNumber)-BigInt(proof.blockNumber)+1n,age=now-Date.parse(proof.observedAt),indexes=proof.incoming.map(l=>l.logIndex);
 if(confirmations<12n||age<0||age>60000||new Set(indexes).size!==indexes.length||proof.incoming.some(l=>l.to!==proof.wallet||l.from===proof.wallet||BigInt(l.amountAtomic)<=0n))throw new Error('INVALID_INFLOW_PROOF');
 const received=proof.incoming.reduce((a,l)=>a+BigInt(l.amountAtomic),0n),net=received-BigInt(proof.usdtOutgoingAtomic);if(net<=0n)throw new Error('NO_POSITIVE_USDT_INFLOW');
 const reasons=['Successful receipt and canonical block checked; 12-block confirmation threshold is not finalized settlement. Source classification is an application review, not proof of taxable income.'];
 let kind:InflowClassification['kind']='unclassified';
 if(knownSettlement){kind='internal';reasons.push('Known Mandate settlement receipt. Excluded from external-funding proposals.');}
 else if(proof.outgoingAssets.length||BigInt(proof.usdtOutgoingAtomic)>0n){kind='conversion';reasons.push('Outgoing assets occur in the same transaction. Treat this as conversion or other outflow activity, not new external funding.');}
 else if(review==='internal'){kind='internal';reasons.push('Reviewed as an internal movement. Excluded from incoming-funds allocation triggers.');}
 else if(proof.transactionSender===proof.wallet||proof.incoming.some(l=>l.from==='0x'+'0'.repeat(40))){reasons.push('Self-initiated or mint-origin transaction has unresolved provenance; external classification is unavailable.');}
 else if(review==='external'){kind='external';reasons.push('Reviewed as external funding. Ownership of sending wallets and economic source are not independently established.');}
 else reasons.push('A transfer receipt cannot distinguish outside funding from another wallet you own. Review its source before proposing an allocation.');
 return {kind,netAtomic:net.toString(),confirmations:confirmations.toString(),eligibleForProposal:kind==='external',reasons};
}
