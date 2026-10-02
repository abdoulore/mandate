import type {CostEvidence} from './observed-cost.ts';

type WalletObservation = {
  state: 'OBSERVED';
  balanceCoversAmount: boolean | null;
  allowanceCoversAmount: boolean | null;
  bnbPresent: boolean;
  paymentPrecisionMatches: boolean;
  routerFingerprintMatches: boolean;
} | {state: 'UNKNOWN' | 'NOT_CHECKED'; reason: string};

export type ExecutionGate = {
  id: string;
  label: string;
  state: 'CHECKED' | 'BLOCKED' | 'UNKNOWN' | 'NOT_RUN';
  detail: string;
};

// Research observations do not grant transaction preparation or spending permission.
// No route has a validated calldata adapter yet, so funding cannot open this gate.
export function reviewResearchExecution(input: {
  shapeChecked: boolean;
  validUntil: string;
  checkedAt: string;
  wallet: WalletObservation;
  costEvidence?: CostEvidence;
}) {
  const expiry = Date.parse(input.validUntil), now = Date.parse(input.checkedAt);
  const fresh = Number.isFinite(expiry) && Number.isFinite(now) && now < expiry && expiry - now <= 30_000;
  const wallet = input.wallet.state === 'OBSERVED' ? input.wallet : null;
  const comparableFunding = wallet?.paymentPrecisionMatches === true && wallet.balanceCoversAmount !== null;
  const insufficientAllowance = wallet?.paymentPrecisionMatches === true && wallet.allowanceCoversAmount === false;
  const gates: ExecutionGate[] = [
    {id:'response', label:'Quote and build identity', state:input.shapeChecked ? 'CHECKED' : 'BLOCKED',
      detail:input.shapeChecked ? 'Response fields matched the requested wallet, token pair, amount and output limit.' : 'The unsigned build did not pass the response checks.'},
    {id:'freshness', label:'Research quote window', state:fresh ? 'CHECKED' : 'BLOCKED',
      detail:fresh ? 'Within the research window when the server finished checking. The quote still expires.' : 'The research quote expired or its clock could not be established. Request a fresh quote.'},
    {id:'interface', label:'Transaction meaning', state:'UNKNOWN',
      detail:'No validated interface for this route. Receiver, spending limit, minimum output and deadline cannot yet be confirmed from the transaction payload.'},
    {id:'eligibility', label:'Wallet market access', state:'UNKNOWN',
      detail:'A quote response does not establish this wallet’s eligibility to trade the instrument.'},
    {id:'funding', label:'USDT funding', state:!comparableFunding ? 'UNKNOWN' : wallet?.balanceCoversAmount ? 'CHECKED' : 'BLOCKED',
      detail:!comparableFunding ? 'No comparable wallet funding observation is available.' : wallet?.balanceCoversAmount ? 'Observed balance covered the 10 USDT research amount at the recorded block; fees and reservations are not assessed.' : 'Observed USDT balance was below the 10 USDT research amount.'},
    {id:'spender', label:'Spending permission', state:insufficientAllowance ? 'BLOCKED' : 'UNKNOWN',
      detail:insufficientAllowance ? 'Observed allowance to the spender candidate was below the amount. Its role is still unverified; no approval is requested.' : 'The spender’s role and approval scope are unverified. An observed allowance does not authorize this trade.'},
    {id:'gas', label:'Gas budget', state:wallet && !wallet.bnbPresent ? 'BLOCKED' : 'UNKNOWN',
      detail:wallet && !wallet.bnbPresent ? 'No BNB was observed for gas.' : 'Gas sufficiency has not been estimated for a validated transaction.'},
    {id:'simulation', label:'Wallet simulation', state:'NOT_RUN',
      detail:'Simulation waits for a validated transaction interface and current wallet state.'},
    {id:'authorization', label:'Trade authorization', state:'NOT_RUN',
      detail:'The sign-in message gave read-only access. No transaction authorization was requested.'},
  ];
  return {
    state:'BLOCKED' as const, checkedAt:input.checkedAt,
    preparationAllowed:false as const, executable:false as const,
    costEvidence:input.costEvidence??null,
    gates,
    note:'Transaction preparation is unavailable. Funding alone cannot resolve the unverified route interface and market access.',
  };
}
