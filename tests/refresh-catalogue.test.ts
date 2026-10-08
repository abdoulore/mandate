import {afterEach, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {refreshCatalogue} from '../collector/refresh-catalogue.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true, force:true}); });

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-live-catalogue-'));
  roots.push(root);
  return root;
}

function tokens(platformId:string) {
  return Array.from({length:10}, (_,i) => ({
    platformId, tokenContractAddress:`0x${String(i + (platformId === 'ondo' ? 1 : 11)).padStart(40,'0')}`,
    tokenSymbol:`T${i}${platformId}`, underlyingTicker:`T${i}`,
    tokenPrice:'1', referencePrice:'1', statusInfo:{openState:true,marketStatus:'regular'},
  }));
}

it('records both issuer responses as one bounded, atomic frame', async () => {
  const root = tempRoot();
  const calls:string[] = [];
  const getImpl = async (endpoint:string, params:{platformId:string}, options:{budget:{consume:()=>void},retries:number}) => {
    options.budget.consume();
    calls.push(`${endpoint}:${params.platformId}:${options.retries}`);
    return {success:true,data:{list:tokens(params.platformId)}};
  };
  const result = await refreshCatalogue({root,key:'test',secret:'test',getImpl,
    now:()=>new Date('2026-09-23T12:00:00Z')});
  expect(result).toMatchObject({requests:2,tokenCount:20,executionEnabled:false});
  expect(calls).toEqual([
    '/api/v1/dex/market/rwa/tokens:ondo:0',
    '/api/v1/dex/market/rwa/tokens:bstock:0',
  ]);
  const rows = fs.readFileSync(path.join(root,'data','live','catalogue.jsonl'),'utf8')
    .trim().split('\n').map(line=>JSON.parse(line));
  expect(new Set(rows.map(row=>row.ts))).toEqual(new Set(['2026-09-23T12:00:00.000Z']));
  expect(new Set(rows.map(row=>row.plat))).toEqual(new Set(['ondo','bstock']));
});

it('keeps the previous frame when an issuer response is incomplete', async () => {
  const root = tempRoot();
  const directory = path.join(root,'data','live');
  fs.mkdirSync(directory,{recursive:true});
  const destination = path.join(directory,'catalogue.jsonl');
  fs.writeFileSync(destination,'previous-frame\n');
  const getImpl = async (_endpoint:string, params:{platformId:string}, options:{budget:{consume:()=>void}}) => {
    options.budget.consume();
    return {success:true,data:{list:params.platformId === 'ondo' ? tokens('ondo') : []}};
  };
  await expect(refreshCatalogue({root,key:'test',secret:'test',getImpl})).rejects.toThrow('CATALOGUE_SOURCE_INCOMPLETE');
  expect(fs.readFileSync(destination,'utf8')).toBe('previous-frame\n');
  expect(fs.readdirSync(directory)).toEqual(['catalogue.jsonl']);
});
