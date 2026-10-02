import {chromium} from '@playwright/test';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/instruments',async route=>{
   const response=await route.fetch();
   const catalogue=await response.json();
   catalogue.stale=true;
   catalogue.collectorStaleMs=31*60*1000;
   catalogue.completeIssuers=false;
   catalogue.issuerStates=catalogue.issuerStates.map(state=>({...state,state:'UNKNOWN'}));
   catalogue.items=catalogue.items.map(item=>({...item,tokenPrice:null,marketDataState:'UNKNOWN'}));
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalogue)});
  });
  await page.goto(origin+'/execution-review',{waitUntil:'networkidle',timeout:90000});
  await page.getByText('Collector data is stale.',{exact:true}).waitFor();
  const table=page.getByRole('region',{name:'Instrument evidence table'});
  await table.getByRole('cell',{name:'Unknown',exact:true}).first().waitFor();
  if(errors.length)throw new Error(errors.join('; '));
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error(`${viewport.width}px horizontal overflow`);
  await page.close();
 }
 console.log('Collector stale UI passed at desktop and phone widths: stale notice, unknown prices, no browser errors or overflow.');
}finally{await browser.close();}
