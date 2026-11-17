import { describe, expect, it } from 'vitest';

import {
  ArtifactUpdatePayloadSchema,
  CustomEventName,
  JsonPatchSchema,
  SubagentFinishedPayloadSchema,
  SubagentStartedPayloadSchema,
  parseCustomEventValue,
} from '@/shared/services/ag-ui/event-schema';

describe('event-schema', () => {
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
    expect(
      parseCustomEventValue(CustomEventName.ArtifactUpdate, {
        runId: 'r',
        artifactId: 'a',
        mime: 'text/plain',
        uri: '/tmp/x',
      })?.kind,
    ).toBe('artifact_update');
    expect(parseCustomEventValue('unknown', {})).toBeNull();
    expect(
      parseCustomEventValue(CustomEventName.ArtifactUpdate, { bad: true }),
    ).toBeNull();
  });
});
