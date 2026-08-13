import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageMock } from '@/__tests__/helpers/local-storage';
import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import { PromptLibraryDrawer } from '@/components/design/PromptLibraryDrawer';
import { PromptLibraryGrid } from '@/components/design/PromptLibraryGrid';
import {
  clearCreativeDebugCounters,
  readCreativeDebugCounters,
} from '@/shared/creative-workflow/debug-counters';
import type {
  PromptLibraryFilters,
  PromptLibrarySample,
} from '@/shared/design/prompt-library-types';

const listPromptLibrarySamplesMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/design/prompt-library-client', () => ({
  listPromptLibrarySamples: listPromptLibrarySamplesMock,
}));

const imageSample: PromptLibrarySample = {
  id: 'library:poster',
  surface: 'image',
  title: 'Poster',
  prompt: 'Create an editorial poster.',
  summary: 'Editorial poster prompt',
  model: 'gpt-image-2',
  aspect: '4:5',
  tags: ['editorial'],
  _meta: {
    label: 'production',
    locales: ['en'],
    repoSlug: 'library',
    repoVisibility: 'platform',
    sampleId: 'sample_poster',
    sampleSlug: 'poster',
    version: '1.0.0',
  },
};

const videoSample: PromptLibrarySample = {
  id: 'library:video-cut',
  surface: 'video',
  title: 'Video cutdown',
  prompt: 'Create a nine second product cutdown.',
  summary: 'Short launch cutdown',
  model: 'veo-3.1',
  aspect: '16:9',
  previewImageUrl: '/preview.jpg',
  previewVideoUrl: '/preview.mp4',
  durationSec: '9',
  tags: ['launch'],
  _meta: {
    label: 'production',
    locales: ['en', 'fr'],
    repoSlug: 'library',
    repoVisibility: 'platform',
    sampleId: 'sample_video',
    sampleSlug: 'video-cut',
    version: '1.0.0',
  },
};

describe('PromptLibraryDrawer', () => {
  afterEach(() => {
    clearCreativeDebugCounters();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    installLocalStorageMock();
    clearCreativeDebugCounters();
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => {},
    );
    listPromptLibrarySamplesMock.mockReset();
    listPromptLibrarySamplesMock.mockImplementation(
      async (filters: PromptLibraryFilters) => ({
        generatedAt: '2026-05-09T00:00:00.000Z',
        items: filters.surface === 'video' ? [videoSample] : [imageSample],
        offline: false,
      }),
    );
  });

  it('filters to video and returns the selected sample', async () => {
    const user = userEvent.setup();
    const onSampleSelected = vi.fn();

    renderWithProviders(
      <PromptLibraryDrawer onSampleSelected={onSampleSelected} />,
    );

    await user.click(screen.getByRole('button', { name: /browse library/i }));
    await user.click(
      await screen.findByTestId('prompt-library-surface-filter'),
    );
    await user.click(await screen.findByRole('option', { name: /^video$/i }));
    await user.click(
      await screen.findByTestId('prompt-library-card-library:video-cut'),
    );
    await user.click(screen.getByTestId('prompt-library-use-sample'));

    await waitFor(() => {
      expect(onSampleSelected).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: videoSample.prompt,
          model: videoSample.model,
          aspect: videoSample.aspect,
        }),
      );
    });
    expect(
      readCreativeDebugCounters().events['prompt.library.opened']?.count,
    ).toBe(1);
    expect(
      readCreativeDebugCounters().events['prompt.library.sample.used']?.count,
    ).toBe(1);
  });

  it('does not autoplay video previews when reduced motion is preferred', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const play = vi.mocked(window.HTMLMediaElement.prototype.play);

    renderWithProviders(
      <PromptLibraryGrid
        samples={[videoSample]}
        labels={{ empty: 'Empty', noPreview: 'No preview' }}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(
      screen.getByTestId('prompt-library-card-library:video-cut'),
    );

    expect(play).not.toHaveBeenCalled();
  });

  it('plays video previews on keyboard focus when motion is allowed', async () => {
    renderWithProviders(
      <PromptLibraryGrid
        samples={[videoSample]}
        labels={{ empty: 'Empty', noPreview: 'No preview' }}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.focus(
      screen.getByTestId('prompt-library-card-library:video-cut'),
    );

    await waitFor(() =>
      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
  });
});
