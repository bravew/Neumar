import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppUpdaterProvider,
  useAppUpdater,
  type AppUpdaterValue,
} from '@/shared/providers/app-updater-provider';

/**
 * Internal daily previews (#366) must never poll, compare against, or install from
 * the production stable feed. The "normal build" cases are the control: they prove
 * the same harness does reach the feed, so the preview assertions are not vacuous.
 */
const getVersion = vi.fn(async () => '1.0.0');
const check = vi.fn(async () => null);

vi.mock('@tauri-apps/api/app', () => ({ getVersion }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));

let latest: AppUpdaterValue | null = null;

function Probe() {
  latest = useAppUpdater();
  return null;
}

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ version: '2.0.0', notes: '', pub_date: '' }),
}));

async function mountAndRun() {
  render(
    <AppUpdaterProvider>
      <Probe />
    </AppUpdaterProvider>,
  );
  // Past the 5s initial delay and one hourly interval.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  latest = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe('AppUpdaterProvider in a normal desktop build', () => {
  it('checks for updates on mount (control)', async () => {
    vi.stubEnv('VITE_NEUMAR_PREVIEW_BUILD', '');
    await mountAndRun();
    expect(getVersion).toHaveBeenCalled();
    expect(
      check.mock.calls.length + fetchMock.mock.calls.length,
    ).toBeGreaterThan(0);
  });
});

describe('AppUpdaterProvider in a preview build', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEUMAR_PREVIEW_BUILD', 'true');
  });

  it('never contacts the updater or the stable feed on mount or on the interval', async () => {
    await mountAndRun();
    expect(getVersion).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest?.status).toBe('idle');
  });

  it('ignores a manual update check', async () => {
    await mountAndRun();
    await act(async () => {
      await latest?.checkForUpdate();
    });
    expect(getVersion).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest?.status).toBe('idle');
  });

  it('refuses to download or install', async () => {
    await mountAndRun();
    await act(async () => {
      await latest?.downloadAndInstall();
    });
    expect(latest?.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
