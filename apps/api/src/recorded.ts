import fs from 'node:fs';
import path from 'node:path';

type Observation = Record<string, unknown> & {ts: string; plat: string; addr: string};
const EXPECTED_ISSUERS = ['ondo', 'bstock'] as const;
const FRAME_WINDOW_MS = 2_000;
const COLLECTOR_STALE_MS = 30 * 60 * 1_000;
const AAOIB_ADDRESS = '0x10343ef7da3301493d7ecb647d68a288c6c1db2f';

function observations(file: string): Observation[] {
  const rows: Observation[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (typeof row.ts === 'string' && Number.isFinite(Date.parse(row.ts)) &&
          typeof row.plat === 'string' && typeof row.addr === 'string') rows.push(row as Observation);
    } catch { /* An append in progress is not a complete observation. */ }
  }
  return rows;
}

export function recordedCatalogue(root: string, now = Date.now()) {
  const dir = path.join(root, 'data');
  try {
    const files = fs.readdirSync(dir).filter(f => /^universe-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
    const file = files.at(-1);
    if (!file) throw new Error('No observations');
    const latestRows = observations(path.join(dir, file));
    if (!latestRows.length) throw new Error('No complete observations');
    const latestMs = Math.max(...latestRows.map(r => Date.parse(r.ts)));
    const collectorStaleMs = Math.max(0, now - latestMs);
    const stale = collectorStaleMs > COLLECTOR_STALE_MS || latestMs > now + 10_000;
    const rows = [...latestRows];
    for (const previous of files.slice(0, -1).reverse()) {
      if (EXPECTED_ISSUERS.every(issuer => rows.some(row => row.plat === issuer))) break;
      rows.push(...observations(path.join(dir, previous)));
    }
    const issuerStates = EXPECTED_ISSUERS.map(issuer => {
      const issuerRows = rows.filter(r => r.plat === issuer);
      const issuerMs = issuerRows.length ? Math.max(...issuerRows.map(r => Date.parse(r.ts))) : null;
      const state = !stale && issuerMs !== null && latestMs - issuerMs <= FRAME_WINDOW_MS ? 'OBSERVED' : 'UNKNOWN';
      return {issuer, state, lastObservedAt: issuerMs === null ? null : new Date(issuerMs).toISOString(),
        lastKnownAgeSeconds: issuerMs === null ? null : Math.max(0, Math.floor((now - issuerMs) / 1000))};
    });
    const items = issuerStates.flatMap(issuerState => {
      const issuerMs = issuerState.lastObservedAt === null ? null : Date.parse(issuerState.lastObservedAt);
      if (issuerMs === null) return [];
      const snapshot = rows.filter(r => r.plat === issuerState.issuer &&
        Math.abs(Date.parse(r.ts) - issuerMs) <= FRAME_WINDOW_MS);
      const unique = new Map<string, Observation>();
      for (const row of snapshot) unique.set(row.addr.toLowerCase(), row);
      return [...unique.values()].map(r => {
        const observed = issuerState.state === 'OBSERVED';
        const identityVerified = r.addr.toLowerCase() === AAOIB_ADDRESS && r.plat === 'bstock' && r.sym === 'AAOIB';
        return {
          id: r.addr, symbol: String(r.sym ?? ''), underlying: String(r.tk ?? ''), issuer: r.plat,
          referencePrice: observed ? String(r.ref ?? '') : null,
          tokenPrice: observed ? String(r.px ?? '') : null,
          lastKnownTokenPrice: String(r.px ?? ''), ratio: String(r.ratio ?? ''),
          observedAt: r.ts, reportedOpen: observed ? r.open === true : null,
          reportedStatus: observed ? String(r.status ?? 'unknown') : 'unknown',
          reportedReason: observed ? String(r.reason ?? 'UNKNOWN_DATA') : 'UNKNOWN_DATA',
          discoveryState: 'OBSERVED' as const,
          identityState: identityVerified ? 'VERIFIED' as const : 'UNVERIFIED' as const,
          marketDataState: issuerState.state,
          lastKnownAgeSeconds: issuerState.lastKnownAgeSeconds,
          executionState: 'UNVERIFIED' as const, executionCertified: false,
        };
      });
    });
    return {mode: 'recorded', source: file, observedAt: new Date(latestMs).toISOString(),
      ageSeconds: Math.floor(collectorStaleMs / 1000), collectorStaleMs, stale,
      completeIssuers: issuerStates.every(s => s.state === 'OBSERVED'), issuerStates, items,
      note: stale ? 'Collector observations are stale; displayed historical identity is not a current market quote or trading signal.' : 'Recorded collector observations, not executable quotes. Missing issuer data is unknown; trading eligibility is unverified.'};
  } catch {
    return {mode: 'unavailable', source: null, observedAt: null, ageSeconds: null, collectorStaleMs: null, stale: true,
      completeIssuers: false, issuerStates: EXPECTED_ISSUERS.map(issuer =>
        ({issuer, state: 'UNKNOWN', lastObservedAt: null, lastKnownAgeSeconds: null})),
      items: [], note: 'No complete local observation is available.'};
  }
}

export function capabilities(root:string){try{return JSON.parse(fs.readFileSync(path.join(root,'data/capabilities/latest.json'),'utf8'));}catch{return {checkedAt:null,checks:[],executionEnabled:false,note:'Read-only capability probe has not run.'};}}
