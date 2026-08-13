import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewRenderer } from '@/components/video/preview/PreviewRenderer';
import type { VideoProject } from '@/shared/types/video';

const mockState = vi.hoisted(() => ({
  caps: { reason: null as string | null, supported: true },
  unsupported: null as ((reason: string) => void) | null,
}));

vi.mock('@/shared/video/useWebCodecsCapabilities', () => ({
  useWebCodecsCapabilities: () => mockState.caps,
}));

vi.mock('@/components/video/preview/WebCodecsPreview', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    WebCodecsPreview: React.forwardRef<
      HTMLDivElement,
      { onUnsupported?: (reason: string) => void }
    >(function MockWebCodecsPreview({ onUnsupported }, ref) {
      mockState.unsupported = onUnsupported ?? null;
      return <div ref={ref} data-testid="webcodecs-preview" />;
    }),
  };
});

vi.mock('@/components/video/preview/LazyRemotionPreview', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    LazyRemotionPreview: React.forwardRef<HTMLDivElement>(
      function MockLazyRemotionPreview(_props, ref) {
        return <div ref={ref} data-testid="remotion-preview" />;
      },
    ),
  };
});

describe('PreviewRenderer WebCodecs fallback', () => {
  beforeEach(() => {
    mockState.caps = { reason: null, supported: true };
    mockState.unsupported = null;
  });

  it('uses WebCodecs by default when the browser supports it', () => {
    renderPreview();

    expect(screen.getByTestId('webcodecs-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('remotion-preview')).not.toBeInTheDocument();
  });

  it('falls back to Remotion when WebCodecs is unavailable', () => {
    mockState.caps = { reason: 'VideoDecoder unavailable', supported: false };

    renderPreview();

    expect(screen.getByTestId('remotion-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('webcodecs-preview')).not.toBeInTheDocument();
  });

  it('falls back after the WebCodecs renderer reports an unsupported codec', () => {
    const { rerender } = renderPreview();

    mockState.unsupported?.('Codec cannot decode');
    rerender(previewElement());

    expect(screen.getByTestId('remotion-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('webcodecs-preview')).not.toBeInTheDocument();
  });
});

function renderPreview() {
  return render(previewElement());
}

function previewElement() {
  return (
    <PreviewRenderer
      project={projectFixture()}
      aspectRatio="16:9"
      playbackRate={1}
      playheadMs={0}
      playheadUpdateSource="external"
    />
  );
}

function projectFixture(): VideoProject {
  return {
    assets: [],
    createdAt: '2026-06-28T00:00:00.000Z',
    id: 'preview-renderer-test',
    name: 'Preview Renderer Test',
    prompt: 'Preview renderer fixture',
    settings: {},
    template: 'custom',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };
}
