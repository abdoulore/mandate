import {spawn} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'.runtime','invariants');
await mkdir(output,{recursive:true});
const raw=join(output,'vitest.json'),report=join(output,'evidence.json');
// All tests run. An unavailable PostgreSQL-server gate remains explicitly skipped.
const result=await new Promise((resolveResult,reject)=>{
 const child=spawn(process.execPath,[join(root,'node_modules','vitest','vitest.mjs'),'run','--dir=tests','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile='+raw],{cwd:root,stdio:'inherit'});
 child.once('error',reject);child.once('exit',code=>resolveResult(code??1));
});
const sources=[];
async function collect(directory){for(const item of (await readdir(join(root,directory),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 const path=join(directory,item.name);
 if(item.isDirectory())await collect(path);
 else if(/\.(?:ts|tsx|mjs|json)$/.test(item.name))sources.push({path:path.replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(join(root,path))).digest('hex')});
}}
for(const directory of ['packages/agent/src','packages/core/src','packages/domain/src','packages/store/src','packages/connectors/src','apps/api/src','tests'])await collect(directory);
for(const path of ['package.json','package-lock.json','tsconfig.json','scripts/verify-invariants.mjs'])sources.push({path,sha256:createHash('sha256').update(await readFile(join(root,path))).digest('hex')});
sources.sort((a,b)=>a.path.localeCompare(b.path));
const run=JSON.parse(await readFile(raw,'utf8'));
const tests=run.testResults.flatMap(file=>file.assertionResults.map(test=>({file:relative(root,file.name).replaceAll('\\','/'),name:test.fullName,status:test.status})));
const evidence={schemaVersion:'1.0',task:'COR-10',createdAt:new Date().toISOString(),mode:'automated synthetic fixtures and internal persistence tests',success:result===0&&run.success,
 counts:{total:run.numTotalTests,passed:run.numPassedTests,failed:run.numFailedTests,skipped:tests.filter(t=>t.status==='pending'||t.status==='skipped').length},
 limitations:['No live wallet transaction was signed, submitted or reconciled.','PostgreSQL-server gate requires MANDATE_TEST_DATABASE_URL; inspect the skipped test list.','Passing finite seeded cases is evidence, not a mathematical proof over all inputs.','Production route certification, finalized-chain reconciliation and worker dispatch are outside this report.'],
 seeds:[1001,1002,1003,1004,1005,1006,1007,1008,2001,2002,2003],sources,tests};
await writeFile(report,JSON.stringify(evidence,null,2)+'\n');
console.log('COR-10 evidence: '+report);
console.log(JSON.stringify(evidence.counts));
process.exitCode=evidence.success?0:1;
