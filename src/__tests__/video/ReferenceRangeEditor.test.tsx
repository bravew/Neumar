import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceRangeEditor } from '@/components/video/reference/ReferenceRangeEditor';
import type { VideoReference } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          range: {
            previewUnavailable:
              "Preview isn't available for this format — use the in/out fields below.",
            inLabel: 'In',
            outLabel: 'Out',
            useCurrentTime: 'Use current time',
            capNote: 'Up to {minutes} minutes can be analyzed at once.',
            invalidOrder: 'The out point must be after the in point.',
            invalidBounds: 'The range must stay within the source video.',
            tooLong: 'This range is longer than the analysis limit.',
            save: 'Save range',
            saving: 'Saving…',
            saveSuccess: 'Analysis range updated.',
            saveError: 'Could not save the range: {error}',
            noProject: 'No active project.',
          },
        },
      },
    },
  }),
}));

function reference(overrides: Partial<VideoReference> = {}): VideoReference {
  return {
    id: 'ref-1',
    label: 'Reference clip',
    origin: 'link',
    mediaPath: 'references/ref-1/media/analysis.mp4',
    contentHash: 'hash',
    durationMs: 600_000,
    rights: { studyAcknowledged: true, reuseAcknowledged: false },
    artifactIds: [],
    createdAt: '2026-09-15T00:00:00.000Z',
    sourceMediaPath: 'references/ref-1/media/clip.mp4',
    sourceDurationMs: 995_000,
    analysisRange: { startMs: 0, endMs: 600_000 },
    ...overrides,
  };
}

describe('ReferenceRangeEditor', () => {
  it('shows a preview for a playable format and pre-fills the stored range', () => {
    render(
      <ReferenceRangeEditor
        projectId="project-1"
        reference={reference()}
        disabled={false}
        onSetRange={vi.fn()}
      />,
    );
    expect(document.querySelector('video')).not.toBeNull();
    expect(screen.getByDisplayValue('0')).toBeTruthy();
    expect(screen.getByDisplayValue('600')).toBeTruthy();
  });

  it('hides the preview and explains why for a non-playable format', () => {
    render(
      <ReferenceRangeEditor
        projectId="project-1"
        reference={reference({
          sourceMediaPath: 'references/ref-1/media/clip.mov',
        })}
        disabled={false}
        onSetRange={vi.fn()}
      />,
    );
    expect(document.querySelector('video')).toBeNull();
    expect(
      screen.getByText(/Preview isn't available for this format/),
    ).toBeTruthy();
  });

  it('disables Save and explains why when the range is too long', async () => {
    const user = userEvent.setup();
    render(
      <ReferenceRangeEditor
        projectId="project-1"
        reference={reference({
          sourceDurationMs: 1_000_000,
          analysisRange: { startMs: 0, endMs: 600_000 },
        })}
        disabled={false}
        onSetRange={vi.fn()}
      />,
    );
    const outInput = screen.getByDisplayValue('600');
    await user.clear(outInput);
    await user.type(outInput, '900');
    expect(screen.getByText(/longer than the analysis limit/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save range' })).toBeDisabled();
  });

  it('saves the picked range and reports success', async () => {
    const user = userEvent.setup();
    const onSetRange = vi.fn().mockResolvedValue(reference());
    render(
      <ReferenceRangeEditor
        projectId="project-1"
        reference={reference()}
        disabled={false}
        onSetRange={onSetRange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save range' }));
    expect(onSetRange).toHaveBeenCalledWith('ref-1', {
      startMs: 0,
      endMs: 600_000,
    });
    expect(await screen.findByText('Analysis range updated.')).toBeTruthy();
  });
});
