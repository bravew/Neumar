import { describe, expect, it } from 'vitest';

import { renderReferenceProgressMarkdown } from '@/shared/video/reference/progress-markdown';
import type { ReferenceRun } from '@/shared/video/types';

describe('renderReferenceProgressMarkdown', () => {
  it('photographs the current ledger', () => {
    const run: ReferenceRun = {
      id: 'run-1',
      referenceId: 'ref-1',
      status: 'running',
      revision: 4,
      sequence: 6,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:10.000Z',
      focus: { text: 'caption entry', revision: 1 },
      steps: [
        {
          id: 'fetch',
          owner: 'system',
          status: 'done',
          startedAt: '2026-09-15T00:00:00.000Z',
          endedAt: '2026-09-15T00:00:01.000Z',
          producedArtifactIds: ['media/source.mp4'],
          note: 'Archive already acquired. Fetch not repeated.',
        },
        {
          id: 'transcribe',
          owner: 'system',
          status: 'error',
          producedArtifactIds: [],
          error: { code: 'step-failed', message: 'whisper missing' },
        },
      ],
    };
    const markdown = renderReferenceProgressMarkdown(run);
    expect(markdown).toContain('# Reference analysis');
    expect(markdown).toContain('`run-1`');
    expect(markdown).toContain('caption entry');
    expect(markdown).toContain('### fetch (`done`)');
    expect(markdown).toContain('whisper missing');
    expect(markdown).toMatchSnapshot();
  });
});
