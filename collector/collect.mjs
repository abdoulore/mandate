/**
 * Mandate collector — records the perishable series.
 *
 * Per cycle:
 *   1. universe snapshot  — all 488 tokens: price, ref, status, nextOpen   (2 calls)
 *   2. cost ladder        — fixed sample, buy+sell at several sizes        (~150 calls)
 *
 * Neither the quote depth nor the reference price has a historical endpoint,
 * so this series cannot be reconstructed later. Output: newline-delimited JSON.
 *
 * Usage: node --env-file=.env collector/collect.mjs --max-requests 250 [--interval-min 15] [--once] [--wait-for-boundary]
 */
import fs from "node:fs";
import path from "node:path";
import { get, quote, sleep, USDT, wei } from "./api.mjs";
import { CollectorBudget } from './budget.mjs';

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const INTERVAL_MIN = Number(argVal("--interval-min", 15));
const ONCE = args.includes("--once");
const WAIT_FOR_BOUNDARY = args.includes('--wait-for-boundary');
const MAX_REQUESTS_PER_CYCLE = Number(argVal('--max-requests', NaN));
if (!Number.isFinite(INTERVAL_MIN) || INTERVAL_MIN < 1 || INTERVAL_MIN > 1440) throw new Error('COLLECTOR_INTERVAL_INVALID');
if (!Number.isInteger(MAX_REQUESTS_PER_CYCLE) || MAX_REQUESTS_PER_CYCLE < 2 || MAX_REQUESTS_PER_CYCLE > 250) throw new Error('COLLECTOR_BUDGET_INVALID: explicit --max-requests must be 2..250 per cycle');
const OUT = path.resolve("data");
fs.mkdirSync(OUT, { recursive: true });

// Sample chosen to span every hypothesis we need to test at the open.
const SAMPLE = [
  "NVDA", "SPY", "SPCX",              // the three broken-on-ondo tokens
  "AAPL", "MSFT", "TSLA", "AMD",      // healthy controls
  "TQQQ", "SOXL", "KORU",             // leveraged (decay guard)
  "SGOV", "TLT", "AGG",               // fixed income (gated today)
  "IAU", "SLV", "USO",                // commodities (gated today)
  "IBIT", "KWEB", "EWY", "QQQ",       // crypto ETF / intl / broad
];
const BUY_SIZES = [100, 1000, 10000];
const SELL_SIZES = [100, 1000, 10000];

const iso = () => new Date().toISOString();
const line = (file, obj) => fs.appendFileSync(path.join(OUT, file), JSON.stringify(obj) + "\n");
const log = m => { const s = `[${iso()}] ${m}`; console.log(s); fs.appendFileSync(path.join(OUT, "collector.log"), s + "\n"); };
const rateLimit = response => {
  if (response?.http !== 429 && String(response?.code) !== '42900') return;
  const error = new Error('COLLECTOR_RATE_LIMITED');
  error.retryAfterMs = Math.max(0, Number(response.retryAfterMs) || 0);
  throw error;
};

async function universe(budget) {
  const out = [];
  for (const platformId of ["ondo", "bstock"]) {
    const r = await get("/api/v1/dex/market/rwa/tokens", { binanceChainId: "56", platformId }, { budget });
    rateLimit(r);
    const tokens = r?.data?.list || r?.data;
    if (!r?.success || !Array.isArray(tokens)) throw new Error('COLLECTOR_CATALOGUE_UNAVAILABLE');
    for (const t of tokens) out.push(t);
    await sleep(260);
  }
  const m = new Map();
  for (const t of out) m.set(t.tokenContractAddress, t);
  return [...m.values()];
}

/** Self-anchored cost vs the quote's own tokenUnitPrice. Never the stale list price. */
function buyCost(q, usd) {
  if (!q.success) return { err: q.code };
  const d = q.data[0];
  const tok = Number(d.toTokenAmount) / 10 ** Number(d.toToken.decimal);
  const usdIn = Number(d.fromTokenAmount) / 1e18 * Number(d.fromToken.tokenUnitPrice);
  return {
    pct: ((usdIn / tok) / Number(d.toToken.tokenUnitPrice) - 1) * 100,
    impact: Number(d.priceImpactPercent),
    route: d.dexRouterList?.map(x => x.dexProtocol?.dexName).join("|") || null,
  };
}
function sellCost(q) {
  if (!q.success) return { err: q.code };
  const d = q.data[0];
  const inTok = Number(d.fromTokenAmount) / 10 ** Number(d.fromToken.decimal);
  const usdOut = Number(d.toTokenAmount) / 1e18 * Number(d.toToken.tokenUnitPrice);
  return {
    pct: ((usdOut / inTok) / Number(d.fromToken.tokenUnitPrice) - 1) * 100,
    impact: Number(d.priceImpactPercent),
  };
}

async function cycle(n) {
  const budget = new CollectorBudget(MAX_REQUESTS_PER_CYCLE);
  const t0 = Date.now();
  const day = iso().slice(0, 10);
  const all = await universe(budget);
  const openNow = all.filter(t => t.statusInfo?.openState === true).length;

  for (const t of all) {
    line(`universe-${day}.jsonl`, {
      ts: iso(), tk: t.underlyingTicker, sym: t.tokenSymbol, plat: t.platformId,
      addr: t.tokenContractAddress, type: t.assetType,
      px: t.tokenPrice, ref: t.referencePrice, ratio: t.tokenToShareRatio,
      open: t.statusInfo?.openState, status: t.statusInfo?.marketStatus,
      reason: t.statusInfo?.reasonCode, nextOpen: t.statusInfo?.nextOpenTime,
      vol24h: t.volume24H, mcap: t.marketCap,
    });
  }
  log(`cycle ${n}: universe ${all.length} tokens, ${openNow} open (${(openNow / all.length * 100).toFixed(1)}%)`);

  let quotes = 0, errs = 0;
  for (const tk of SAMPLE) {
    for (const t of all.filter(x => x.underlyingTicker === tk)) {
      const px = Number(t.tokenPrice) || 0;
      for (const usd of BUY_SIZES) {
        await sleep(240);
        const result = await quote(USDT, t.tokenContractAddress, wei(usd), { budget });
        rateLimit(result);
        const c = buyCost(result, usd);
        quotes++; if (c.err) errs++;
        line(`cost-${day}.jsonl`, { ts: iso(), tk, plat: t.platformId, side: "buy", usd, open: t.statusInfo?.openState, ...c });
      }
      if (!px) continue;
      for (const usd of SELL_SIZES) {
        await sleep(240);
        const result = await quote(t.tokenContractAddress, USDT, wei(usd / px), { budget });
        rateLimit(result);
        const c = sellCost(result);
        quotes++; if (c.err) errs++;
        line(`cost-${day}.jsonl`, { ts: iso(), tk, plat: t.platformId, side: "sell", usd, open: t.statusInfo?.openState, ...c });
      }
    }
  }
  log(`cycle ${n}: ${quotes} quotes (${errs} errored), ${budget.used}/${budget.limit} HTTP attempts in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

log(`collector start — interval ${INTERVAL_MIN}min, sample ${SAMPLE.length} tickers, request budget ${MAX_REQUESTS_PER_CYCLE} per cycle, out ${OUT}`);
log(`watching for opens: 00:05Z (264 tokens), 08:01Z (94), 13:31Z (84)`);
if (WAIT_FOR_BOUNDARY) {
  const now = Date.now(), intervalMs = INTERVAL_MIN * 60_000;
  const next = Math.ceil((now + 1000) / intervalMs) * intervalMs;
  log(`restart waiting ${Math.ceil((next - now) / 1000)}s until the next scheduled cycle`);
  await sleep(Math.max(next - now, 5000));
}
let n = 0;
for (;;) {
  n++;
  let cooldownMs = 0;
  try { await cycle(n); }
  catch (e) {
    cooldownMs = e?.message === 'COLLECTOR_RATE_LIMITED' ? Math.max(e.retryAfterMs || 0, INTERVAL_MIN * 60_000) : 0;
    log(`cycle ${n} FAILED: ${['COLLECTOR_BUDGET_EXHAUSTED', 'COLLECTOR_RATE_LIMITED'].includes(e?.message) ? e.message : 'COLLECTOR_CYCLE_FAILED'}${cooldownMs ? `; cooldown ${Math.ceil(cooldownMs / 1000)}s` : ''}`);
  }
  if (ONCE) break;
  const t = Date.now();
  const next = Math.ceil(t / (INTERVAL_MIN * 60000)) * (INTERVAL_MIN * 60000);
  await sleep(Math.max(next - t, cooldownMs, 5000));
}
