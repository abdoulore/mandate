/** Bounded, opt-in shadow recorder. Never writes or rewrites the v1 JSONL history. */
import fs from 'node:fs';
import path from 'node:path';
import { BSC_USDT, CATALOGUE_PATH, QUOTE_PATH, RESEARCH_WALLET, signedGet } from './v2.mjs';
import { CollectorBudget } from './budget.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const platform = option('--platform') || 'ondo';
const ticker = option('--ticker') || 'NVDA';
const max = Number(option('--max-requests'));
if (!['ondo', 'bstock'].includes(platform) || !/^[A-Z0-9.]{1,12}$/.test(ticker)) throw new Error('COLLECTOR_SCOPE_INVALID');
if (!args.includes('--run')) {
  console.log('Dry run only. To capture one catalogue and at most one 10-USDT research quote, use --run --max-requests 2 --platform ondo --ticker NVDA.');
  process.exit(0);
}
if (!Number.isInteger(max) || max < 1 || max > 2) throw new Error('COLLECTOR_BUDGET_INVALID: explicit --max-requests must be 1 or 2');
const budget = new CollectorBudget(max);
const key = process.env.BINANCE_WEB3_API_KEY, secret = process.env.BINANCE_WEB3_API_SECRET;
if (!key || !secret) throw new Error('COLLECTOR_CREDENTIALS_MISSING');
const out = path.resolve('data/v2', `observations-${new Date().toISOString().slice(0, 10)}.jsonl`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const append = record => fs.appendFileSync(out, JSON.stringify(record) + '\n', { flag: 'a' });
const catalogue = await signedGet({ key, secret, endpoint: CATALOGUE_PATH, params: { binanceChainId: '56', platformId: platform }, budget });
append(catalogue);
if (max === 2 && catalogue.response.state === 'OBSERVED') {
  const token = catalogue.response.rawSanitized.data.find(t => t.underlyingTicker === ticker && t.tokenContractAddress);
  if (token) {
    // This deterministic, unfunded research address never authorizes a trade.
    const quote = await signedGet({ key, secret, endpoint: QUOTE_PATH, params: {
      binanceChainId: '56', fromTokenAddress: BSC_USDT, toTokenAddress: token.tokenContractAddress,
      amount: '10000000000000000000',
      userWalletAddress: RESEARCH_WALLET,
    }, metadata: { fromDecimals: 18, toDecimals: token.tokenDecimal }, budget });
    append(quote);
  }
}
console.log(JSON.stringify({ mode: 'read_only_shadow', requests: budget.used, requestBudget: budget.limit, platform, ticker, output: out, executionEnabled: false }));
