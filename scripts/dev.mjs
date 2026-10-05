import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let previewOrigin=process.env.MANDATE_APP_ORIGIN;
if(!previewOrigin){try{previewOrigin=readFileSync('.env','utf8').match(/^MANDATE_APP_ORIGIN=(.*)$/m)?.[1]?.trim();}catch{}}
const webEnv=previewOrigin?{...process.env,MANDATE_APP_ORIGIN:previewOrigin}:process.env;
const children=[spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','apps/api/src/server.ts'],{stdio:'inherit'}),spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','apps/web','--hostname','127.0.0.1','--port','3110'],{stdio:'inherit',env:webEnv})];
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const c of children)c.kill();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
for(const c of children){c.on('error',e=>{console.error(e.message);stop();process.exitCode=1;});c.on('exit',code=>{if(!stopping){stop();process.exitCode=code||0;}});}
