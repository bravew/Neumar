import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ArtifactEventSchema,
  publishArtifactAppend,
  publishArtifactCreate,
  publishArtifactDelete,
  publishArtifactPatch,
  publishArtifactReplace,
} from '@/shared/services/artifact-events';
import { taskEventBus } from '@/shared/services/task-event-bus';

describe('artifact-events Zod schema', () => {
  it('accepts a well-formed create event', () => {
    const result = ArtifactEventSchema.safeParse({
      type: 'artifact.create',
      artifact: {
        id: 'a1',
        taskId: 't1',
        messageId: 'm1',
        kind: 'html',
        title: 't',
        version: 1,
        createdAt: 0,
        updatedAt: 0,
        content: '',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects extra keys (strictObject)', () => {
    const result = ArtifactEventSchema.safeParse({
      type: 'artifact.delete',
      id: 'a1',
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown kinds', () => {
    const result = ArtifactEventSchema.safeParse({
      type: 'artifact.create',
      artifact: {
        id: 'a1',
        taskId: 't1',
        messageId: 'm1',
        kind: 'pdf',
        title: 't',
        version: 1,
        createdAt: 0,
        updatedAt: 0,
        content: '',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts DesignMode discovery artifact kinds', () => {
    const result = ArtifactEventSchema.safeParse({
      type: 'artifact.create',
      artifact: {
        id: 'q1',
        taskId: 't1',
        messageId: 'm1',
        kind: 'direction-picker',
        title: 'Directions',
        version: 1,
        createdAt: 0,
        updatedAt: 0,
        content: '{"directions":[]}',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative or fractional versions on append', () => {
    expect(
      ArtifactEventSchema.safeParse({
        type: 'artifact.append',
        id: 'a1',
        version: -1,
        chunk: '',
      }).success,
    ).toBe(false);
    expect(
      ArtifactEventSchema.safeParse({
        type: 'artifact.append',
        id: 'a1',
        version: 1.5,
        chunk: '',
      }).success,
    ).toBe(false);
  });
});

describe('publish helpers', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    publishSpy = vi.spyOn(taskEventBus, 'publish').mockImplementation(() => {});
  });

  afterEach(() => {
    publishSpy.mockRestore();
  });

  it('publishArtifactCreate stamps version 1 and timestamps', () => {
    const snap = publishArtifactCreate({
      taskId: 't1',
      messageId: 'm1',
      id: 'a1',
      kind: 'mermaid',
      title: 'graph',
    });
    expect(snap.version).toBe(1);
    expect(snap.content).toBe('');
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0]?.[0]).toBe('t1');
  });

  it('append/replace/patch/delete forward through the bus', () => {
    publishArtifactAppend('t1', 'a1', 2, 'chunk');
    publishArtifactReplace('t1', 'a1', 3, 'whole');
    publishArtifactPatch('t1', 'a1', 4, [{ op: 'ins', text: 'x' }]);
    publishArtifactDelete('t1', 'a1');
    expect(publishSpy).toHaveBeenCalledTimes(4);
  });

  it('drops malformed events instead of throwing', () => {
    // @ts-expect-error — intentional bad input
    publishArtifactCreate({
      taskId: 't1',
      messageId: 'm1',
      id: '',
      kind: 'html',
      title: '',
    });
    // empty id fails .min(1) — bus must not be called
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
