import {chromium} from '@playwright/test';
import {performance} from 'node:perf_hooks';

const origin=process.env.MANDATE_SMOKE_ORIGIN||'http://127.0.0.1:3110';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
const results=[];
async function move(label,action,ready){const start=performance.now();await action();await ready();results.push({to:label,milliseconds:Math.round(performance.now()-start)});}
try{
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await move('Explore',()=>page.getByRole('link',{name:'Check the market'}).click(),()=>page.getByRole('link',{name:'Inspect SPYon'}).waitFor());
 await move('SPYon asset',()=>page.getByRole('link',{name:'Inspect SPYon'}).click(),()=>page.getByRole('link',{name:'Check SPYon route'}).waitFor());
 await move('SPYon plan',()=>page.getByRole('link',{name:'Check SPYon route'}).click(),()=>page.getByRole('button',{name:'Connect wallet'}).waitFor());
 await move('Portfolio',()=>page.getByRole('link',{name:'Portfolio',exact:true}).click(),()=>page.getByRole('heading',{name:'Plan from your real balance.'}).waitFor());
 await move('Activity',()=>page.getByRole('link',{name:'Activity',exact:true}).click(),()=>page.getByRole('heading',{name:'Review what happened.'}).waitFor());
 await move('Public receipt proof',()=>page.getByRole('link',{name:'inspect the verified SPYon pilot'}).click(),()=>page.getByRole('heading',{name:'One small trade, fully accounted for.'}).waitFor());
 if(results.some(result=>result.milliseconds>5000))throw new Error('A mobile page transition exceeded five seconds: '+JSON.stringify(results));
 console.log(JSON.stringify({origin,viewport:390,results},null,2));
}finally{await browser.close();}
