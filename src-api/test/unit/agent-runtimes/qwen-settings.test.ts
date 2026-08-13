import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAgentDef,
  readQwenConfiguredModelIds,
} from '@/shared/agent-runtimes';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neuma-qwen-settings-'));
  roots.push(root);
  return root;
}

async function writeSettings(root: string, value: unknown): Promise<string> {
  const path = join(root, 'settings.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('readQwenConfiguredModelIds', () => {
  it('reads the selected model and ids from every provider without exposing secrets', async () => {
    const root = await tempRoot();
    const path = await writeSettings(root, {
      model: { id: 'selected-model', name: 'ignored-name' },
      modelProviders: {
        openai: [
          {
            id: 'provider-a',
            apiKey: 'sk-secret',
            baseUrl: 'https://user:password@example.test',
          },
        ],
        futureProvider: [
          { id: 'provider-b', unrelated: 'private' },
          { id: 'provider-a' },
          { id: '--invalid' },
        ],
      },
      apiKey: 'root-secret',
    });

    await expect(
      readQwenConfiguredModelIds({
        env: { QWEN_SETTINGS_FILE: path },
        userHome: root,
      }),
    ).resolves.toEqual(['selected-model', 'provider-a', 'provider-b']);
  });

  it.each([
    ['bare string', 'selected-string'],
    ['name record', { name: 'selected-name' }],
  ])('accepts the selected model as a %s', async (_label, model) => {
    const root = await tempRoot();
    const path = await writeSettings(root, { model });
    await expect(
      readQwenConfiguredModelIds({
        env: { QWEN_SETTINGS_FILE: path },
        userHome: root,
      }),
    ).resolves.toEqual([typeof model === 'string' ? model : 'selected-name']);
  });

  it('uses the default file, expands an override starting with ~, and follows symlinks', async () => {
    const root = await tempRoot();
    const qwenDir = join(root, '.qwen');
    await mkdir(qwenDir);
    await writeFile(
      join(qwenDir, 'settings.json'),
      JSON.stringify({ model: 'default-path' }),
    );
    const target = await writeSettings(root, { model: 'symlink-target' });
    await symlink(target, join(root, 'linked.json'));

    await expect(
      readQwenConfiguredModelIds({ env: {}, userHome: root }),
    ).resolves.toEqual(['default-path']);
    await expect(
      readQwenConfiguredModelIds({
        env: { QWEN_SETTINGS_FILE: '~/linked.json' },
        userHome: root,
      }),
    ).resolves.toEqual(['symlink-target']);
  });

  it('degrades missing, unreadable, malformed, and oversized settings to no configured models', async () => {
    const root = await tempRoot();
    const malformed = join(root, 'malformed.json');
    const oversized = join(root, 'oversized.json');
    const unreadable = join(root, 'unreadable.json');
    await writeFile(malformed, '{not-json');
    await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1, 32));
    await writeFile(unreadable, '{}');
    await chmod(unreadable, 0o000);

    for (const path of [
      join(root, 'missing.json'),
      unreadable,
      malformed,
      oversized,
    ]) {
      await expect(
        readQwenConfiguredModelIds({
          env: { QWEN_SETTINGS_FILE: path },
          userHome: root,
        }),
      ).resolves.toEqual([]);
    }
    await chmod(unreadable, 0o600);
  });

  it('caps sanitized unique ids at 200', async () => {
    const root = await tempRoot();
    const path = await writeSettings(root, {
      modelProviders: {
        custom: Array.from({ length: 205 }, (_, index) => ({
          id: `model-${index}`,
        })),
      },
    });
    const ids = await readQwenConfiguredModelIds({
      env: { QWEN_SETTINGS_FILE: path },
      userHome: root,
    });
    expect(ids).toHaveLength(200);
    expect(ids.at(-1)).toBe('model-199');
  });
});

describe('Qwen registry model ordering', () => {
  it('places configured models ahead of tested fallbacks without changing mode support', async () => {
    const root = await tempRoot();
    const path = await writeSettings(root, {
      model: 'configured-only',
      modelProviders: { custom: [{ id: 'qwen3-coder-plus' }] },
    });
    vi.stubEnv('QWEN_SETTINGS_FILE', path);
    const qwen = getAgentDef('qwen');
    const models = await qwen?.fetchModels?.('unused');

    expect(models?.map((model) => model.id)).toEqual([
      'configured-only',
      'qwen3-coder-plus',
      'default',
      'qwen3-coder-flash',
    ]);
    expect(models?.[0].source).toBe('configured');
    expect(qwen?.capabilities?.modes?.video).toBe('unsupported');
  });

  it('returns null so detection uses the current fallbacks when settings are unavailable', async () => {
    vi.stubEnv('QWEN_SETTINGS_FILE', '/missing/qwen/settings.json');
    const models = await getAgentDef('qwen')?.fetchModels?.('unused');
    expect(models).toBeNull();
  });
});
