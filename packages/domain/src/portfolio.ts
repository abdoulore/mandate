import {z} from 'zod';
const atomicSchema=z.string().regex(/^(0|[1-9]\d{0,77})$/);
export const exposureModelSchema=z.object({currency:z.literal('USD-nominal-USDT-parity'),legs:z.array(z.object({instrumentId:z.string().min(1).max(120),issuer:z.enum(['ondo','bstock']),underlying:z.string().min(1).max(20),valueAtomic:atomicSchema}).strict()).min(1).max(20)}).strict();
export type ExposureModel=z.infer<typeof exposureModelSchema>;
export type PendingExposure={reservationId:string;amountAtomic:string;planId:string;model:ExposureModel|null;submissionStarted:boolean};
export type MarketMark={contract:string;issuer:string;price:string;updatedAt:string};
export type MarketMarks={observedAt:string;items:MarketMark[];source:string};
export type ExposureLeg={instrumentId:string;symbol:string;issuer:string;underlying:string;valueAtomic:string};
export type PortfolioExposure={state:'KNOWN'|'UNKNOWN';decimals:18;currency:'USD-nominal-USDT-parity';checkedAt:string;scope:string;reasons:string[];positions:({contract:string;symbol:string;underlying:string;issuer:string;rawAtomic:string|null;decimals:number;valueAtomic:string|null;markState:'FRESH'|'STALE'|'UNKNOWN'|'ZERO';price:string|null;priceUpdatedAt:string|null})[];existing:ExposureLeg[];pending:ExposureLeg[];pendingCount:number;byIssuer:{issuer:string;existingAtomic:string;pendingAtomic:string}[];byUnderlying:{underlying:string;existingAtomic:string;pendingAtomic:string}[]};
