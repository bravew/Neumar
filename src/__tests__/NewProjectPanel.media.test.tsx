import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewProjectPanel } from '@/components/design/NewProjectPanel';

import { renderWithProviders } from './helpers/render-with-providers';

describe('NewProjectPanel media tab', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('can open directly on the audio media surface', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          project: {
            id: 'design_audio_direct',
            title: 'Audio',
            surface: 'audio',
            status: 'draft',
            skillId: null,
            designSystemId: null,
            inspirationDesignSystemIds: [],
            craftRefs: [],
            brief: {},
            outputs: [],
            createdAt: '2026-05-12T00:00:00.000Z',
            updatedAt: '2026-05-12T00:00:00.000Z',
          },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <NewProjectPanel
        designSystems={[]}
        skills={[]}
        imageTemplates={[]}
        videoTemplates={[]}
        initialSurface="media"
        initialMediaSurface="audio"
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^audio$/i })).toHaveAttribute(
      'data-active',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      surface: 'audio',
      media: { audioKind: 'speech', durationSeconds: 30 },
    });
  });

  it('consolidates image/video/audio under media and uses compact pickers', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          project: {
            id: 'design_media',
            title: 'Media',
            surface: 'video',
            status: 'draft',
            skillId: null,
            designSystemId: null,
            inspirationDesignSystemIds: [],
            craftRefs: [],
            brief: {},
            outputs: [],
            createdAt: '2026-05-12T00:00:00.000Z',
            updatedAt: '2026-05-12T00:00:00.000Z',
          },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <NewProjectPanel
        designSystems={[]}
        skills={[]}
        imageTemplates={[]}
        videoTemplates={[]}
        onCreated={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('design-surface-picker'));
    await user.click(
      await screen.findByRole('menuitemradio', { name: /media/i }),
    );
    await user.click(screen.getByRole('button', { name: /^video$/i }));
    await user.click(screen.getByRole('button', { name: /choose a model/i }));
    await user.type(screen.getByPlaceholderText(/search models/i), 'seedance');
    await user.click(await screen.findByText('seedance-2.0'));
    await user.click(screen.getByRole('button', { name: /^16:9/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      surface: 'video',
      media: { model: 'seedance-2.0', aspect: '16:9' },
    });
  });

  it('uses media brief input and selected prompt template during creation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/design/prompt-templates/video/video-template-1')) {
          return jsonResponse({
            template: {
              id: 'video-template-1',
              surface: 'video',
              title: 'Launch teaser',
              prompt: 'Template prompt wins',
              model: 'seedance-2.0',
              aspect: '16:9',
            },
          });
        }
        return jsonResponse({
          project: {
            id: 'design_media_template',
            title: 'Media',
            surface: 'video',
            status: 'draft',
            skillId: null,
            designSystemId: null,
            inspirationDesignSystemIds: [],
            craftRefs: [],
            brief: {},
            outputs: [],
            createdAt: '2026-05-12T00:00:00.000Z',
            updatedAt: '2026-05-12T00:00:00.000Z',
          },
        });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <NewProjectPanel
        designSystems={[]}
        skills={[]}
        imageTemplates={[]}
        videoTemplates={[
          {
            id: 'video-template-1',
            surface: 'video',
            title: 'Launch teaser',
            prompt: 'Short teaser',
          },
        ]}
        initialSurface="media"
        initialMediaSurface="video"
        onCreated={vi.fn()}
      />,
    );

    await user.type(
      screen.getByTestId('design-project-brief-input'),
      'Typed brief fallback',
    );
    await user.selectOptions(
      screen.getByLabelText(/prompt template/i),
      'video-template-1',
    );
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/design/projects'),
        expect.anything(),
      ),
    );
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      surface: 'video',
      promptTemplate: {
        id: 'video-template-1',
        prompt: 'Template prompt wins',
      },
      brief: {
        prompt: 'Template prompt wins',
      },
    });
  });

  it('loads ElevenLabs voices and switches SFX without speech controls', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/design/media/voices?provider=elevenlabs')) {
          return jsonResponse({
            voices: [
              {
                id: 'voice_en',
                name: 'Rachel',
                language: 'en',
                category: 'premade',
              },
            ],
          });
        }
        return jsonResponse({
          project: {
            id: 'design_audio',
            title: 'Audio',
            surface: 'audio',
            status: 'draft',
            skillId: null,
            designSystemId: null,
            inspirationDesignSystemIds: [],
            craftRefs: [],
            brief: {},
            outputs: [],
            createdAt: '2026-05-12T00:00:00.000Z',
            updatedAt: '2026-05-12T00:00:00.000Z',
          },
        });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <NewProjectPanel
        designSystems={[]}
        skills={[]}
        imageTemplates={[]}
        videoTemplates={[]}
        onCreated={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('design-surface-picker'));
    await user.click(
      await screen.findByRole('menuitemradio', { name: /media/i }),
    );
    await user.click(screen.getByRole('button', { name: /^audio$/i }));
    await user.click(screen.getByRole('button', { name: /choose a model/i }));
    await user.type(screen.getByPlaceholderText(/search models/i), 'eleven');
    await user.click(await screen.findByText('elevenlabs-speech'));
    expect(await screen.findByLabelText('Voice')).toBeVisible();
    expect(await screen.findByRole('option', { name: 'Rachel' })).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: /elevenlabs-speech/i }),
    );
    await user.clear(screen.getByPlaceholderText(/search models/i));
    await user.type(screen.getByPlaceholderText(/search models/i), 'sfx');
    await user.click(await screen.findByText('elevenlabs-sfx'));

    expect(screen.queryByLabelText('Voice')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/design/projects'),
        expect.anything(),
      ),
    );
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      surface: 'audio',
      media: { model: 'elevenlabs-sfx', audioKind: 'sfx' },
    });
  });
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
