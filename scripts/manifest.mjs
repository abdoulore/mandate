import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const dir=path.resolve('data'),target=path.resolve('research/evidence-manifest.json');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl')).sort().map(file=>{const bytes=fs.readFileSync(path.join(dir,file));const lines=bytes.toString('utf8').split(/\r?\n/).filter(Boolean);return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),rows:lines.length};});
fs.writeFileSync(target,JSON.stringify({capturedAt:new Date().toISOString(),note:'Append-only files were read sequentially and may keep growing. Hashes identify the captured byte prefixes; history was not rewritten.',files},null,2));console.log('Recorded manifest for '+files.length+' observation files.');
