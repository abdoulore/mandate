import {chromium} from '@playwright/test';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/',{waitUntil:'networkidle',timeout:90000});
  await page.getByRole('heading',{name:'Know when buying gets expensive.'}).waitFor();
  const evidence=await page.locator('#evidence').innerText();
  if(!evidence.includes('+133.71%')||!evidence.includes('−0.05%'))throw new Error('Landing evidence is missing the recorded values.');
  if(!await page.locator('.landing-product-image img').evaluate(image=>image.complete&&image.naturalWidth>0))throw new Error('The real product image did not load.');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Landing page has horizontal overflow.');
  await page.getByRole('link',{name:'Explore cost history'}).first().click();
  await page.waitForURL('**/regime');
  await page.getByRole('heading',{name:'See when buying got expensive.'}).waitFor();
  if(errors.length)throw new Error(errors.join('; '));
  await page.close();
 }
 console.log('Landing smoke passed: evidence, product image, workspace navigation, desktop and mobile layout.');
}finally{await browser.close();}
