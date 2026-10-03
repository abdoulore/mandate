import {createApp} from './app.ts';
const app=createApp();
await app.listen({host:'127.0.0.1',port:Number(process.env.MANDATE_API_PORT||4110)});
console.log(`Mandate API ready at http://127.0.0.1:4110 (SPYon direct pilot ${process.env.MANDATE_DIRECT_EXECUTION_ENABLED==='true'?'enabled':'disabled'})`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await app.close();process.exit(0);});
