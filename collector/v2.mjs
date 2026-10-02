import { createHash, createHmac } from 'node:crypto';
import { requireBudget } from './budget.mjs';

export const CATALOGUE_PATH = '/api/v1/dex/market/rwa/tokens';
export const QUOTE_PATH = '/api/v1/dex/aggregator/quote';
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955';
export const RESEARCH_WALLET = '0x' + createHash('sha256').update('pegwatch-quote-probe').digest('hex').slice(0, 40);
const address = v => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
const numeric = v => typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) ? v : null;
const integer = v => {
  const n = typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
};
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const shortText = v => typeof v === 'string' && /^[\w .:/-]{1,80}$/.test(v) ? v : null;
const iso = v => {
  const time = typeof v === 'number' && Number.isInteger(v) && v > 1e12 ? v :
    typeof v === 'string' && /^\d{13}$/.test(v) ? Number(v) :
    typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const code = v => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 32).replace(/[^\w-]/g, '') || null : null;

export function sanitizeCatalogueToken(value) {
  const t = obj(value);
  if (!t) return null;
  const status = obj(t.statusInfo);
  return {
    underlyingTicker: shortText(t.underlyingTicker), tokenSymbol: shortText(t.tokenSymbol),
    platformId: shortText(t.platformId), tokenContractAddress: address(t.tokenContractAddress),
    assetType: shortText(t.assetType), tokenPrice: numeric(t.tokenPrice),
    referencePrice: numeric(t.referencePrice), tokenToShareRatio: numeric(t.tokenToShareRatio),
    tokenDecimal: integer(t.tokenDecimal ?? t.decimal), volume24H: numeric(t.volume24H),
    marketCap: numeric(t.marketCap), statusInfo: {
      openState: typeof status?.openState === 'boolean' ? status.openState : null,
      marketStatus: shortText(status?.marketStatus), reasonCode: shortText(status?.reasonCode),
      nextOpenTime: iso(status?.nextOpenTime),
    },
  };
}

export function sanitizeQuoteRoute(value) {
  const r = obj(value);
  if (!r) return null;
  const from = obj(r.fromToken), to = obj(r.toToken);
  return {
    binanceChainId: shortText(r.binanceChainId), executionMode: shortText(r.executionMode),
    vendorName: shortText(r.vendorName), fromTokenAmount: numeric(r.fromTokenAmount),
    toTokenAmount: numeric(r.toTokenAmount), priceImpactPercent: numeric(r.priceImpactPercent),
    fromToken: { tokenContractAddress: address(from?.tokenContractAddress), decimal: integer(from?.decimal), tokenUnitPrice: numeric(from?.tokenUnitPrice) },
    toToken: { tokenContractAddress: address(to?.tokenContractAddress), decimal: integer(to?.decimal), tokenUnitPrice: numeric(to?.tokenUnitPrice) },
    dexRouterList: Array.isArray(r.dexRouterList) ? r.dexRouterList.slice(0, 8).map(x => shortText(obj(obj(x)?.dexProtocol)?.dexName)).filter(Boolean) : [],
    // quoteId, spender, transaction material and wallet fields are deliberately omitted.
  };
}

export function makeObservation({ endpoint, request, startedAt, finishedAt, httpStatus, body = null, transportError = null, parseError = false }) {
  if (![CATALOGUE_PATH, QUOTE_PATH].includes(endpoint)) throw new Error('COLLECTOR_ENDPOINT_NOT_ALLOWED');
  const start = iso(startedAt), finish = iso(finishedAt);
  if (!start || !finish || Date.parse(finish) < Date.parse(start)) throw new Error('COLLECTOR_CLOCK_INVALID');
  const isQuote = endpoint === QUOTE_PATH;
  if (isQuote && (String(request.userWalletAddress).toLowerCase() !== RESEARCH_WALLET.toLowerCase() || !address(request.fromTokenAddress) || !address(request.toTokenAddress) || !/^[1-9]\d*$/.test(String(request.amount)))) throw new Error('COLLECTOR_RESEARCH_INTENT_INVALID');
  const safeRequest = isQuote ? {
    chainId: '56', fromTokenAddress: address(request.fromTokenAddress), toTokenAddress: address(request.toTokenAddress),
    amountAtomic: numeric(request.amount), fromDecimals: integer(request.fromDecimals), toDecimals: integer(request.toDecimals),
    walletContext: { kind: 'deterministic_unfunded_research', addressSha256: createHash('sha256').update(String(request.userWalletAddress || '')).digest('hex') },
  } : { chainId: '56', platformId: shortText(request.platformId) };
  const root = obj(body), rawData = root?.data;
  const data = Array.isArray(rawData) ? rawData : !isQuote && Array.isArray(obj(rawData)?.list) ? rawData.list : null;
  let state = 'OBSERVED', error = null;
  if (transportError) { state = 'SOURCE_ERROR'; error = { category: 'NETWORK', code: 'TRANSPORT_ERROR' }; }
  else if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) { state = 'SOURCE_ERROR'; error = { category: 'HTTP', code: code(root?.code) ?? 'HTTP_ERROR' }; }
  else if (parseError) { state = 'DATA_ERROR'; error = { category: 'PARSE', code: 'NON_JSON_RESPONSE' }; }
  else if (!root) { state = 'DATA_ERROR'; error = { category: 'SHAPE', code: 'MISSING_RESPONSE_OBJECT' }; }
  else if (root.success !== true && !['0', '000000'].includes(String(root.code))) { state = 'SOURCE_ERROR'; error = { category: 'VENDOR', code: code(root.code) ?? 'VENDOR_REJECTED' }; }
  else if (!data || data.length === 0) { state = 'DATA_ERROR'; error = { category: 'SHAPE', code: 'MISSING_OR_EMPTY_DATA' }; }
  const sanitized = state === 'OBSERVED' ? data.map(isQuote ? sanitizeQuoteRoute : sanitizeCatalogueToken) : null;
  if (sanitized && sanitized.some(x => !x || (isQuote ? !x.fromTokenAmount || !x.toTokenAmount || !x.fromToken.tokenContractAddress || !x.toToken.tokenContractAddress || x.fromToken.decimal === null || x.toToken.decimal === null : !x.tokenContractAddress))) {
    state = 'DATA_ERROR'; error = { category: 'SHAPE', code: 'INVALID_ITEM' };
  }
  const expiresAt = isQuote ? new Date(Date.parse(finish) + 30_000).toISOString() : null;
  return {
    schemaVersion: '2.0.0', kind: isQuote ? 'quote' : 'catalogue', executionEnabled: false,
    request: safeRequest, timing: { startedAt: start, finishedAt: finish, elapsedMs: Date.parse(finish) - Date.parse(start) },
    freshness: { expiresAt, basis: isQuote ? 'local_30_second_research_policy' : 'not_applicable' },
    response: { httpStatus: Number.isInteger(httpStatus) ? httpStatus : 0, vendorCode: code(root?.code), state, error,
      rawSanitized: state === 'OBSERVED' ? { success: root?.success === true, code: code(root?.code), data: sanitized } : null },
  };
}

export async function signedGet({ key, secret, endpoint, params, metadata = {}, budget, fetchImpl = fetch, now = () => new Date() }) {
  if (!key || !secret) throw new Error('COLLECTOR_CREDENTIALS_MISSING');
  if (![CATALOGUE_PATH, QUOTE_PATH].includes(endpoint)) throw new Error('COLLECTOR_ENDPOINT_NOT_ALLOWED');
  if (endpoint === QUOTE_PATH && (String(params.userWalletAddress).toLowerCase() !== RESEARCH_WALLET.toLowerCase() || !address(params.fromTokenAddress) || !address(params.toTokenAddress) || !/^[1-9]\d*$/.test(String(params.amount)))) throw new Error('COLLECTOR_RESEARCH_INTENT_INVALID');
  requireBudget(budget).consume();
  const query = new URLSearchParams(params).toString();
  const path = `/build${endpoint}?${query}`;
  const startedAt = now().toISOString();
  const signature = createHmac('sha256', secret).update(`${startedAt}GET${path}`).digest('base64');
  let httpStatus = 0, body = null, parseError = false, transportError = null;
  try {
    const result = await fetchImpl(`https://web3.binance.com${path}`, { headers: { 'X-OC-APIKEY': key, 'X-OC-TIMESTAMP': startedAt, 'X-OC-SIGN': signature, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    httpStatus = result.status;
    try { body = await result.json(); } catch { parseError = true; }
  } catch { transportError = true; }
  return makeObservation({ endpoint, request: { ...params, ...metadata }, startedAt, finishedAt: now().toISOString(), httpStatus, body, parseError, transportError });
}
