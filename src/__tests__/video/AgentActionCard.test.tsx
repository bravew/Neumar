import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AgentActionCard } from '@/components/video/AgentActionCard';
import type { AgentActionRecord } from '@/components/video/useAgentDock';

describe('AgentActionCard', () => {
  it('renders a compact timeline diff for timeline op actions', async () => {
    const user = userEvent.setup();
    const onRefine = vi.fn();
    render(
      <AgentActionCard
        action={action('applyTimelineOp', {
          op: {
            kind: 'clip.move',
            clipId: 'clip-1',
            from: { trackId: 'track-video', startMs: 0 },
            to: { trackId: 'track-video', startMs: 500 },
          },
        })}
        title="Apply timeline edit"
        labels={labels}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onRefine={onRefine}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Timeline diff')).toBeInTheDocument();
    expect(screen.getByText('clip.move')).toBeInTheDocument();
    expect(screen.getByText('clip-1')).toBeInTheDocument();
    expect(screen.getAllByText(/track-video/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: labels.refine }));

    expect(onRefine).toHaveBeenCalledOnce();
  });

  it('renders a batch timeline diff with ripple impact', () => {
    render(
      <AgentActionCard
        action={action('applyTimelineOps', {
          ops: [
            {
              kind: 'clip.removeTimeRange',
              trackId: 'track-video',
              startMs: 1000,
              endMs: 1600,
              magnetic: true,
            },
          ],
          rippleImpact: { downstreamClipCount: 2, shiftMs: -600 },
        })}
        title="Apply timeline edit batch"
        labels={labels}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onRefine={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('1 operations')).toBeInTheDocument();
    expect(screen.getByText('clip.removeTimeRange')).toBeInTheDocument();
    expect(screen.getByText(/2 downstream clips/)).toBeInTheDocument();
  });

  it('surfaces timeline conflicts and before/after frames', () => {
    const imageBase64 = 'ZnJhbWU=';
    render(
      <AgentActionCard
        action={action('applyTimelineOps', {
          ops: [
            {
              kind: 'clip.move',
              clipId: 'clip-1',
              from: { trackId: 'track-video', startMs: 0 },
              to: { trackId: 'track-video', startMs: 1000 },
            },
          ],
          conflicts: [
            {
              code: 'overlap',
              message: 'clip-1 would overlap clip-2',
            },
          ],
          timelineFrames: {
            before: [{ atMs: 0, imageBase64, w: 320, h: 180 }],
            after: [{ atMs: 1000, imageBase64, w: 320, h: 180 }],
          },
        })}
        title="Apply timeline edit batch"
        labels={labels}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onRefine={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('1 conflicts')).toBeInTheDocument();
    expect(screen.getAllByText(/clip-1 would overlap clip-2/).length).toBe(2);
    expect(screen.getByText('Before frames')).toBeInTheDocument();
    expect(screen.getByText('After frames')).toBeInTheDocument();
    expect(screen.getAllByAltText(/Frame at/)).toHaveLength(2);
  });

  it('collapses completed timeline edit batches by default', async () => {
    const user = userEvent.setup();
    render(
      <AgentActionCard
        action={action(
          'applyTimelineOps',
          {
            ops: [
              {
                kind: 'clip.setTransform',
                clipId: 'clip-1',
                trackId: 'track-video',
              },
            ],
          },
          { status: 'completed' },
        )}
        title="Apply timeline edit batch"
        labels={labels}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onRefine={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByText('Timeline diff')).not.toBeInTheDocument();
    expect(screen.queryByText(/"clipId":"clip-1"/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Apply timeline edit batch/ }),
    );

    expect(screen.getByText('Timeline diff')).toBeInTheDocument();
    expect(screen.getByText('clip.setTransform')).toBeInTheDocument();
    expect(screen.getByText(/"clipId":"clip-1"/)).toBeInTheDocument();
  });
});

function action(
  name: AgentActionRecord['name'],
  args: Record<string, unknown>,
  patch: Partial<AgentActionRecord> = {},
): AgentActionRecord {
  return {
    id: `${name}-1`,
    type: 'action',
    name,
    args,
    summary: 'Move the hook later.',
    requiresApproval: true,
    status: 'pending',
    ...patch,
  };
}

const labels = {
  accept: 'Accept',
  reject: 'Reject',
  refine: 'Refine',
  retry: 'Retry',
  cancel: 'Cancel',
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  rejected: 'Rejected',
  failed: 'Failed',
  cancelled: 'Cancelled',
  why: 'Why?',
  hideWhy: 'Hide why',
  considered: 'Considered',
  sourceClips: 'Sources',
  arguments: 'Arguments',
  timelineDiff: {
    title: 'Timeline diff',
    operation: 'Operation',
    clip: 'Clip',
    track: 'Track',
    marker: 'Marker',
    from: 'From',
    to: 'To',
    duration: 'Duration',
    batch: 'Batch',
    operations: '{count} operations',
    rippleImpact: 'Ripple impact',
    downstreamClips: '{count} downstream clips',
    shift: '{value} shift',
    milliseconds: '{value} ms',
    conflicts: 'Conflicts',
    conflictCount: '{count} conflicts',
    warnings: 'Warnings',
    beforeFrames: 'Before frames',
    afterFrames: 'After frames',
    frameAt: 'Frame at {value}',
    cacheHit: 'cached',
  },
};
