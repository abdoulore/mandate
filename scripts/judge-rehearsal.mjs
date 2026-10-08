// Read-only screenshot pack for the public product journey.
// The journey smoke separately verifies source hashes, mobile layout and route boundaries.
import './product-journey-smoke.mjs';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const output=new URL('../.runtime/judge-rehearsal/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
const captures=[
 ['00-landing','/',/Know what a tokenized stock really costs/],
 ['01-explore','/market',/Find a token worth understanding/],
 ['02-asset','/asset/SPYon',/^SPYon$/],
 ['04-plan','/plan/SPYon',/Buy or sell SPYon/],
 ['05-portfolio','/portfolio',/Plan from your real balance/],
 ['06-activity','/activity',/Review what happened/],
 ['07-proof','/proof',/One small trade, fully accounted for/],
];
try{
 for(const [name,path,heading] of captures){
  const response=await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:90000});
  if(response?.status()!==200)throw new Error(`${path} returned ${response?.status()}`);
  await page.getByRole('heading',{name:heading}).first().waitFor();
  if(name==='01-explore')await page.getByRole('link',{name:'Inspect SPYon'}).waitFor();
  if(name==='02-asset')await page.getByRole('link',{name:'Check SPYon route'}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL(name+'.png',output))});
 }
 await page.goto(origin+'/asset/NVDAon#history',{waitUntil:'domcontentloaded'});
 await page.getByRole('tab',{name:'Cost history'}).waitFor();
 await page.locator('.asset-history-summary').scrollIntoViewIfNeeded();
 await page.screenshot({path:fileURLToPath(new URL('03-history.png',output))});
 await writeFile(new URL('report.json',output),JSON.stringify({checkedAt:new Date().toISOString(),origin,readOnly:true,screenshots:8,receiptProof:'VERIFIED-PILOT.md'},null,2));
 console.log(`Judge rehearsal passed; eight screenshots and report saved to ${fileURLToPath(output)}`);
}finally{await browser.close();}
