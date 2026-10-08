import {spawn} from 'node:child_process';

if(process.env.NODE_ENV!=='production')throw new Error('Start this supervisor with NODE_ENV=production.');
const origin=new URL(process.env.MANDATE_APP_ORIGIN||'http://invalid.local');
if(origin.protocol!=='https:')throw new Error('MANDATE_APP_ORIGIN must be the public HTTPS origin.');
if((process.env.MANDATE_SESSION_SECRET||'').length<32)throw new Error('MANDATE_SESSION_SECRET must be at least 32 characters.');
if(!process.env.MANDATE_DATABASE_URL)throw new Error('MANDATE_DATABASE_URL is required for a production PostgreSQL ledger.');

const apiPort=Number(process.env.MANDATE_API_PORT||4110);
const webPort=Number(process.env.PORT||3110);
if(!Number.isInteger(apiPort)||apiPort<1||apiPort>65535||!Number.isInteger(webPort)||webPort<1||webPort>65535)throw new Error('Invalid service port.');

const api=spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{stdio:'inherit',env:process.env});
let web;
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of [api,web])if(child&&!child.killed)child.kill();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
for(const child of [api]){
 child.on('error',error=>{console.error(error);stop();process.exitCode=1;});
 child.on('exit',code=>{if(!stopping){console.error(`API exited: ${code}`);stop();process.exitCode=code||1;}});
}

let ready=false;
for(let attempt=0;attempt<40;attempt++){
 if(api.exitCode!==null)break;
 try{const response=await fetch(`http://127.0.0.1:${apiPort}/v1/health`,{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,500));
}
if(!ready){stop();throw new Error('Mandate API did not become ready.');}
web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','--hostname','0.0.0.0','--port',String(webPort)],{stdio:'inherit',env:{...process.env,MANDATE_PRODUCTION_BUILD:'1'}});
web.on('error',error=>{console.error(error);stop();process.exitCode=1;});
web.on('exit',code=>{if(!stopping){console.error(`Web exited: ${code}`);stop();process.exitCode=code||1;}});
