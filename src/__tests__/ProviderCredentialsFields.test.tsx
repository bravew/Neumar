import { useState } from 'react';

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderCredentialsFields } from '@/components/settings/tabs/ProviderCredentialsFields';
import type { AIProvider } from '@/shared/db/settings';

import { renderWithProviders } from './helpers/render-with-providers';

const baseProvider: AIProvider = {
  id: 'openrouter',
  name: 'OpenRouter',
  apiKey: 'sk-existing-key',
  baseUrl: 'https://openrouter.ai/api/v1',
  enabled: true,
  models: ['openai/gpt-4o-mini'],
  agentType: 'openai-compat',
  category: 'cloud',
};

/** Wrapper that owns provider state so credential edits re-render (controlled). */
function Harness({ initial = baseProvider }: { initial?: AIProvider }) {
  const [provider, setProvider] = useState<AIProvider>(initial);
  return (
    <ProviderCredentialsFields
      provider={provider}
      validationModel={provider.models[0]}
      onApiKeyChange={(apiKey) => setProvider((p) => ({ ...p, apiKey }))}
      onBaseUrlChange={(baseUrl) => setProvider((p) => ({ ...p, baseUrl }))}
    />
  );
}

describe('ProviderCredentialsFields draft validation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function editBaseUrl(value: string) {
    const input = screen.getByPlaceholderText('API base URL');
    fireEvent.change(input, { target: { value } });
  }

  it('does not validate on mount (no user edit yet)', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    renderWithProviders(<Harness />);
    await vi.advanceTimersByTimeAsync(1500);

    // The component must not auto-validate already-saved credentials on open.
    const calls = fetchMock.mock.calls as unknown as unknown[][];
    const providerTestCalls = calls.filter((args) =>
      String(args[0]).includes('/providers/test'),
    );
    expect(providerTestCalls).toHaveLength(0);
  });

  it('keeps a saved custom deployment as the validation model after re-open', async () => {
    const customProvider: AIProvider = {
      ...baseProvider,
      id: 'custom-deployment',
      name: 'Saved deployment',
      baseUrl: 'https://api.example.com/v1',
      models: ['deployment-prod-2026'],
    };
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        success: true,
        latencyMs: 10,
        model: 'deployment-prod-2026',
        message: 'Connected',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const first = renderWithProviders(<Harness initial={customProvider} />);
    first.unmount();
    renderWithProviders(<Harness initial={customProvider} />);
    await vi.advanceTimersByTimeAsync(900);
    expect(fetchMock).not.toHaveBeenCalled();

    editBaseUrl('https://api.example.com/v2');
    await vi.advanceTimersByTimeAsync(900);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'deployment-prod-2026',
      baseUrl: 'https://api.example.com/v2',
    });
  });

  it('debounces an edit, calls /providers/test, and shows a valid badge', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        success: true,
        latencyMs: 42,
        model: 'openai/gpt-4o-mini',
        message: 'Connected',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    renderWithProviders(<Harness />);
    editBaseUrl('https://openrouter.ai/api/v2');

    // Debounced — nothing fires immediately.
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/providers/test');
    expect(JSON.parse(init.body as string)).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v2',
      model: 'openai/gpt-4o-mini',
      agentType: 'openai-compat',
    });
    await waitFor(() =>
      expect(screen.getByText(/Credentials valid/)).toBeTruthy(),
    );
  });

  it('shows the failure message when validation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({
          success: false,
          latencyMs: 0,
          model: 'openai/gpt-4o-mini',
          message: 'Invalid API key',
        }),
      })) as unknown as typeof fetch,
    );

    renderWithProviders(<Harness />);
    editBaseUrl('https://openrouter.ai/api/v3');
    await vi.advanceTimersByTimeAsync(900);

    await waitFor(() =>
      expect(screen.getByText('Invalid API key')).toBeTruthy(),
    );
  });

  it('times out a hung request instead of spinning forever', async () => {
    // A fetch that never resolves on its own, but rejects when aborted.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ) as unknown as typeof fetch,
    );

    renderWithProviders(<Harness />);
    editBaseUrl('https://openrouter.ai/api/hang');

    await vi.advanceTimersByTimeAsync(900); // debounce → request starts
    expect(screen.getByText('Validating credentials…')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(15_000); // request timeout fires → abort
    await waitFor(() =>
      expect(screen.getByText('Connection failed')).toBeTruthy(),
    );
  });
});
