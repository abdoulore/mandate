import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_SKEW_MS = 15 * 60 * 1000;
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
const comparable = (left, right) => left === right || (left == null && right == null);

/** Compare only a v1 snapshot near a successful v2 catalogue observation. */
export function shadowReport(v1Rows, v2Rows, { maxSkewMs = MAX_SKEW_MS } = {}) {
  const catalogues = v2Rows.filter(row => row?.schemaVersion === '2.0.0' && row.kind === 'catalogue');
  const failures = catalogues.filter(row => row.response?.state !== 'OBSERVED');
  const latest = new Map();
  for (const row of catalogues) {
    if (row.response?.state !== 'OBSERVED') continue;
    const platform = row.request?.platformId;
    if (!platform || !Array.isArray(row.response?.rawSanitized?.data)) continue;
    if (!latest.has(platform) || row.timing.finishedAt > latest.get(platform).timing.finishedAt) latest.set(platform, row);
  }
  const platforms = [];
  for (const [platform, observation] of latest) {
    const targetMs = Date.parse(observation.timing.finishedAt);
    const prior = new Map();
    const historicalRows = v1Rows.filter(row => row.plat === platform && Number.isFinite(Date.parse(row.ts)) && Date.parse(row.ts) <= targetMs);
    const historicalAt = historicalRows.length ? historicalRows.reduce((latestAt, row) => Math.max(latestAt, Date.parse(row.ts)), -Infinity) : null;
    const historical = new Set(historicalRows.filter(row => historicalAt - Date.parse(row.ts) <= 60_000).map(row => address(row.addr)).filter(Boolean));
    for (const row of v1Rows) {
      if (row.plat !== platform) continue;
      const key = address(row.addr);
      const skewMs = Math.abs(Date.parse(row.ts) - targetMs);
      if (!key || !Number.isFinite(skewMs) || skewMs > maxSkewMs) continue;
      if (!prior.has(key) || skewMs < prior.get(key).skewMs) prior.set(key, { row, skewMs });
    }
    const current = new Map(observation.response.rawSanitized.data.map(token => [address(token.tokenContractAddress), token]).filter(([key]) => key));
    const discrepancies = [];
    for (const [key, token] of current) {
      const match = prior.get(key);
      if (!match) continue;
      const fields = [
        ['symbol', match.row.sym, token.tokenSymbol],
        ['ticker', match.row.tk, token.underlyingTicker],
        ['open', match.row.open, token.statusInfo?.openState],
        ['marketStatus', match.row.status, token.statusInfo?.marketStatus],
        ['reasonCode', match.row.reason, token.statusInfo?.reasonCode],
      ];
      for (const [field, v1, v2] of fields) if (!comparable(v1, v2)) discrepancies.push({ token: token.tokenSymbol, address: key, field, v1, v2, skewMs: match.skewMs });
    }
    platforms.push({
      platform, observedAt: observation.timing.finishedAt, maxSkewMs,
      v1Tokens: prior.size, v2Tokens: current.size,
      comparableTokens: [...current.keys()].filter(key => prior.has(key)).length,
      onlyV1: prior.size ? [...prior.keys()].filter(key => !current.has(key)).length : null,
      onlyV2: prior.size ? [...current.keys()].filter(key => !prior.has(key)).length : null,
      historicalIdentityCoverage: historicalAt === null ? null : {
        v1SnapshotAt: new Date(historicalAt).toISOString(), ageMs: targetMs - historicalAt,
        v1Tokens: historical.size, matchingAddresses: [...current.keys()].filter(key => historical.has(key)).length,
        onlyV1: [...historical].filter(key => !current.has(key)).length,
        onlyV2: [...current.keys()].filter(key => !historical.has(key)).length,
        comparableStatus: false,
      },
      discrepancyCount: discrepancies.length, discrepancies: discrepancies.slice(0, 30),
      status: prior.size ? 'compared' : 'no_time_aligned_v1',
    });
  }
  return {
    kind: 'collector_shadow_comparison', maxSkewMs,
    v1RowsRead: v1Rows.length, v2CatalogueRowsRead: catalogues.length,
    v2SourceErrors: failures.filter(row => row.response?.state === 'SOURCE_ERROR').length,
    v2DataErrors: failures.filter(row => row.response?.state === 'DATA_ERROR').length,
    platforms,
    status: platforms.some(p => p.status === 'compared') ? 'compared' : 'unavailable',
    handoverReady: false,
    note: 'Snapshot comparison is observational. Price changes and market-status changes may be genuine; zero discrepancies does not certify execution or collector handover.',
  };
}

function rows(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`INVALID_JSONL_ROW:${index + 1}`); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
  const v1 = option('--v1'), v2 = option('--v2');
  if (!v1 || !v2) throw new Error('Usage: node collector/shadow-report.mjs --v1 data/universe-YYYY-MM-DD.jsonl --v2 data/v2/observations-YYYY-MM-DD.jsonl');
  console.log(JSON.stringify(shadowReport(rows(v1), rows(v2)), null, 2));
}
