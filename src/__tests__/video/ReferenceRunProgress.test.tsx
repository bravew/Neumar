import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceRunProgress } from '@/components/video/reference/ReferenceRunProgress';
import type { VideoReferenceRun } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          steps: {
            fetch: 'Fetch',
            probe: 'Probe',
            transcribe: 'Transcribe',
            pack: 'Pack transcript',
            boundaries: 'Boundaries',
            sample: 'Sample',
            read: 'Read',
            extract: 'Extract',
          },
          status: {
            queued: 'Queued',
            running: 'Running',
            done: 'Done',
            error: 'Error',
            cancelled: 'Cancelled',
            skipped: 'Skipped',
          },
        },
      },
    },
  }),
}));

const run: VideoReferenceRun = {
  id: 'run-1',
  referenceId: 'ref-1',
  status: 'error',
  revision: 2,
  sequence: 3,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:05.000Z',
  steps: [
    {
      id: 'fetch',
      owner: 'system',
      status: 'done',
      producedArtifactIds: ['media'],
      startedAt: '2026-09-15T00:00:00.000Z',
      endedAt: '2026-09-15T00:00:01.000Z',
    },
    {
      id: 'transcribe',
      owner: 'system',
      status: 'error',
      producedArtifactIds: [],
      error: { code: 'step-failed', message: 'whisper missing' },
    },
    {
      id: 'read',
      owner: 'agent',
      status: 'queued',
      producedArtifactIds: [],
    },
  ],
};

describe('ReferenceRunProgress', () => {
  it('renders each status and keeps a step error visible', () => {
    render(<ReferenceRunProgress run={run} />);
    expect(screen.getByText('Fetch')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Transcribe')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('whisper missing')).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
  });
});
