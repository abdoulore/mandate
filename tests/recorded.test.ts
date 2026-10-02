import {afterEach, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recordedCatalogue} from '../apps/api/src/recorded.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });

function catalogueFor(rows: Record<string, unknown>[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-catalogue-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'universe-2026-09-23.jsonl'),
    rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return recordedCatalogue(root, Date.parse('2026-09-23T12:20:00Z'));
}

const ondo = {ts:'2026-09-23T12:00:00Z',plat:'ondo',addr:'0x111',sym:'TESTon',tk:'TEST',px:'10',ref:'10',ratio:'1',open:true,status:'regular'};
const bstock = {ts:'2026-09-23T12:00:01Z',plat:'bstock',addr:'0x10343ef7da3301493d7ecb647d68a288c6c1db2f',sym:'AAOIB',tk:'AAOI',px:'100',ref:'100',ratio:'1',open:true};

it('keeps discovery, identity, market data and execution evidence separate', () => {
  const result = catalogueFor([ondo, bstock]);
  expect(result).toMatchObject({stale:false,collectorStaleMs:1_199_000});
  expect(result.completeIssuers).toBe(true);
  const aaoi = result.items.find(item => item.symbol === 'AAOIB');
  expect(aaoi).toMatchObject({discoveryState:'OBSERVED',identityState:'VERIFIED',marketDataState:'OBSERVED',executionState:'UNVERIFIED',executionCertified:false});
  expect(result.items.find(item => item.symbol === 'TESTon')?.identityState).toBe('UNVERIFIED');
});

it('marks an old collector frame stale and hides its marks as current data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-catalogue-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'universe-2026-09-23.jsonl'),
    [ondo, bstock].map(row => JSON.stringify(row)).join('\n') + '\n');
  const result = recordedCatalogue(root, Date.parse('2026-09-23T12:31:02Z'));
  expect(result).toMatchObject({stale:true,collectorStaleMs:1_861_000,completeIssuers:false});
  expect(result.issuerStates.every(state => state.state === 'UNKNOWN')).toBe(true);
  expect(result.items.find(item => item.symbol === 'AAOIB')).toMatchObject({tokenPrice:null,marketDataState:'UNKNOWN',reportedOpen:null,reportedStatus:'unknown'});
});

it('marks a missing issuer response unknown and never presents its last mark as current', () => {
  const result = catalogueFor([ondo, bstock, {...ondo, ts:'2026-09-23T12:15:00Z', px:'11'}]);
  expect(result.completeIssuers).toBe(false);
  expect(result.issuerStates.find(state => state.issuer === 'bstock')).toMatchObject({state:'UNKNOWN',lastKnownAgeSeconds:1199});
  expect(result.items.find(item => item.symbol === 'AAOIB')).toMatchObject({marketDataState:'UNKNOWN',tokenPrice:null,lastKnownTokenPrice:'100',reportedStatus:'unknown',reportedOpen:null,executionCertified:false});
  expect(result.items.find(item => item.symbol === 'TESTon')?.tokenPrice).toBe('11');
});

it('shows an unknown issuer with no invented last-known observation', () => {
  const result = catalogueFor([ondo]);
  expect(result.issuerStates.find(state => state.issuer === 'bstock')).toMatchObject({state:'UNKNOWN',lastObservedAt:null,lastKnownAgeSeconds:null});
});

it('retains last-known age when the missing issuer was last seen in a prior file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-catalogue-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'universe-2026-09-22.jsonl'), JSON.stringify(bstock) + '\n');
  fs.writeFileSync(path.join(root, 'data', 'universe-2026-09-23.jsonl'), JSON.stringify({...ondo, ts:'2026-09-23T12:15:00Z'}) + '\n');
  const result = recordedCatalogue(root, Date.parse('2026-09-23T12:20:00Z'));
  expect(result.issuerStates.find(state => state.issuer === 'bstock')).toMatchObject({state:'UNKNOWN',lastKnownAgeSeconds:1199});
  expect(result.items.find(item => item.symbol === 'AAOIB')?.tokenPrice).toBeNull();
});
