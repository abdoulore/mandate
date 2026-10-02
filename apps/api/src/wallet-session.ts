import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {verifyMessage} from 'viem';
import {z} from 'zod';

const addressSchema=z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const signatureSchema=z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const TTL_MS=90_000,SESSION_SECONDS=12*60*60;
type Challenge={address:string;message:string;origin:string;expiresAt:number};
type Session={address:string;issuedAt:number;expiresAt:number;origin:string};

function encode(value:unknown){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function cookieToken(value:Session,secret:string){const body=encode(value),mac=createHmac('sha256',secret).update(body).digest('base64url');return body+'.'+mac;}
function decodeToken(value:string,secret:string):Session|null{
 const [body,mac,extra]=value.split('.');if(!body||!mac||extra!==undefined)return null;
 const expected=createHmac('sha256',secret).update(body).digest();let provided:Buffer;
 try{provided=Buffer.from(mac,'base64url');}catch{return null;}
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return null;
 try{const session=JSON.parse(Buffer.from(body,'base64url').toString()) as Session;
  if(typeof session.address!=='string'||!addressSchema.safeParse(session.address).success||!Number.isInteger(session.issuedAt)||!Number.isInteger(session.expiresAt)||session.expiresAt<=Date.now()||session.origin!==appOrigin())return null;
  return session;
 }catch{return null;}
}
function appOrigin(){const configured=process.env.MANDATE_APP_ORIGIN||'http://127.0.0.1:3110',url=new URL(configured);if(process.env.NODE_ENV==='production'&&url.protocol!=='https:')throw new Error('Set MANDATE_APP_ORIGIN to the HTTPS production origin.');return url.origin;}
function sessionSecret(){const supplied=process.env.MANDATE_SESSION_SECRET;if(supplied&&supplied.length>=32)return supplied;if(process.env.NODE_ENV==='production')throw new Error('Set MANDATE_SESSION_SECRET to at least 32 characters in production.');return localSecret;}
const localSecret=randomBytes(32).toString('hex');
const challenges=new Map<string,Challenge>();
const rate=new Map<string,{minute:number;count:number}>();
export type WalletContext={address:string;chainId:56;expiresAt:number};
export type ChallengeResult={id:string;address:string;message:string;expiresAt:number};
export class WalletSessionError extends Error{constructor(public statusCode:number,public code:string){super(code);}}
function reject(status:number,code:string):never{throw new WalletSessionError(status,code);}

export function createWalletSessionService(){
 const secret=sessionSecret(),origin=appOrigin(),cookieName='mandate_session';
 function requireOrigin(candidate:string|undefined){if(!candidate||candidate!==origin)reject(403,'ORIGIN_NOT_ALLOWED');}
 function parseSession(header:string|undefined){
  const raw=header?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!raw)return null;try{return decodeToken(decodeURIComponent(raw),secret);}catch{return null;}
 }
 function serialize(session:Session){return `${cookieName}=${encodeURIComponent(cookieToken(session,secret))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV==='production'?'; Secure':''}`;}
 function clearCookie(){return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;}
 function sweep(now:number){for(const [id,c] of challenges)if(c.expiresAt<=now)challenges.delete(id);for(const [ip,c] of rate)if(c.minute<Math.floor(now/60000)-2)rate.delete(ip);}
 return {
  issue(addressInput:unknown,chainInput:unknown,originHeader:string|undefined,ip:string):ChallengeResult{
   requireOrigin(originHeader);let address:string;try{address=addressSchema.parse(addressInput);}catch{reject(400,'INVALID_ADDRESS');}if(chainInput!==56)reject(400,'UNSUPPORTED_CHAIN');
   const now=Date.now();sweep(now);const minute=Math.floor(now/60000),bucket=rate.get(ip)||{minute,count:0};if(bucket.minute!==minute){bucket.minute=minute;bucket.count=0;}if(++bucket.count>20)reject(429,'CHALLENGE_RATE_LIMIT');if(rate.size>=4096&&!rate.has(ip))reject(503,'CHALLENGE_CAPACITY');rate.set(ip,bucket);
   if(challenges.size>=4096)reject(503,'CHALLENGE_CAPACITY');
   const id=randomBytes(24).toString('base64url'),expiresAt=now+TTL_MS,issuedAt=new Date(now).toISOString(),expirationTime=new Date(expiresAt).toISOString();
   const message=[
    'Mandate read-only wallet sign-in',
    `Origin: ${origin}`,
    `Address: ${address.toLowerCase()}`,
    'Chain ID: 56 (BNB Smart Chain)',
    `Nonce: ${id}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
    'Purpose: Prove wallet ownership for a read-only Mandate session.',
    'This signature cannot authorize a token approval, transfer, or transaction.'
   ].join('\n');
   challenges.set(id,{address:address.toLowerCase(),message,origin,expiresAt});return {id,address, message,expiresAt};
  },
  async verify(idInput:unknown,signatureInput:unknown,originHeader:string|undefined){
   requireOrigin(originHeader);let id:string,signature:string;try{id=z.string().min(30).max(80).parse(idInput);signature=signatureSchema.parse(signatureInput);}catch{reject(400,'INVALID_CHALLENGE');}
   const challenge=challenges.get(id);challenges.delete(id);
   if(!challenge)return reject(401,'CHALLENGE_EXPIRED');if(challenge.expiresAt<=Date.now())reject(401,'CHALLENGE_EXPIRED');if(challenge.origin!==origin)reject(403,'ORIGIN_NOT_ALLOWED');
   let valid=false;try{valid=await verifyMessage({address:challenge.address as `0x${string}`,message:challenge.message,signature:signature as `0x${string}`});}catch{valid=false;}
   if(!valid)reject(401,'SIGNATURE_INVALID');const now=Date.now(),session:Session={address:challenge.address,issuedAt:now,expiresAt:now+SESSION_SECONDS*1000,origin};
   return {address:session.address,chainId:56 as const,expiresAt:session.expiresAt,cookie:serialize(session)};
  },
  session(cookie:string|undefined,originHeader:string|undefined):WalletContext|null{
   if(originHeader)requireOrigin(originHeader);const session=parseSession(cookie);return session?{address:session.address,chainId:56,expiresAt:session.expiresAt}:null;
  },
  clearCookie,
 };
}
