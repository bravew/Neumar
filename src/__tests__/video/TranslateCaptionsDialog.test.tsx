import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { TranslateCaptionsDialog } from '@/components/video/transcript/TranslateCaptionsDialog';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

function project(): VideoProject {
  return {
    id: 'p',
    name: 'Video',
    template: 'custom',
    prompt: '',
    assets: [],
    createdAt: '',
    updatedAt: '',
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 1000,
      tracks: [
        {
          id: 'captions',
          kind: 'caption',
          name: 'Captions',
          language: 'en',
          muted: false,
          locked: false,
          order: 1,
          clips: [
            {
              id: 'c',
              kind: 'caption',
              sourceRef: { kind: 'asset', assetId: 'a' },
              text: 'hello',
              startMs: 0,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
            },
          ],
        },
      ],
    },
  };
}

function mount(p: VideoProject, translateCaptions = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            destination: 'https://new.example',
            configured: true,
          }),
        ),
    ),
  );
  render(
    <TranslateCaptionsDialog
      open
      onOpenChange={vi.fn()}
      project={p}
      actions={{ translateCaptions } as unknown as VideoProjectEditorActions}
    />,
    { wrapper: LanguageProvider },
  );
  return translateCaptions;
}

afterEach(() => vi.unstubAllGlobals());

describe('translation destination and consent', () => {
  it('does not reuse consent recorded for an old destination', async () => {
    const p = project();
    p.settings = {
      captionTranslationProviderId: 'https://old.example',
      captionTranslationEgressConsents: {
        'https://old.example': { confirmed: true, confirmedAt: '' },
      },
    };
    const translate = mount(p);
    await screen.findByText(/Provider: https:\/\/new.example/);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /^Translate$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Translate$/ }));
    await waitFor(() =>
      expect(translate).toHaveBeenCalledWith(
        expect.objectContaining({
          consentDestination: 'https://new.example',
          egressConfirmed: true,
        }),
      ),
    );
  });

  it('forwards the selected Video-mode model without a cost gate', async () => {
    const translate = vi.fn().mockResolvedValueOnce({
      project: project(),
      skipped: [],
    });
    mount(project(), translate);
    await screen.findByText(/Provider: https:\/\/new.example/);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Translate$/ }));
    await waitFor(() =>
      expect(translate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(String),
        }),
      ),
    );
  });
});
