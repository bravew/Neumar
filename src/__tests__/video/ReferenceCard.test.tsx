import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReferenceCard } from '@/components/video/reference/ReferenceCard';
import { useReferenceStudyStore } from '@/components/video/reference/useReferenceStudyStore';
import type { VideoReference, VideoReferenceRun } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          delete: 'Remove reference',
          deleteConfirm: 'Remove this reference and its analysis?',
          deleteKeep: 'Keep',
          analyze: 'Analyze',
          reanalyze: 'Re-analyze',
          cancel: 'Cancel',
          openResults: 'Open results',
          showSteps: 'Steps',
          hideSteps: 'Hide steps',
          blockedOn: 'Paused at {step}',
          unblock: 'Ask the agent to continue',
          unblockPending: 'Asked — waiting for the agent',
          range: {
            toggleShow: 'Set analysis range',
            toggleHide: 'Hide analysis range',
          },
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
            waiting: 'Waiting',
          },
          owner: {
            system: 'in this panel',
            agent: 'in chat',
          },
        },
      },
    },
  }),
}));

const reference: VideoReference = {
  id: 'ref-1',
  label: 'Reference clip',
  origin: 'upload',
  mediaPath: 'ref.mp4',
  contentHash: 'hash',
  durationMs: 8000,
  rights: { studyAcknowledged: true, reuseAcknowledged: false },
  artifactIds: [],
  createdAt: '2026-09-15T00:00:00.000Z',
};

function parkedRun(): VideoReferenceRun {
  return {
    id: 'run-1',
    referenceId: reference.id,
    status: 'waiting',
    revision: 1,
    sequence: 1,
    steps: [
      {
        id: 'read',
        owner: 'agent',
        status: 'waiting',
        producedArtifactIds: [],
        note: 'Needs video_reference_write_analysis.',
      },
    ],
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}

describe('ReferenceCard', () => {
  afterEach(() => {
    useReferenceStudyStore.getState().setAgentStreaming(false);
  });

  it('disables Re-analyze while a run is parked waiting on input', () => {
    render(
      <ReferenceCard
        projectId="project-1"
        reference={reference}
        run={parkedRun()}
        active={false}
        actionsEnabled
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onOpenResults={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onUnblock={vi.fn()}
        onSetAnalysisRange={vi.fn()}
      />,
    );
    // A parked run still needs the agent to clear the block; re-analyzing
    // instead used to start a fresh run and silently discard the parked one.
    expect(screen.getByRole('button', { name: /Re-analyze/ })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Ask the agent to continue' }),
    ).toBeEnabled();
  });

  it('shows the ask-agent control as pending once a turn is streaming', () => {
    useReferenceStudyStore.getState().setAgentStreaming(true);
    render(
      <ReferenceCard
        projectId="project-1"
        reference={reference}
        run={parkedRun()}
        active={false}
        actionsEnabled
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onOpenResults={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onUnblock={vi.fn()}
        onSetAnalysisRange={vi.fn()}
      />,
    );
    // The control used to look identical whether or not the click had done
    // anything, so a user asking mid-turn had no sign the ask registered.
    expect(
      screen.getByRole('button', { name: /Asked — waiting for the agent/ }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Ask the agent to continue' }),
    ).toBeNull();
  });
});
