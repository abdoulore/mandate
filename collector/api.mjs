import crypto from "node:crypto";
import { requireBudget } from './budget.mjs';

const BASE = "https://web3.binance.com";
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Signed GET. requestPath MUST include the /build prefix and raw query string. */
export async function get(path, params = {}, { retries = 2, budget } = {}) {
  requireBudget(budget);
  const KEY = process.env.BINANCE_WEB3_API_KEY;
  const SECRET = process.env.BINANCE_WEB3_API_SECRET;
  if (!KEY || !SECRET) throw new Error('COLLECTOR_CREDENTIALS_MISSING');
  const qs = new URLSearchParams(params).toString();
  const requestPath = `/build${path}${qs ? "?" + qs : ""}`;
  for (let attempt = 0; ; attempt++) {
    budget.consume();
    const ts = new Date().toISOString();
    const sign = crypto.createHmac("sha256", SECRET).update(`${ts}GET${requestPath}`).digest("base64");
    try {
      const res = await fetch(`${BASE}${requestPath}`, {
        headers: { "X-OC-APIKEY": KEY, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sign, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      const retryAfter = res.status === 429 ? res.headers.get('retry-after') : null;
      const retryAfterMs = retryAfter === null ? 0 : /^\d+$/.test(retryAfter.trim())
        ? Math.min(Number(retryAfter.trim()) * 1000, 24 * 60 * 60 * 1000)
        : Math.min(Math.max(Date.parse(retryAfter) - Date.now(), 0) || 0, 24 * 60 * 60 * 1000);
      try { return { ...JSON.parse(text), http: res.status, retryAfterMs }; }
      catch { return { http: res.status, code: "PARSE", raw: text.slice(0, 200), retryAfterMs }; }
    } catch (e) {
      if (attempt >= retries) return { http: 0, code: "NETERR", msg: String(e).slice(0, 120) };
      await sleep(1000 * (attempt + 1));
    }
  }
}

export const USDT = "0x55d398326f99059fF775485246999027B3197955";
export const PROBE = "0x" + crypto.createHash("sha256").update("pegwatch-quote-probe").digest("hex").slice(0, 40);
export const wei = n => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();

export async function quote(from, to, amount, { budget } = {}) {
  return get("/api/v1/dex/aggregator/quote", {
    binanceChainId: "56", fromTokenAddress: from, toTokenAddress: to,
    amount, userWalletAddress: PROBE,
  }, { budget });
}
