import {expect, it} from 'vitest';
import {reviewResearchExecution} from '../apps/api/src/execution-review.ts';

const input = {
  shapeChecked:true,
  validUntil:'2026-09-27T08:00:30Z',
  checkedAt:'2026-09-27T08:00:05Z',
  wallet:{state:'OBSERVED' as const,balanceCoversAmount:true,allowanceCoversAmount:true,
    bnbPresent:true,paymentPrecisionMatches:true,routerFingerprintMatches:true},
};

it('does not let funding or a matching router substitute for validated transaction meaning', () => {
  const review = reviewResearchExecution(input);
  expect(review).toMatchObject({state:'BLOCKED',preparationAllowed:false,executable:false});
  expect(review.gates.find(g => g.id === 'interface')?.state).toBe('UNKNOWN');
  expect(review.gates.find(g => g.id === 'spender')?.state).toBe('UNKNOWN');
  expect(review.gates.find(g => g.id === 'authorization')?.state).toBe('NOT_RUN');
});

it('distinguishes observed funding shortfalls from unknown wallet state', () => {
  const shortfall = reviewResearchExecution({...input,wallet:{...input.wallet,balanceCoversAmount:false,allowanceCoversAmount:false,bnbPresent:false}});
  for (const id of ['funding','spender','gas']) expect(shortfall.gates.find(g => g.id === id)?.state).toBe('BLOCKED');
  const unknown = reviewResearchExecution({...input,wallet:{state:'UNKNOWN',reason:'CHAIN_READ_FAILED'}});
  for (const id of ['funding','spender','gas']) expect(unknown.gates.find(g => g.id === id)?.state).toBe('UNKNOWN');
});

it('blocks a quote that expired during wallet reads, including at the exact deadline', () => {
  for (const checkedAt of [input.validUntil,'2026-09-27T08:01:00Z','2026-09-27T07:59:59Z','invalid']) {
    const review = reviewResearchExecution({...input,checkedAt});
    expect(review.gates.find(g => g.id === 'freshness')?.state).toBe('BLOCKED');
    expect(review.preparationAllowed).toBe(false);
  }
});

it('never converts a response mismatch or an incomparable token balance into a passed gate', () => {
  const review = reviewResearchExecution({...input,shapeChecked:false,wallet:{...input.wallet,paymentPrecisionMatches:false}});
  expect(review.gates.find(g => g.id === 'response')?.state).toBe('BLOCKED');
  expect(review.gates.find(g => g.id === 'funding')?.state).toBe('UNKNOWN');
  expect(review.gates.find(g => g.id === 'simulation')?.state).toBe('NOT_RUN');
});

it('keeps a measured historical cost separate from trade authorization', () => {
  const costEvidence={ticker:'NVDA',platform:'ondo' as const,side:'buy' as const,usd:10000,observation:'measured' as const,
    observedAt:'2026-09-20T16:45:00Z',pct:133.71,route:'Venue A',errorCode:null,
    source:{file:'data/cost-2026-09-20.jsonl',line:1,sha256:'a'.repeat(64)},executable:false as const,note:'Historical measurement.'};
  const review=reviewResearchExecution({...input,costEvidence});
  expect(review.costEvidence).toEqual(costEvidence);
  expect(review).toMatchObject({state:'BLOCKED',preparationAllowed:false,executable:false});
});
