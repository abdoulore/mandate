import './smoke-output.mjs';
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const routes=['/','/regime','/execution-review','/portfolio-exit','/overview','/portfolio','/plans','/instruments','/withdraw','/lab','/cash-raising','/inflows','/recurring','/passports','/saved-evidence-lab'];
const browser=await chromium.launch({channel:'msedge',headless:true});
const findings=[];
const screenshotDirectory='.runtime/outputs/ux-audit';
await mkdir(screenshotDirectory,{recursive:true});
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const route of routes){
   errors.length=0;
   const response=await page.goto(origin+route,{waitUntil:'networkidle',timeout:90000});
   const heading=await page.locator('h1').first().textContent();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   if(['/', '/regime', '/execution-review', '/portfolio-exit'].includes(route))await page.screenshot({path:`${screenshotDirectory}/${viewport.width}-${route==='/'?'landing':route.slice(1)}.png`,fullPage:true});
   if(route==='/execution-review'){
    const table=page.getByRole('region',{name:'Instrument evidence table'});
    const initialRows=await table.locator('tbody tr').count();
    if(initialRows>8)throw new Error(`Token research initially showed ${initialRows} rows`);
    await page.getByRole('textbox',{name:'Search instruments'}).fill('AAOIB');
    await table.getByRole('cell',{name:'AAOIB',exact:true}).waitFor();
   }
   findings.push({viewport:viewport.width,route,status:response?.status(),heading,overflow,errors:[...errors]});
  }
  await page.close();
 }
}finally{await browser.close();}
for(const row of findings)console.log(`${row.viewport} ${row.route} ${row.status} ${JSON.stringify(row.heading)}${row.overflow?' OVERFLOW':''}${row.errors.length?' ERRORS '+row.errors.join('; '):''}`);
if(findings.some(row=>row.status!==200||row.overflow||row.errors.length))process.exitCode=1;
