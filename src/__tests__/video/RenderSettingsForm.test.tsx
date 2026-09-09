import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import {
  RenderSettingsForm,
  type RenderSettingsSetters,
} from '@/components/video/preview/RenderSettingsForm';
import type { VideoProject } from '@/shared/types/video';

describe('RenderSettingsForm', () => {
  it('locks an unset timebase to the timeline resolved rate', () => {
    const onSetTimebase = vi.fn();

    renderWithProviders(
      <RenderSettingsForm
        project={projectFixture()}
        cloudProviders={[]}
        state={{
          renderWhere: 'local',
          renderProviderId: '',
          cloudEgressConfirmed: false,
          loudnessTargetLufs: 'off',
          autoColor: false,
          autoReframe: false,
          captionMode: 'off',
        }}
        setters={setters()}
        renderBlocked={false}
        onSetTimebase={onSetTimebase}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Lock frame rate' }));

    expect(onSetTimebase).toHaveBeenCalledWith('23.976', true);
  });
});

function setters(): RenderSettingsSetters {
  return {
    setRenderWhere: vi.fn(),
    setRenderProviderId: vi.fn(),
    setCloudEgressConfirmed: vi.fn(),
    setLoudnessTargetLufs: vi.fn(),
    setAutoColor: vi.fn(),
    setAutoReframe: vi.fn(),
    setCaptionMode: vi.fn(),
  };
}

function projectFixture(): VideoProject {
  return {
    id: 'project-23976',
    name: '23.976 timeline',
    template: 'custom',
    prompt: '',
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 10_000,
      fps: 23.976,
      frameRate: { num: 24_000, den: 1001 },
      tracks: [],
    },
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  };
}
