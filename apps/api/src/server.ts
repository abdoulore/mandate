import {createApp} from './app.ts';
import {directPilotConfigured} from './direct-pilot-access.ts';
const app=createApp();
await app.listen({host:'127.0.0.1',port:Number(process.env.MANDATE_API_PORT||4110)});
const pilot=directPilotConfigured();
console.log(`Mandate API ready at http://127.0.0.1:4110 (SPYon approval ${pilot.approvalEnabled?'enabled':'disabled'}, swap ${pilot.swapEnabled?'enabled':'disabled'})`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await app.close();process.exit(0);});
