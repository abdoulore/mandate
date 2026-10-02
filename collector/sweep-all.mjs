/** Full-universe single-pass sweep: every token, buy $10k, self-anchored. */
import fs from "node:fs";
import { get, quote, sleep, USDT, wei } from "./api.mjs";
import { CollectorBudget } from './budget.mjs';
const args = process.argv.slice(2);
const i = args.indexOf('--max-requests');
const max = i < 0 ? NaN : Number(args[i + 1]);
if (!Number.isInteger(max) || max < 2 || max > 200) throw new Error('COLLECTOR_BUDGET_INVALID: explicit --max-requests must be 2..200');
const budget = new CollectorBudget(max);
const OUT = "data/sweep-all-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16) + ".jsonl";
const all = [];
for (const platformId of ["ondo", "bstock"]) {
  const r = await get("/api/v1/dex/market/rwa/tokens", { binanceChainId: "56", platformId }, { budget });
  for (const t of (r?.data?.list || r?.data || [])) all.push(t);
  await sleep(300);
}
const uniq = new Map(); for (const t of all) uniq.set(t.tokenContractAddress, t);
const toks = [...uniq.values()];
console.error(`sweeping ${toks.length} tokens…`);
let n = 0, bad = 0, err = 0;
for (const t of toks) {
  if (budget.remaining === 0) break;
  await sleep(350);                       // gentle: collector shares the rate limit
  let q;
  try { q = await quote(USDT, t.tokenContractAddress, wei(10000), { budget }); }
  catch (e) { if (e?.message === 'COLLECTOR_BUDGET_EXHAUSTED') break; throw e; }
  n++;
  let row = { ts: new Date().toISOString(), tk: t.underlyingTicker, plat: t.platformId,
              type: t.assetType, open: t.statusInfo?.openState, name: t.underlyingName };
  if (!q.success) { row.err = q.code; err++; }
  else {
    const d = q.data[0];
    const tok = Number(d.toTokenAmount) / 10 ** Number(d.toToken.decimal);
    const usdIn = Number(d.fromTokenAmount) / 1e18 * Number(d.fromToken.tokenUnitPrice);
    row.pct = ((usdIn / tok) / Number(d.toToken.tokenUnitPrice) - 1) * 100;
    row.impact = Number(d.priceImpactPercent);
    row.venues = d.dexRouterList?.length || 0;
    if (row.pct > 1) bad++;
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  if (n % 50 === 0) console.error(`  ${n}/${toks.length}  bad=${bad} err=${err}`);
}
console.error(`DONE ${n} tokens, ${bad} over 1%, ${err} errored, ${budget.used}/${budget.limit} HTTP attempts -> ${OUT}`);
