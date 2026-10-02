import { describe, expect, it, vi } from 'vitest';
import { BSC_USDT, CATALOGUE_PATH, QUOTE_PATH, RESEARCH_WALLET, makeObservation, signedGet } from '../collector/v2.mjs';
import { CollectorBudget } from '../collector/budget.mjs';

const token = '0x10343ef7da3301493d7ecb647d68a288c6c1db2f';
const times = { startedAt: '2026-09-28T10:00:00.000Z', finishedAt: '2026-09-28T10:00:00.350Z' };
const request = { binanceChainId: '56', fromTokenAddress: BSC_USDT, toTokenAddress: token, amount: '10000000000000000000', fromDecimals: 18, toDecimals: 18, userWalletAddress: RESEARCH_WALLET };
const route = { binanceChainId: '56', executionMode: 'SWAP', vendorName: 'ExampleVenue', fromTokenAmount: request.amount, toTokenAmount: '123000000000000000', priceImpactPercent: '0.1', quoteId: 'live-quote-secret', userWalletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', fromToken: { tokenContractAddress: BSC_USDT, decimal: 18, tokenUnitPrice: '1' }, toToken: { tokenContractAddress: token, decimal: '18', tokenUnitPrice: '80' }, dexRouterList: [{ dexProtocol: { dexName: 'ExampleVenue', secret: 'never-save' } }] };

describe('collector v2 evidence', () => {
  it('keeps route amounts and decimals but strips wallet and executable fields', () => {
    const observed = makeObservation({ endpoint: QUOTE_PATH, request, ...times, httpStatus: 200, body: { success: true, code: '0', data: [route], privateKey: 'never-save' } });
    expect(observed.response.state).toBe('OBSERVED');
    expect(observed.request).toMatchObject({ amountAtomic: request.amount, fromDecimals: 18, toDecimals: 18, walletContext: { kind: 'deterministic_unfunded_research' } });
    expect(observed.request.walletContext).not.toHaveProperty('address');
    expect(observed.timing.elapsedMs).toBe(350);
    expect(observed.freshness).toEqual({ expiresAt: '2026-09-28T10:00:30.350Z', basis: 'local_30_second_research_policy' });
    expect(observed.response.rawSanitized.data[0]).toMatchObject({ fromTokenAmount: request.amount, toTokenAmount: route.toTokenAmount, toToken: { decimal: 18 } });
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain('live-quote-secret');
    expect(serialized).not.toContain('never-save');
    expect(serialized).not.toContain(RESEARCH_WALLET);
    expect(observed.executionEnabled).toBe(false);
  });

  it('records a sanitized catalogue response without treating status as a quote or trade', () => {
    const observed = makeObservation({ endpoint: CATALOGUE_PATH, request: { platformId: 'ondo' }, ...times, httpStatus: 200, body: { success: true, data: { list: [{ tokenContractAddress: token, underlyingTicker: 'AAOI', tokenSymbol: 'AAOIB', platformId: 'ondo', tokenPrice: '80', decimal: 18, statusInfo: { openState: false, marketStatus: 'CLOSED', reasonCode: 'AFTER_HOURS' }, secret: 'never-save' }] } } });
    expect(observed.response.state).toBe('OBSERVED');
    expect(observed.response.rawSanitized.data[0].statusInfo).toMatchObject({ openState: false, marketStatus: 'CLOSED' });
    expect(observed.freshness.expiresAt).toBeNull();
    expect(JSON.stringify(observed)).not.toContain('never-save');
  });

  it('separates source failures from invalid or empty data', () => {
    const common = { endpoint: QUOTE_PATH, request, ...times };
    expect(makeObservation({ ...common, httpStatus: 0, transportError: true }).response).toMatchObject({ state: 'SOURCE_ERROR', error: { category: 'NETWORK' } });
    expect(makeObservation({ ...common, httpStatus: 503, body: { code: 'DOWN' } }).response).toMatchObject({ state: 'SOURCE_ERROR', error: { category: 'HTTP' } });
    expect(makeObservation({ ...common, httpStatus: 200, body: { success: false, code: 'NO_ROUTE' } }).response).toMatchObject({ state: 'SOURCE_ERROR', error: { category: 'VENDOR' } });
    expect(makeObservation({ ...common, httpStatus: 200, parseError: true }).response).toMatchObject({ state: 'DATA_ERROR', error: { category: 'PARSE' } });
    expect(makeObservation({ ...common, httpStatus: 200, body: { success: true, data: [] } }).response).toMatchObject({ state: 'DATA_ERROR', error: { category: 'SHAPE' } });
    expect(makeObservation({ ...common, httpStatus: 200, body: { success: true, data: [{ ...route, toToken: {} }] } }).response).toMatchObject({ state: 'DATA_ERROR', error: { category: 'SHAPE' } });
  });

  it('signs only the read-only request and does not send local metadata to Binance', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, json: async () => ({ success: true, data: [route] }) }));
    const clock = [new Date(times.startedAt), new Date(times.finishedAt)];
    const budget = new CollectorBudget(1);
    const observed = await signedGet({ key: 'test-key', secret: 'test-secret', endpoint: QUOTE_PATH, params: { binanceChainId: '56', fromTokenAddress: BSC_USDT, toTokenAddress: token, amount: request.amount, userWalletAddress: RESEARCH_WALLET }, metadata: { fromDecimals: 18, toDecimals: 18 }, budget, fetchImpl, now: () => clock.shift() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).not.toContain('Decimals');
    expect(url).toContain('/build/api/v1/dex/aggregator/quote?');
    expect(options.headers['X-OC-SIGN']).toBeTruthy();
    expect(observed.request.toDecimals).toBe(18);
    expect(budget.used).toBe(1);
    await expect(signedGet({ key: 'test-key', secret: 'test-secret', endpoint: CATALOGUE_PATH, params: { platformId: 'ondo' }, budget, fetchImpl })).rejects.toThrow('COLLECTOR_BUDGET_EXHAUSTED');
    await expect(signedGet({ key: 'a', secret: 'b', endpoint: '/api/v1/dex/aggregator/swap', params: {}, fetchImpl })).rejects.toThrow('COLLECTOR_ENDPOINT_NOT_ALLOWED');
    await expect(signedGet({ key: 'a', secret: 'b', endpoint: QUOTE_PATH, params: { ...request, userWalletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, fetchImpl })).rejects.toThrow('COLLECTOR_RESEARCH_INTENT_INVALID');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves numeric source next-open timestamps', () => {
    const observed = makeObservation({ endpoint: CATALOGUE_PATH, request: { platformId: 'ondo' }, ...times, httpStatus: 200, body: { success: true, data: [{ tokenContractAddress: token, statusInfo: { nextOpenTime: 1790343060000 } }] } });
    expect(observed.response.rawSanitized.data[0].statusInfo.nextOpenTime).toBe(new Date(1790343060000).toISOString());
  });
});
