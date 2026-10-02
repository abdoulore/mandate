import {chromium} from '@playwright/test';

const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(origin+'/lab',{waitUntil:'networkidle',timeout:90000});

  const lab=page.getByLabel('Recorded and synthetic evidence inputs');
  await lab.getByRole('heading',{name:'Evidence inputs'}).waitFor();
  await lab.getByRole('button',{name:/NVDA issuer cost divergence/}).click();
  await lab.getByText('Recorded collector',{exact:true}).first().waitFor();
  await lab.getByText('Control to examine:',{exact:false}).waitFor();
  await lab.getByText('Recorded row 1',{exact:false}).click();
  if (!(await lab.innerText()).includes('data/cost-2026-09-20.jsonl:2')) throw new Error('Recorded source line missing');
  await lab.getByRole('button',{name:/Quote expires before authorization/}).click();
  await lab.getByRole('heading',{name:'Quote expires before authorization'}).waitFor();
  if ((await lab.locator('.replay-detail .replay-kind').innerText()).toLowerCase()!=='synthetic failure') throw new Error('Synthetic label missing');
  if (await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)) throw new Error('Mobile horizontal overflow');
  if (errors.length) throw new Error(errors.join('; '));
  console.log('Evidence Lab smoke passed: recorded provenance, synthetic separation and mobile layout.');
} finally {
  await browser.close();
}
