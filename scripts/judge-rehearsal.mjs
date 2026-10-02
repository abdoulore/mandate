import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const output=new URL('../.runtime/judge-rehearsal/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const checks=[];
function assert(ok,message){if(!ok)throw new Error(message);checks.push(message);}
async function sourceLine(source){
 const lines=(await readFile(new URL('../'+source.file,import.meta.url),'utf8')).split('\n');
 const original=lines[source.line-1];
 assert(Boolean(original),'Source line exists: '+source.file+':'+source.line);
 assert(createHash('sha256').update(original).digest('hex')===source.sha256,'Source hash matches: '+source.file+':'+source.line);
}
async function screenshot(name){await page.screenshot({path:new URL(name+'.png',output).pathname.slice(1),fullPage:false});}
try{
 const response=await page.goto(origin+'/',{waitUntil:'networkidle',timeout:90000});
 assert(response?.status()===200,'Landing page loads');
 await page.getByRole('heading',{name:'Know when buying gets expensive.'}).waitFor();
 await screenshot('00-landing');
 await page.getByRole('link',{name:'Explore cost history'}).first().click();
 await page.waitForURL('**/regime');
 assert(page.url().endsWith('/regime'),'Landing action opens cost history');
 await page.getByRole('heading',{name:'The quoted cost changed in 15 minutes.'}).waitFor();
 const data=await (await page.request.get(origin+'/api/v1/regime?token=NVDA&platform=ondo')).json();
 const first=data.points.find(point=>point.ts.startsWith('2026-09-20T16:45:'));
 const second=data.points.find(point=>point.ts.startsWith('2026-09-20T17:00:'));
 assert(first&&second&&first.pct>133.7&&first.pct<133.72&&second.pct<0&&second.pct>-.06,'NVDA $10,000 buy changed from +133.71% to -0.05% in 15 minutes');
 await sourceLine(first.source);await sourceLine(second.source);
 assert((await page.getByLabel('Recorded NVDA cost reversal').innerText()).includes('HISTORICAL QUOTES'),'Opening labels the two values as historical quotes');
 await screenshot('01-regime-opening');
 await page.getByRole('button',{name:'See first quote'}).click();
 await page.locator('.regime-evidence').getByText('data/cost-2026-09-20.jsonl:4323').waitFor();
 await screenshot('02-first-source');
 await page.getByRole('button',{name:'See next quote'}).click();
 await page.locator('.regime-evidence').getByText('data/cost-2026-09-20.jsonl:4503').waitFor();
 await screenshot('03-next-source');

 await page.locator('.regime-secondary > summary').click();
 const observed=await (await page.request.get(origin+'/api/v1/cost-review?ticker=NVDA&platform=ondo&side=buy&usd=10000')).json();
 assert(observed.executable===false,'Latest matching evidence cannot authorize a trade');
 if(observed.observation==='measured'){
  assert(Boolean(observed.observedAt&&observed.source&&observed.pct!==null),'Measured latest cost has a timestamp and source');
  await sourceLine(observed.source);
  await page.locator('.regime-cost-review .cost-review-value strong').getByText(`${observed.pct>=0?'+':''}${observed.pct.toFixed(2)}%`,{exact:true}).waitFor();
 }else{
  assert(observed.observation==='none'&&observed.pct===null,'Failed latest quote stays unmeasured');
  await page.locator('.regime-cost-review .cost-review-value strong').getByText('No measured cost').waitFor();
 }
 await screenshot('04-latest-measured-cost');
 await page.getByRole('button',{name:'AAOIB / bStock · $10 example'}).click();
 const missing=await (await page.request.get(origin+'/api/v1/cost-review?ticker=AAOIB&platform=bstock&side=buy&usd=10')).json();
 assert(missing.observation==='none'&&missing.pct===null,'Unobserved AAOIB cost stays unknown instead of using a synthetic number');
 await page.locator('.regime-cost-review .cost-review-value strong').getByText('No measured cost').waitFor();
 await screenshot('05-no-observation');

 await page.getByRole('button',{name:'AMZN / ondo'}).click();
 await page.getByText('No $10,000 buy cost series was recorded for this token.').waitFor();
 const amzn=await (await page.request.get(origin+'/api/v1/regime?token=AMZN&platform=ondo')).json();
 assert(amzn.points.length===0&&amzn.sweepObservations.length===1,'AMZN is one sweep observation, with no invented recovery');
 await sourceLine(amzn.sweepObservations[0].source);
 await page.getByText('+299.47%',{exact:true}).waitFor();
 await screenshot('06-amzn-single-scan');

 await page.getByRole('link',{name:'Token research'}).click();
 await page.waitForURL('**/execution-review');
 await page.getByRole('heading',{name:'Research a token before deciding.'}).waitFor();
 await page.getByRole('textbox',{name:'Search instruments'}).fill('AAOIB');
 await page.getByRole('region',{name:'Instrument evidence table'}).getByRole('cell',{name:'AAOIB',exact:true}).waitFor();
 assert((await page.getByText('A listed token may be unavailable to your wallet.',{exact:false}).count())>0,'Token research distinguishes discovery from trade access');
 await screenshot('07-token-research');

 await page.getByRole('link',{name:'Plan and exit'}).click();
 await page.waitForURL('**/portfolio-exit');
 await page.getByRole('heading',{name:'Plan around your cash needs.'}).waitFor();
 assert((await page.locator('.balance-emphasis').innerText()).includes('2,780.00'),'Illustrative plan protects 1,200 USDT and 20 USDT before allocation');
 await page.getByLabel('Additional commitment in USDT').fill('200');
 await page.getByRole('button',{name:'Preview allocation'}).click();
 await page.locator('.balance-emphasis').getByText('2,580.00',{exact:false}).waitFor();
 assert((await page.locator('.balance-caption').innerText()).includes('ILLUSTRATIVE'),'Plan labels scenario cash as illustrative');
 await screenshot('08-protected-cash-plan');
 await page.getByRole('button',{name:'Estimate cash available'}).click();
 await page.getByText('Uncovered amount').waitFor();
 await screenshot('09-cash-need');

 assert(errors.length===0,'No browser runtime errors');
 assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'No desktop horizontal overflow');
 await writeFile(new URL('report.json',output),JSON.stringify({checkedAt:new Date().toISOString(),origin,checks,screenshots:10},null,2));
 console.log(JSON.stringify({passed:true,checks,output:new URL('report.json',output).pathname.slice(1)},null,2));
}finally{await browser.close();}
