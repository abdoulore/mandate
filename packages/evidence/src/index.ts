import {z} from 'zod';
import scenarios from './replay-scenarios.json';

const timestamp=z.string().datetime();
const sourceSchema=z.object({
 file:z.string().regex(/^data\/(?:cost|sweep-all)-[^/]+\.jsonl$/),
 line:z.number().int().positive(),
 fileBytes:z.number().int().positive(),
 fileSha256:z.string().regex(/^[a-f0-9]{64}$/),
 lineSha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const recordedEventSchema=z.object({
 kind:z.literal('recorded_collector_row'),
 at:timestamp,
 source:sourceSchema,
 metricClass:z.enum(['derived_cost_metric','collector_sweep_summary']),
 storedCollectorRow:z.record(z.string(),z.unknown()),
 note:z.string().min(1),
}).strict();

const syntheticEventSchema=z.object({
 kind:z.literal('synthetic_failure'),
 at:timestamp,
 failure:z.enum(['quote_expired','source_timeout','ambiguous_submission','partial_settlement']),
 injectedState:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])),
 note:z.string().min(1),
}).strict();

const common=z.object({
 schemaVersion:z.literal('1.0.0'),
 id:z.string().regex(/^[a-z0-9-]+$/),
 title:z.string().min(1),
 capturedAt:timestamp,
 question:z.string().min(1),
 expectedControl:z.string().min(1),
 limitations:z.array(z.string().min(1)).min(1),
 executionEnabled:z.literal(false),
}).strict();

export const replayScenarioSchema=z.discriminatedUnion('kind',[
 common.extend({kind:z.literal('recorded'),events:z.array(recordedEventSchema).min(1)}),
 common.extend({kind:z.literal('synthetic'),events:z.array(syntheticEventSchema).min(1)}),
]);
export type ReplayScenario=z.infer<typeof replayScenarioSchema>;
export const replayScenarios:readonly ReplayScenario[]=Object.freeze(z.array(replayScenarioSchema).parse(scenarios));
export function getReplayScenario(id:string):ReplayScenario|undefined{return replayScenarios.find(s=>s.id===id);}
