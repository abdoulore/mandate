import './smoke-output.mjs';
import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('http://127.0.0.1:3110/passports',{waitUntil:'networkidle',timeout:90000});

 const panel=page.getByLabel('Sourced instrument passports');
 await panel.getByText(/of 14 match your research filters/).waitFor();
 const stale=await panel.getByText('0 of 14 match your research filters.',{exact:false}).isVisible();
 await panel.getByText(stale?'0 of 14 match your research filters.':'12 of 14 match your research filters.',{exact:false}).waitFor();
 await panel.getByRole('heading',{name:'AAOIB → AAOI'}).waitFor();
 if(await panel.getByRole('link',{name:'Primary source'}).count()!==5)throw new Error('Passport field sources missing');
 await panel.getByLabel('Choose a token').selectOption('TQQQon');
 await panel.locator('dd').filter({hasText:'Targets 3× the daily Nasdaq-100 return before fees; longer-period returns can differ.'}).waitFor();
 await panel.getByText('Excluded by research filters',{exact:true}).waitFor();
 await panel.getByLabel('Allow leveraged exposure').check();
 await panel.getByText(stale?'0 of 14 match your research filters.':'14 of 14 match your research filters.',{exact:false}).waitFor();
 await panel.getByLabel('Require direct share ownership').check();
 await panel.getByText('0 of 14 match your research filters.',{exact:false}).waitFor();
 await panel.getByLabel('Require direct share ownership').uncheck();
 await panel.getByLabel('Allow leveraged exposure').uncheck();
 await panel.getByLabel('Choose a token').selectOption('AAOIB');
 await panel.getByRole('heading',{name:`Token-to-underlying profile: ${stale?'STALE':'OBSERVED'}`}).waitFor();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);if(overflow)throw new Error('Mobile overflow');
 const output='.runtime/outputs';fs.mkdirSync(output,{recursive:true});
 await panel.screenshot({path:output+'/mandate-passports-mobile.png'});
 await page.setViewportSize({width:1440,height:1060});await panel.screenshot({path:output+'/mandate-passports-desktop.png'});
 if(errors.length)throw new Error(errors.join('; '));
 console.log('Passports smoke passed: live profiles, sourced facts, leverage/ownership filters, mobile layout.');
}finally{await browser.close();}
