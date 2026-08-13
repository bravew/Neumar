import React from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCloudStorageAttachment } from '@/components/shared/useCloudStorageAttachment';
import { LanguageProvider } from '@/shared/providers/language-provider';
import { ThemeProvider } from '@/shared/providers/theme-provider';

describe('useCloudStorageAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes Immich source context into added attachments', async () => {
    const addFiles = vi.fn().mockResolvedValue(undefined);
    const setValue = vi.fn();
    const fetchMock = vi.fn(async () => {
      return new Response('image-bytes', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useCloudStorageAttachment({ addFiles, setValue }),
      { wrapper: Providers },
    );

    await act(async () => {
      await result.current.handleCloudStorageSelect([
        {
          connectionId: 'home-immich',
          connectionProvider: 'immich',
          connectionLabel: 'home album',
          item: {
            id: 'asset-1',
            name: 'original.jpg',
            path: '/library/original.jpg',
            mimeType: 'image/jpeg',
            isFolder: false,
          },
        },
      ]);
    });

    expect(addFiles).toHaveBeenCalledTimes(1);
    const [files, forceImage, sourceContexts] = addFiles.mock.calls[0];
    expect(files[0].name).toBe('original.jpg');
    expect(forceImage).toBe(true);
    expect(sourceContexts).toEqual([
      {
        kind: 'cloud-storage',
        connectionId: 'home-immich',
        connectionProvider: 'immich',
        connectionLabel: 'home album',
        providerItemId: 'asset-1',
        providerItemName: 'original.jpg',
        providerItemPath: '/library/original.jpg',
      },
    ]);
  });
});

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </LanguageProvider>
  );
}
