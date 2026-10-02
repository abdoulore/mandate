// Integer arithmetic throughout. Scenario accounting uses six-decimal USDT
// units; transaction adapters must use each onchain token's actual decimals.
export function parseUnits(value:string, decimals:number):bigint {
  if (!Number.isInteger(decimals) || decimals<0 || decimals>36) throw new Error('Invalid decimals');
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('Invalid unsigned decimal amount');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>decimals) throw new Error('Amount exceeds token precision');
  return BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
}
export function formatUnits(value:bigint,decimals:number):string {
  const sign=value<0n?'-':'';const n=value<0n?-value:value; const scale=10n**BigInt(decimals);
  const fraction=(n%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
  return sign+(n/scale).toString()+(fraction?'.'+fraction:'');
}
export function allocate(total:bigint,weights:number[]):bigint[]{
  if(total<0n||weights.some(w=>!Number.isInteger(w)||w<=0)||weights.reduce((s,w)=>s+w,0)!==10000)throw new Error('Invalid allocation');
  const parts=weights.map(w=>total*BigInt(w)/10000n);
  const order=weights.map((w,i)=>({i,remainder:total*BigInt(w)%10000n})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
  let left=total-parts.reduce((s,x)=>s+x,0n);for(const item of order){if(left===0n)break;parts[item.i]+=1n;left--;}
  return parts;
}
