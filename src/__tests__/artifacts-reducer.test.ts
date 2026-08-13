import { describe, expect, it } from 'vitest';

import {
  applyArtifactEvent,
  applyDiffPatches,
  EMPTY_ARTIFACT_MAP,
  MAX_ARTIFACT_BYTES,
  reduceArtifactEvents,
} from '@/shared/artifacts/reducer';
import { isArtifactEvent } from '@/shared/types/artifact';
import type { ArtifactEvent, ArtifactSnapshot } from '@/shared/types/artifact';

function makeSnapshot(
  overrides: Partial<ArtifactSnapshot> = {},
): ArtifactSnapshot {
  return {
    id: 'a1',
    taskId: 't1',
    messageId: 'm1',
    kind: 'html',
    title: 'demo',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    content: '',
    ...overrides,
  };
}

describe('applyArtifactEvent', () => {
  it('creates an artifact', () => {
    const next = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot({ content: 'hello' }),
    });
    expect(next.get('a1')?.content).toBe('hello');
  });

  it('appends content when version is exactly +1', () => {
    let state = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot({ content: 'foo' }),
    });
    state = applyArtifactEvent(state, {
      type: 'artifact.append',
      id: 'a1',
      version: 2,
      chunk: 'bar',
    });
    expect(state.get('a1')?.content).toBe('foobar');
    expect(state.get('a1')?.version).toBe(2);
  });

  it('drops out-of-order append (returns same reference)', () => {
    const initial = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot({ content: 'foo' }),
    });
    const stale = applyArtifactEvent(initial, {
      type: 'artifact.append',
      id: 'a1',
      version: 5, // skipped versions — not allowed
      chunk: 'bar',
    });
    expect(stale).toBe(initial);
  });

  it('replace requires strictly newer version', () => {
    const initial = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot({ version: 3, content: 'old' }),
    });
    const same = applyArtifactEvent(initial, {
      type: 'artifact.replace',
      id: 'a1',
      version: 3,
      content: 'new',
    });
    expect(same).toBe(initial);

    const newer = applyArtifactEvent(initial, {
      type: 'artifact.replace',
      id: 'a1',
      version: 4,
      content: 'new',
    });
    expect(newer.get('a1')?.content).toBe('new');
    expect(newer.get('a1')?.version).toBe(4);
  });

  it('applies a full-document patch and round-trips', () => {
    const initial = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot({ version: 1, content: 'hello world' }),
    });
    const patched = applyArtifactEvent(initial, {
      type: 'artifact.patch',
      id: 'a1',
      version: 2,
      patches: [
        { op: 'eq', text: 'hello ' },
        { op: 'del', text: 'world' },
        { op: 'ins', text: 'there' },
      ],
    });
    expect(patched.get('a1')?.content).toBe('hello there');
  });

  it('drops a patch whose eq segment fails the integrity check', () => {
    const initial = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot({ content: 'hello world' }),
    });
    const result = applyArtifactEvent(initial, {
      type: 'artifact.patch',
      id: 'a1',
      version: 2,
      patches: [
        { op: 'eq', text: 'goodbye ' }, // doesn't match
        { op: 'ins', text: 'there' },
      ],
    });
    expect(result).toBe(initial);
  });

  it('delete removes the entry', () => {
    const initial = applyArtifactEvent(EMPTY_ARTIFACT_MAP, {
      type: 'artifact.create',
      artifact: makeSnapshot(),
    });
    const after = applyArtifactEvent(initial, {
      type: 'artifact.delete',
      id: 'a1',
    });
    expect(after.has('a1')).toBe(false);
  });

  it('ignores append/replace/patch for unknown ids', () => {
    const events: ArtifactEvent[] = [
      { type: 'artifact.append', id: 'missing', version: 2, chunk: 'x' },
      { type: 'artifact.replace', id: 'missing', version: 2, content: 'x' },
      {
        type: 'artifact.patch',
        id: 'missing',
        version: 2,
        patches: [{ op: 'ins', text: 'x' }],
      },
    ];
    const next = reduceArtifactEvents(EMPTY_ARTIFACT_MAP, events);
    expect(next).toBe(EMPTY_ARTIFACT_MAP);
  });
});

describe('applyDiffPatches', () => {
  it('returns null when patches do not cover the entire previous content', () => {
    expect(applyDiffPatches('hello', [{ op: 'eq', text: 'he' }])).toBeNull();
  });

  it('handles pure insertions onto empty input', () => {
    expect(applyDiffPatches('', [{ op: 'ins', text: 'new' }])).toBe('new');
  });

  it('rejects patches that would exceed MAX_ARTIFACT_BYTES', () => {
    const huge = 'x'.repeat(MAX_ARTIFACT_BYTES + 1);
    expect(applyDiffPatches('', [{ op: 'ins', text: huge }])).toBeNull();
  });
});

describe('isArtifactEvent', () => {
  it('accepts well-formed events', () => {
    expect(
      isArtifactEvent({
        type: 'artifact.create',
        artifact: makeSnapshot(),
      }),
    ).toBe(true);
  });

  it('accepts DesignMode discovery artifact kinds', () => {
    expect(
      isArtifactEvent({
        type: 'artifact.create',
        artifact: makeSnapshot({ kind: 'question-form' }),
      }),
    ).toBe(true);
    expect(
      isArtifactEvent({
        type: 'artifact.create',
        artifact: makeSnapshot({ kind: 'media-progress' }),
      }),
    ).toBe(true);
  });

  it('rejects unknown discriminators', () => {
    expect(isArtifactEvent({ type: 'message.delta', id: 'a1' })).toBe(false);
  });

  it('rejects malformed snapshots', () => {
    expect(
      isArtifactEvent({
        type: 'artifact.create',
        artifact: { ...makeSnapshot(), kind: 'unknown-kind' },
      }),
    ).toBe(false);
  });

  it('rejects null/non-object inputs', () => {
    expect(isArtifactEvent(null)).toBe(false);
    expect(isArtifactEvent('artifact.create')).toBe(false);
  });
});
