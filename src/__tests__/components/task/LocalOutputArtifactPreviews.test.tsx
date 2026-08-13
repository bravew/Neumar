import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Artifact } from '@/components/artifacts/types';
import { LocalOutputArtifactPreviews } from '@/components/task/LocalOutputArtifactPreviews';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      task: {
        sourceAttachments: 'Source attachments',
      },
    },
  }),
}));

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: overrides.id ?? 'artifact-1',
    name: overrides.name ?? 'card_cropped.jpg',
    type: overrides.type ?? 'image',
    path:
      overrides.path ??
      '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/card_cropped.jpg',
    isOutput: overrides.isOutput ?? true,
    runId: overrides.runId,
    sourceToolCallId: overrides.sourceToolCallId,
    isSourceAttachment: overrides.isSourceAttachment,
  };
}

describe('LocalOutputArtifactPreviews', () => {
  it('renders generated image outputs inline', () => {
    render(<LocalOutputArtifactPreviews artifacts={[artifact({})]} />);

    const image = screen.getByRole('img', { name: 'card_cropped.jpg' });
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('/files/stream?path='),
    );
    expect(image).toHaveAttribute('src', expect.stringContaining('&v=0'));
    expect(screen.getByText('card_cropped.jpg')).toBeInTheDocument();
  });

  it('refreshes the stream URL when output files update in place', () => {
    render(<LocalOutputArtifactPreviews artifacts={[artifact({})]} />);

    const image = screen.getByRole('img', { name: 'card_cropped.jpg' });
    expect(image).toHaveAttribute('src', expect.stringContaining('&v=0'));

    act(() => {
      window.dispatchEvent(new CustomEvent('task-files-updated'));
    });

    expect(image).toHaveAttribute('src', expect.stringContaining('&v=1'));
  });

  it('does not render non-output source media inline', () => {
    render(
      <LocalOutputArtifactPreviews
        artifacts={[
          artifact({
            path: '/Volumes/4TB_WD/_Neumar/sessions/session-1/attachments/source.jpg',
            isOutput: false,
          }),
        ]}
      />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('groups promoted source attachments with generated outputs', () => {
    render(
      <LocalOutputArtifactPreviews
        artifacts={[
          artifact({
            id: 'output-1',
            name: 'render.png',
            path: '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/run-1/render.png',
            runId: 'run-1',
          }),
          artifact({
            id: 'source-1',
            name: 'source.jpg',
            path: '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/run-1/inputs/source.jpg',
            isOutput: false,
            isSourceAttachment: true,
            runId: 'run-1',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Source attachments')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'render.png' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'source.jpg' })).toBeInTheDocument();
  });

  it('renders generated video outputs inline', () => {
    const { container } = render(
      <LocalOutputArtifactPreviews
        artifacts={[
          artifact({
            id: 'video-1',
            name: 'clip_1080p.mp4',
            type: 'video',
            path: '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/clip_1080p.mp4',
          }),
        ]}
      />,
    );

    expect(container.querySelector('video')).toHaveAttribute(
      'aria-label',
      'clip_1080p.mp4',
    );
    expect(screen.getByText('clip_1080p.mp4')).toBeInTheDocument();
  });

  it('renders generated audio outputs inline', () => {
    const { container } = render(
      <LocalOutputArtifactPreviews
        artifacts={[
          artifact({
            id: 'audio-1',
            name: 'mix.wav',
            type: 'audio',
            path: '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/mix.wav',
          }),
        ]}
      />,
    );

    expect(container.querySelector('audio')).toHaveAttribute(
      'aria-label',
      'mix.wav',
    );
    expect(screen.getByText('mix.wav')).toBeInTheDocument();
  });
});
