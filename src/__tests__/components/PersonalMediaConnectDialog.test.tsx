import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersonalMediaConnectDialog } from '@/components/settings/cloud-storage/PersonalMediaConnectDialog';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('PersonalMediaConnectDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests the self-hosted endpoint before creating the connection', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/cloud-storage/connections/test')) {
          return jsonResponse({
            ok: true,
            provider: 'immich',
            serverInfo: { serverVersion: '2.4.1' },
            lanReachable: true,
          });
        }
        if (url.endsWith('/cloud-storage/connections')) {
          return jsonResponse(
            {
              item: {
                id: 'conn-1',
                provider: 'immich',
                displayName: 'Home Immich',
                status: 'active',
              },
            },
            201,
          );
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    renderWithProviders(
      <PersonalMediaConnectDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Home Immich' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://192.168.1.20:2283' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'immich-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conn-1', provider: 'immich' }),
      ),
    );
    const cloudStorageCalls = (
      fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit?]>
    ).filter(([input]) => String(input).includes('/cloud-storage/'));
    expect(cloudStorageCalls).toHaveLength(2);
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-1', provider: 'immich' }),
    );
    expect(JSON.parse(cloudStorageCalls[0][1]?.body as string)).toEqual({
      provider: 'immich',
      baseUrl: 'http://192.168.1.20:2283',
      apiKey: 'immich-key',
    });
    expect(JSON.parse(cloudStorageCalls[1][1]?.body as string)).toMatchObject({
      provider: 'immich',
      kind: 'personal-media',
      displayName: 'Home Immich',
      credential: {
        baseUrl: 'http://192.168.1.20:2283',
        apiKey: 'immich-key',
        serverVersion: '2.4.1',
      },
    });
  });

  it('warns when Immich reports an unsafe server version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          provider: 'immich',
          serverInfo: { serverVersion: '2.4.0' },
          lanReachable: true,
        }),
      ),
    );

    renderWithProviders(
      <PersonalMediaConnectDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://192.168.1.20:2283' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'immich-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await expect(
      screen.findByText(/Immich 2\.4\.0 may include/),
    ).resolves.toBeInTheDocument();
  });

  it('updates a local Immich connection without exposing the stored API key', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (
          url.endsWith('/cloud-storage/connections/local_immich_1') &&
          method === 'GET'
        ) {
          return jsonResponse({
            item: {
              id: 'local_immich_1',
              provider: 'immich',
              displayName: 'Home Immich',
              status: 'active',
              credential: {
                baseUrl: 'http://192.168.1.20:2283',
                serverVersion: '2.4.1',
              },
            },
          });
        }
        if (url.includes('/cloud-storage/connections/test')) {
          return jsonResponse({
            ok: true,
            provider: 'immich',
            serverInfo: { serverVersion: '2.4.1' },
            lanReachable: true,
          });
        }
        if (
          url.endsWith('/cloud-storage/connections/local_immich_1') &&
          method === 'PATCH'
        ) {
          return jsonResponse({
            item: {
              id: 'local_immich_1',
              provider: 'immich',
              displayName: 'Updated Immich',
              status: 'active',
            },
          });
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const onUpdated = vi.fn();

    renderWithProviders(
      <PersonalMediaConnectDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        connection={{
          id: 'local_immich_1',
          provider: 'immich',
          displayName: 'Home Immich',
          status: 'active',
          capabilities: { selfHostedBaseUrl: true },
        }}
        onUpdated={onUpdated}
      />,
    );

    await screen.findByRole('heading', { name: 'Edit connection' });
    await screen.findByDisplayValue('http://192.168.1.20:2283');
    const apiKeyInput = screen.getByLabelText('API key');
    expect(apiKeyInput).toHaveValue('');
    expect(apiKeyInput).toHaveAttribute(
      'placeholder',
      'Leave blank to keep the current key',
    );

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Updated Immich' },
    });
    fireEvent.change(apiKeyInput, {
      target: { value: 'new-immich-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update connection' }));

    await waitFor(() =>
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Updated Immich' }),
      ),
    );

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/cloud-storage/connections/local_immich_1') &&
        init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse(patchCall?.[1]?.body as string)).toMatchObject({
      displayName: 'Updated Immich',
      credential: {
        baseUrl: 'http://192.168.1.20:2283',
        apiKey: 'new-immich-key',
        serverVersion: '2.4.1',
      },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
