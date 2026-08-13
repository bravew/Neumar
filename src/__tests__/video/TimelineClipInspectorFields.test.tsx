import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClipNameField } from '@/components/video/clipInspector/TimelineClipInspectorFields';
import type { VideoTimelineClip } from '@/shared/types/video';

function effectClip(name?: string): VideoTimelineClip {
  return {
    id: 'clip-1',
    kind: 'effect',
    ...(name !== undefined ? { name } : {}),
    effectType: 'vivid-overlay',
    sourceRef: {
      kind: 'asset',
      assetId: 'vivid-overlay-preset:imported.lottie',
    },
    startMs: 0,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
  };
}

describe('ClipNameField', () => {
  it('uses imported overlay names only as a fallback', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClipNameField
        clip={effectClip()}
        displayName="Loading sand clock"
        label="Name"
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Loading sand clock');

    rerender(
      <ClipNameField
        clip={effectClip('Custom overlay')}
        displayName="Loading sand clock"
        label="Name"
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Custom overlay');
  });
});
