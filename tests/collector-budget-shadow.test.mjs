import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectorBudget } from '../collector/budget.mjs';
import { get } from '../collector/api.mjs';
import { shadowReport } from '../collector/shadow-report.mjs';

const address = '0x10343ef7da3301493d7ecb647d68a288c6c1db2f';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('collector request accounting', () => {
  it('requires an explicit bounded budget', async () => {
    expect(() => new CollectorBudget(0)).toThrow('COLLECTOR_BUDGET_INVALID');
    expect(() => new CollectorBudget(251)).toThrow('COLLECTOR_BUDGET_INVALID');
    expect(new CollectorBudget(250).remaining).toBe(250);
    await expect(get('/api/v1/dex/market/rwa/tokens', { platformId: 'ondo' })).rejects.toThrow('COLLECTOR_BUDGET_REQUIRED');
  });

  it('charges each retry attempt and cannot exceed the cap', async () => {
    vi.stubEnv('BINANCE_WEB3_API_KEY', 'test-key');
    vi.stubEnv('BINANCE_WEB3_API_SECRET', 'test-secret');
    const fetchImpl = vi.fn(async () => { throw new Error('network failure'); });
    vi.stubGlobal('fetch', fetchImpl);
    const budget = new CollectorBudget(2);
    await expect(get('/api/v1/dex/market/rwa/tokens', { platformId: 'ondo' }, { retries: 2, budget })).rejects.toThrow('COLLECTOR_BUDGET_EXHAUSTED');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(0);
  });

  it('keeps the HTTP status and Retry-After delay on a rate-limit response', async () => {
    vi.stubEnv('BINANCE_WEB3_API_KEY', 'test-key');
    vi.stubEnv('BINANCE_WEB3_API_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({http:200,code:42900}), {status:429,headers:{'Retry-After':'120'}})));
    const budget = new CollectorBudget(250);
    const result = await get('/api/v1/dex/market/rwa/tokens', {platformId:'ondo'}, {budget});
    expect(result).toMatchObject({http:429,code:42900,retryAfterMs:120_000});
    expect(budget.used).toBe(1);
  });
});

describe('shadow comparison', () => {
  const v1 = [{ ts: '2026-09-28T10:00:00.000Z', plat: 'ondo', addr: address, tk: 'AAOI', sym: 'AAOIB', open: true, status: 'regular', reason: 'TRADING' }];
  const observed = { schemaVersion: '2.0.0', kind: 'catalogue', request: { platformId: 'ondo' }, timing: { finishedAt: '2026-09-28T10:01:00.000Z' }, response: { state: 'OBSERVED', rawSanitized: { data: [{ tokenContractAddress: address, underlyingTicker: 'AAOI', tokenSymbol: 'AAOIB', statusInfo: { openState: false, marketStatus: 'postmarket', reasonCode: 'CLOSED' } }] } } };

  it('counts time-aligned coverage and field discrepancies', () => {
    const report = shadowReport(v1, [observed]);
    expect(report.status).toBe('compared');
    expect(report.platforms[0]).toMatchObject({ v1Tokens: 1, v2Tokens: 1, comparableTokens: 1, discrepancyCount: 3 });
    expect(report.platforms[0].discrepancies.map(x => x.field)).toEqual(['open', 'marketStatus', 'reasonCode']);
    expect(report.handoverReady).toBe(false);
  });

  it('does not invent a match for network errors or stale v1 evidence', () => {
    const error = { schemaVersion: '2.0.0', kind: 'catalogue', response: { state: 'SOURCE_ERROR', error: { category: 'NETWORK' } } };
    expect(shadowReport(v1, [error])).toMatchObject({ status: 'unavailable', v2SourceErrors: 1, platforms: [] });
    const stale = shadowReport([{ ...v1[0], ts: '2026-09-25T10:00:00.000Z' }], [observed]);
    expect(stale.platforms[0]).toMatchObject({ status: 'no_time_aligned_v1', comparableTokens: 0, onlyV1: null, onlyV2: null, historicalIdentityCoverage: { v1Tokens: 1, matchingAddresses: 1, comparableStatus: false } });
  });
});
