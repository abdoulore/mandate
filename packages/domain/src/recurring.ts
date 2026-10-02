import {z} from 'zod';

export const recurringScheduleInputSchema=z.object({requestId:z.string().uuid(),intervalSeconds:z.number().int().min(60).max(2592000),scenario:z.enum(['normal','expensive','missing']),startsAt:z.string().datetime().optional()}).strict();
export type RecurringScheduleInput=z.infer<typeof recurringScheduleInputSchema>;
export const recurringChangeSchema=z.object({scheduleId:z.string().uuid(),expectedRevision:z.number().int().positive()}).strict();
export type RecurringChange=z.infer<typeof recurringChangeSchema>;
export type RecurringSchedule={id:string;accountId:string;wallet:string;requestId:string;status:'active'|'paused'|'revoked';revision:number;intervalSeconds:number;scenario:'normal'|'expensive'|'missing';startsAt:string;nextDueAt:string;createdAt:string;updatedAt:string;researchOnly:true;authority:'proposal-only'};
export type RecurringFiring={id:string;accountId:string;scheduleId:string;dueAt:string;requestId:string;attempts:number;state:'claimed'|'deferred'|'proposed'|'cancelled';proposalId:string|null;reason:string|null;createdAt:string;updatedAt:string};
export type RecurringClaim={schedule:RecurringSchedule;firing:RecurringFiring;leaseToken:string};
