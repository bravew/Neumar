import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearBinaryCache } from '@/shared/services/ffmpeg/executor';

// We test the health route via Hono's app.request() — no server needed.
// Import is done inside test blocks to avoid side effects at module load time.

describe('Health API', () => {
  let tempDir = '';

  afterEach(() => {
    clearBinaryCache();
    vi.unstubAllEnvs();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('returns 200 with status ok', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  it('includes timestamp in response', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.timestamp).toBe('string');
  });

  it('includes uptime in response', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
  });

  it('includes memory stats', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('memory');
    const memory = body.memory as Record<string, unknown>;
    expect(memory).toHaveProperty('rss');
    expect(memory).toHaveProperty('heapUsed');
    expect(memory.unit).toBe('MB');
    expect(memory).toHaveProperty('budget');
    const resources = body.resources as Record<string, unknown>;
    const memoryBudget = resources.memoryBudget as Record<string, unknown>;
    expect(memoryBudget.rssBudgetMb).toBeGreaterThan(0);
    expect(memoryBudget.budgets).toMatchObject({
      ffmpegMaxConcurrentRenders: 2,
    });
    const assetStorage = resources.assetStorage as Record<string, unknown>;
    expect(assetStorage).toMatchObject({
      managedBytes: expect.any(Number),
      cacheBytes: expect.any(Number),
      materializedBytes: expect.any(Number),
      proxyBytes: expect.any(Number),
      previewArtifactBytes: expect.any(Number),
      materializedBytesByScope: expect.any(Array),
    });
  });

  it('returns 404 for unknown dependency', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/dependencies/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns a formula-only Homebrew command for FFmpeg', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request(
      '/dependencies/ffmpeg/install-commands',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands.brew).toBe('brew install --formula ffmpeg');
  });

  it('requires explicit confirmation before installing a dependency', async () => {
    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/dependencies/ffmpeg/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'brew' }),
    });
    expect(res.status).toBe(400);
  });

  it('installs allowlisted Homebrew formulae without shell expansion', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'neuma-brew-install-'));
    const binDir = path.join(tempDir, 'bin');
    const brewArgsFile = path.join(tempDir, 'brew-args.txt');
    mkdirSync(binDir, { recursive: true });
    writeExecutable(binDir, 'brew', 'printf "%s\\n" "$@" > "$BREW_ARGS_FILE"');
    writeExecutable(binDir, 'ffmpeg', 'printf "ffmpeg version fake\\n"');
    writeExecutable(binDir, 'ffprobe', 'printf "ffprobe version fake\\n"');
    vi.stubEnv('PATH', binDir);
    vi.stubEnv('HOME', tempDir);
    vi.stubEnv('BREW_ARGS_FILE', brewArgsFile);
    clearBinaryCache();

    const { healthRoutes } = await import('@/app/api/health');
    const res = await healthRoutes.request('/dependencies/ffmpeg/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'brew', confirmed: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      installed: true,
      version: 'ffmpeg version fake',
    });
    expect(readFileSync(brewArgsFile, 'utf-8').trim().split('\n')).toEqual([
      'install',
      '--formula',
      'ffmpeg',
    ]);
  });
});

function writeExecutable(binDir: string, name: string, body: string): string {
  const filePath = path.join(binDir, name);
  writeFileSync(filePath, `#!/bin/sh\n${body}\n`);
  chmodSync(filePath, 0o755);
  return filePath;
}
