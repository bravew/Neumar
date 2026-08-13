// AG-UI 0.0.52 has no first-class INTERRUPT / ARTIFACT_UPDATE / SUBAGENT_*
// event types, so we ship them as EventType.CUSTOM with stable names.

import { EventType } from '@ag-ui/core';
import { z } from 'zod';

export { EventType };

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export const DEFAULT_RISK_LEVEL: RiskLevel = 'medium';

export const CustomEventName = {
  Interrupt: 'neuma.interrupt',
  ArtifactUpdate: 'neuma.artifact_update',
  SubagentStarted: 'neuma.subagent_started',
  SubagentFinished: 'neuma.subagent_finished',
  LegacyOnInterrupt: 'on_interrupt',
} as const;

// ─── INTERRUPT ────────────────────────────────────────────────────────

export const InterruptKindSchema = z.enum([
  'plan',
  'sensitive_fs',
  'external_action',
  'budget_override',
  'delegation',
  'automation_change',
]);
export type InterruptKind = z.infer<typeof InterruptKindSchema>;

export const InterruptPayloadSchema = z.object({
  runId: z.string().min(1),
  parentRunId: z.string().nullable().default(null),
  taskId: z.string().min(1),
  approvalId: z.string().min(1),
  kind: InterruptKindSchema,
  risk: RiskLevelSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  payload: z.unknown().optional(),
  resumeToken: z.string().min(1),
  expiresAt: z.string().min(1),
});
export type InterruptPayload = z.infer<typeof InterruptPayloadSchema>;

export const ArtifactUpdatePayloadSchema = z.object({
  runId: z.string().min(1),
  artifactId: z.string().min(1),
  mime: z.string().min(1),
  uri: z.string().min(1),
  parentArtifactId: z.string().nullable().default(null),
  delta: z.boolean().default(false),
});
export type ArtifactUpdatePayload = z.infer<typeof ArtifactUpdatePayloadSchema>;

export const SubagentStartedPayloadSchema = z.object({
  runId: z.string().min(1),
  parentRunId: z.string().min(1),
  childTaskId: z.string().min(1),
  agentProvider: z.string().min(1),
  spawnedByToolUseId: z.string().min(1),
});
export type SubagentStartedPayload = z.infer<
  typeof SubagentStartedPayloadSchema
>;

export const SubagentFinishedPayloadSchema = z.object({
  runId: z.string().min(1),
  parentRunId: z.string().min(1),
  childTaskId: z.string().min(1),
  status: z.enum(['completed', 'failed', 'cancelled']),
  costUsd: z.number().nonnegative().default(0),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
});
export type SubagentFinishedPayload = z.infer<
  typeof SubagentFinishedPayloadSchema
>;

/** RFC-6902 JSON Patch — used by STATE_DELTA. */
export const JsonPatchOpSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.string().min(1),
  value: z.unknown().optional(),
});
export const JsonPatchSchema = z.array(JsonPatchOpSchema);
export type JsonPatch = z.infer<typeof JsonPatchSchema>;

/** Returns null when the name isn't a known neuma custom-event payload. */
export function parseCustomEventValue(
  name: string,
  value: unknown,
):
  | { kind: 'interrupt'; payload: InterruptPayload }
  | { kind: 'artifact_update'; payload: ArtifactUpdatePayload }
  | { kind: 'subagent_started'; payload: SubagentStartedPayload }
  | { kind: 'subagent_finished'; payload: SubagentFinishedPayload }
  | null {
  switch (name) {
    case CustomEventName.Interrupt: {
      const parsed = InterruptPayloadSchema.safeParse(value);
      return parsed.success
        ? { kind: 'interrupt', payload: parsed.data }
        : null;
    }
    case CustomEventName.ArtifactUpdate: {
      const parsed = ArtifactUpdatePayloadSchema.safeParse(value);
      return parsed.success
        ? { kind: 'artifact_update', payload: parsed.data }
        : null;
    }
    case CustomEventName.SubagentStarted: {
      const parsed = SubagentStartedPayloadSchema.safeParse(value);
      return parsed.success
        ? { kind: 'subagent_started', payload: parsed.data }
        : null;
    }
    case CustomEventName.SubagentFinished: {
      const parsed = SubagentFinishedPayloadSchema.safeParse(value);
      return parsed.success
        ? { kind: 'subagent_finished', payload: parsed.data }
        : null;
    }
    default:
      return null;
  }
}
