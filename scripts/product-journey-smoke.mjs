import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];
const results=[];
const check=(condition,message)=>{if(!condition)throw new Error(message);results.push(message);};
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(`${width}: ${error.message}`));
  const response=await page.goto(origin+'/',{waitUntil:'networkidle',timeout:90000});
  check(response?.status()===200,`${width}px landing loads`);
  await page.getByRole('heading',{name:/Know what a tokenized stock really costs/}).waitFor();
  await page.getByRole('link',{name:'Inspect the verified receipts'}).click();
  await page.waitForURL('**/proof');
  await page.getByRole('heading',{name:'One small trade, fully accounted for.'}).waitFor();
  check(await page.getByRole('link',{name:/View .* on BscScan/}).count()===4,`${width}px public pilot proof has four receipt links`);
  await page.getByRole('link',{name:'Explore',exact:true}).click();
  await page.waitForURL('**/market');
  await page.goto(origin+'/');
  await page.getByRole('heading',{name:/Know what a tokenized stock really costs/}).waitFor();
  await page.getByRole('link',{name:'Check the market'}).click();
  await page.waitForURL('**/market');
  await page.getByRole('link',{name:'Inspect SPYon'}).waitFor();
  const recordedPriceWarning=await page.getByText('Not a current buy quote').first().isVisible().catch(()=>false);
  const staleFrameWarning=await page.getByText(/Recorded market data is stale/).first().isVisible().catch(()=>false);
  const stalePricesHidden=await page.getByText('Stale frame hidden').count()>0;
  check(recordedPriceWarning||(staleFrameWarning&&stalePricesHidden),`${width}px recorded price is non-executable or stale prices are hidden`);
  await page.getByRole('textbox',{name:'Search tokens'}).fill('SPY');
  check(await page.getByRole('link',{name:'Inspect SPYon'}).count()===1,`${width}px market search works`);
  await page.getByRole('link',{name:'Inspect SPYon'}).click();
  await page.waitForURL('**/asset/SPYon');
  await page.getByRole('heading',{name:'SPYon',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Cost history'}).click();
  check(await page.getByRole('button',{name:'Explore full research history →'}).isVisible(),`${width}px deep history is behind disclosure`);
  check(await page.getByText('Recorded quotes are historical observations.').count()>0,`${width}px historical evidence is labelled`);
  await page.getByRole('tab',{name:'Token details'}).click();
  check(await page.getByText('0x6a708ead771238919d85930b5a0f10454e1c331a').count()>0,`${width}px sourced contract is visible`);
  await page.getByRole('link',{name:'Check SPYon route'}).click();
  await page.waitForURL('**/plan/SPYon');
  await page.getByRole('button',{name:'Connect wallet'}).waitFor();
  check(await page.getByRole('button',{name:'Connect wallet'}).count()>0,`${width}px pilot uses wallet-specific route`);
  await page.getByRole('link',{name:'Portfolio',exact:true}).click();
  await page.getByRole('heading',{name:'Plan from your real balance.'}).waitFor();
  await page.getByRole('link',{name:'Activity',exact:true}).click();
  await page.getByRole('heading',{name:'Review what happened.'}).waitFor();
  await page.getByText('Connect to see confirmed transactions',{exact:false}).waitFor();
  check(await page.getByText('Connect to see confirmed transactions').count()>0,`${width}px activity explains its wallet dependency`);
  check(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${width}px no horizontal overflow`);
  await page.goto(origin+'/asset/NVDAon#history',{waitUntil:'networkidle'});
  await page.getByRole('tab',{name:'Cost history'}).waitFor();
  await page.getByRole('button',{name:'Explore full research history →'}).click();
  const responseHistory=await (await page.request.get(origin+'/api/v1/regime?token=NVDA&platform=ondo')).json();
  const first=responseHistory.points.find(point=>point.ts.startsWith('2026-09-20T16:45:'));
  const second=responseHistory.points.find(point=>point.ts.startsWith('2026-09-20T17:00:'));
  check(first&&second&&first.pct>133.7&&first.pct<133.72&&second.pct<0&&second.pct>-.06,`${width}px source-backed NVDA reversal remains available`);
  for(const point of [first,second]){
   const source=point.source;
   const lines=(await readFile(new URL('../'+source.file,import.meta.url),'utf8')).split('\n');
   check(createHash('sha256').update(lines[source.line-1]).digest('hex')===source.sha256,`${width}px source hash matches ${source.file}:${source.line}`);
  }
  await page.close();
 }
 check(errors.length===0,'no browser runtime errors');
 console.log(JSON.stringify({passed:true,origin,checks:results},null,2));
}finally{await browser.close();}
