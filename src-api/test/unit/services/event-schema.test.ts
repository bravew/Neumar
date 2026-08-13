import { describe, expect, it } from 'vitest';

import {
  ArtifactUpdatePayloadSchema,
  CustomEventName,
  InterruptPayloadSchema,
  JsonPatchSchema,
  SubagentFinishedPayloadSchema,
  SubagentStartedPayloadSchema,
  parseCustomEventValue,
} from '@/shared/services/ag-ui/event-schema';

describe('event-schema', () => {
  it('round-trips an INTERRUPT payload', () => {
    const valid = {
      runId: 'run-1',
      parentRunId: null,
      taskId: 'task-1',
      approvalId: 'appr-1',
      kind: 'plan' as const,
      risk: 'high' as const,
      title: 'Approve plan',
      payload: { foo: 'bar' },
      resumeToken: 'tok',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(InterruptPayloadSchema.parse(valid).runId).toBe('run-1');
    expect(
      InterruptPayloadSchema.safeParse({ ...valid, kind: 'nope' }).success,
    ).toBe(false);
    expect(
      InterruptPayloadSchema.safeParse({ ...valid, risk: 'maybe' }).success,
    ).toBe(false);
  });

  it('round-trips an ARTIFACT_UPDATE payload', () => {
    const out = ArtifactUpdatePayloadSchema.parse({
      runId: 'r',
      artifactId: 'a',
      mime: 'text/plain',
      uri: '/tmp/x',
    });
    expect(out.parentArtifactId).toBeNull();
    expect(out.delta).toBe(false);
  });

  it('validates SUBAGENT_STARTED + FINISHED payloads', () => {
    expect(
      SubagentStartedPayloadSchema.safeParse({
        runId: 'r',
        parentRunId: 'p',
        childTaskId: 'c',
        agentProvider: 'claude',
        spawnedByToolUseId: 't',
      }).success,
    ).toBe(true);
    const fin = SubagentFinishedPayloadSchema.parse({
      runId: 'r',
      parentRunId: 'p',
      childTaskId: 'c',
      status: 'completed',
    });
    expect(fin.costUsd).toBe(0);
    expect(fin.tokensIn).toBe(0);
  });

  it('validates RFC-6902 JSON patch ops', () => {
    expect(
      JsonPatchSchema.safeParse([
        { op: 'add', path: '/foo', value: 1 },
        { op: 'remove', path: '/bar' },
      ]).success,
    ).toBe(true);
    expect(
      JsonPatchSchema.safeParse([{ op: 'copy', path: '/x' }]).success,
    ).toBe(false);
  });

  it('parseCustomEventValue dispatches by name', () => {
    const interrupt = {
      runId: 'r',
      parentRunId: null,
      taskId: 't',
      approvalId: 'a',
      kind: 'plan' as const,
      risk: 'low' as const,
      title: 'x',
      resumeToken: 'tk',
      expiresAt: new Date().toISOString(),
    };
    expect(
      parseCustomEventValue(CustomEventName.Interrupt, interrupt)?.kind,
    ).toBe('interrupt');
    expect(parseCustomEventValue('unknown', {})).toBeNull();
    expect(
      parseCustomEventValue(CustomEventName.Interrupt, { bad: true }),
    ).toBeNull();
  });
});
