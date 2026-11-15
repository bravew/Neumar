import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DesignProjectView } from '@/components/design/ProjectView';
import {
  queuedDesignSendsStorageKey,
  retryQueuedDesignSend,
  type QueuedDesignSend,
} from '@/components/design/queued-design-sends';
import { defaultSettings, saveSettings } from '@/shared/db/settings';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

const ORIGINAL: QueuedDesignSend = {
  id: 'queued-1',
  prompt: 'Keep this draft',
  createdAt: '2026-11-12T00:00:00.000Z',
  status: 'queued',
};

/**
 * The Design screen is the caller: it owns the drain, the persisted queue, and
 * the sidebar that renders the card. Persistence and prompt contents stay as
 * they are; only the card's visibility changes while a send is in flight.
 */
describe('queued design send drain visibility', () => {
  it('hides the card when its send starts, keeps the durable item, and restores the original draft if rejected', async () => {
    const originalFetch = globalThis.fetch;
    const { storage, restore } = installStorageMock();
    const project = designProjectFixture();
    const storageKey = queuedDesignSendsStorageKey(project.id);
    storage.setItem(storageKey, JSON.stringify([ORIGINAL]));
    let settleMedia: (response: Response) => void = () => {};
    const media = new Promise<Response>((resolve) => {
      settleMedia = resolve;
    });
    const prompts: string[] = [];

    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/capabilities')) {
        return Promise.resolve(
          jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          }),
        );
      }
      if (url.endsWith('/tasks')) {
        return Promise.resolve(jsonResponse({ tasks: [] }));
      }
      if (url.endsWith('/files')) {
        return Promise.resolve(jsonResponse({ files: [] }));
      }
      if (
        url.endsWith(`/projects/${project.id}/media`) &&
        init?.method === 'POST'
      ) {
        const body = JSON.parse(String(init.body)) as { prompt: string };
        prompts.push(body.prompt);
        return media;
      }
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
    saveSettings({
      ...defaultSettings,
      designMode: { ...defaultSettings.designMode, chatLoop: false },
    });

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      expect(await screen.findByText(ORIGINAL.prompt)).toBeVisible();

      await waitFor(() => expect(prompts).toEqual([ORIGINAL.prompt]));
      expect(screen.queryByTestId('queued-send-strip')).not.toBeInTheDocument();
      expect(storedItems(storage, storageKey)).toEqual([ORIGINAL]);

      settleMedia(jsonResponse({ error: 'rejected' }, 503));

      expect(
        await screen.findByText('Queued send failed: rejected'),
      ).toBeVisible();
      expect(screen.getByText(ORIGINAL.prompt)).toBeVisible();
      const restored = storedItems(storage, storageKey);
      expect(restored).toEqual([
        {
          ...ORIGINAL,
          status: 'failed',
          error: 'rejected',
          failedAt: expect.any(String),
        },
      ]);
      expect(retryQueuedDesignSend(restored[0]!)).toEqual(ORIGINAL);
    } finally {
      globalThis.fetch = originalFetch;
      saveSettings(defaultSettings);
      restore();
    }
  });
});

function storedItems(storage: Storage, key: string): QueuedDesignSend[] {
  return JSON.parse(storage.getItem(key) ?? '[]') as QueuedDesignSend[];
}

function installStorageMock() {
  const storage = createStorageMock();
  const globalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    window,
    'localStorage',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return {
    storage,
    restore: () => {
      restoreStorageDescriptor(globalThis, globalDescriptor);
      restoreStorageDescriptor(window, windowDescriptor);
    },
  };
}

function restoreStorageDescriptor(
  target: typeof globalThis,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, 'localStorage', descriptor);
    return;
  }
  delete (target as { localStorage?: Storage }).localStorage;
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function designProjectFixture(): DesignProject {
  return {
    id: 'design_queue_visibility',
    title: 'Queue visibility',
    surface: 'image',
    status: 'draft',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {},
    outputs: [],
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
    media: { model: 'gpt-image-2', aspect: '16:9' },
  };
}

function designBudgetFixture() {
  const usage = {
    imageGenerations: 0,
    videoJobs: 0,
    videoSeconds: 0,
    audioSeconds: 0,
    storageBytes: 0,
  };
  return {
    allowed: true,
    severity: 'none',
    message: '',
    config: {
      maxImageGenerations: 25,
      maxVideoJobs: 5,
      maxVideoSeconds: 60,
      maxAudioSeconds: 300,
      maxRetryCount: 1,
      maxStorageBytes: 1_073_741_824,
      strictProviderMode: false,
    },
    used: usage,
    requested: {},
    remaining: {
      imageGenerations: 25,
      videoJobs: 5,
      videoSeconds: 60,
      audioSeconds: 300,
      storageBytes: 1_073_741_824,
    },
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
