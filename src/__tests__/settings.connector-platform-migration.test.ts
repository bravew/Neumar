import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let restoreLocalStorage: (() => void) | null = null;

function installLocalStorageMock() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: mock,
  });
  restoreLocalStorage = () => {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  };
}

async function getSettingsStorageKey() {
  const { APP_SLUG } = await import('@/config/branding');
  return `${APP_SLUG}_settings`;
}

describe('connector platform settings migration', () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageMock();
  });

  it('backfills default provider metadata when loading old provider settings', async () => {
    const storageKey = await getSettingsStorageKey();
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        providers: [
          {
            id: 'openrouter',
            name: 'OpenRouter',
            apiKey: 'test-openrouter-key',
            baseUrl: 'https://openrouter.ai/api',
            enabled: true,
            models: ['openai/gpt-4o-mini'],
            icon: 'O',
            apiKeyUrl: 'https://openrouter.ai/keys',
            canDelete: true,
            category: 'gateway',
          },
        ],
      }),
    );

    const { getSettings } = await import('@/shared/db/settings');
    const { buildModelOptions } =
      await import('@/components/shared/ChatInput.types');
    const settings = getSettings();
    const openRouter = settings.providers.find((p) => p.id === 'openrouter');

    expect(openRouter?.agentType).toBe('openai-compat');
    expect(
      buildModelOptions({}, settings.providers).some(
        (option) => option.id === 'openai/gpt-4o-mini',
      ),
    ).toBe(true);
  });

  it('backfills newly available Claude models for existing settings', async () => {
    const storageKey = await getSettingsStorageKey();
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        providers: [
          {
            id: 'claude',
            name: 'Anthropic Claude',
            apiKey: '',
            baseUrl: '',
            enabled: true,
            models: [
              'claude-sonnet-4-6',
              'claude-opus-4-7',
              'claude-haiku-4-5-20251001',
            ],
            introducedDefaultModels: [
              'claude-sonnet-4-6',
              'claude-opus-4-7',
              'claude-haiku-4-5-20251001',
            ],
            canDelete: false,
            agentType: 'claude',
            billingType: 'subscription',
          },
        ],
      }),
    );

    const { getSettings } = await import('@/shared/db/settings');
    const { buildModelOptions } =
      await import('@/components/shared/ChatInput.types');

    const settings = getSettings();
    const claude = settings.providers.find((p) => p.id === 'claude');
    expect(claude?.models).toEqual(
      expect.arrayContaining([
        'claude-sonnet-5',
        'claude-opus-4-8',
        'claude-opus-4-6',
      ]),
    );

    const claudeOptions = buildModelOptions({}, settings.providers).map(
      (option) => option.id,
    );
    expect(claudeOptions).toEqual(
      expect.arrayContaining([
        'claude-sonnet-5',
        'claude-opus-4-8',
        'claude-opus-4-6',
      ]),
    );
  });

  afterEach(() => {
    restoreLocalStorage?.();
    restoreLocalStorage = null;
    vi.resetModules();
  });

  it('drops legacy platformV2 when loading settings from localStorage', async () => {
    const storageKey = await getSettingsStorageKey();
    localStorage.setItem(
      storageKey,
      JSON.stringify({ connectors: { platformV2: false } }),
    );

    const { getSettings } = await import('@/shared/db/settings');

    expect(getSettings().connectors).toEqual({
      showDuplicateComposioAdapters: false,
    });
  });

  it('does not persist legacy platformV2 when saving settings', async () => {
    const storageKey = await getSettingsStorageKey();
    const { defaultSettings, saveSettingsAsync } =
      await import('@/shared/db/settings');

    await saveSettingsAsync({
      ...defaultSettings,
      connectors: {
        ...defaultSettings.connectors,
        platformV2: false,
      } as typeof defaultSettings.connectors & { platformV2: boolean },
    });

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as {
      connectors?: Record<string, unknown>;
    };
    expect(stored.connectors).toEqual({
      showDuplicateComposioAdapters: false,
    });
  });
});
