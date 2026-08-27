import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ASSET_MATERIALIZATION_NOTICE_TTL_MS,
  acquireAssetMaterializationLease,
  isAssetMaterializationLeaseActive,
  subscribeAssetMaterializationLeases,
} from '@/shared/assets/materializationLease';

afterEach(() => {
  vi.useRealTimers();
});

describe('acquireAssetMaterializationLease', () => {
  it('reports no lease for an untouched session', () => {
    expect(isAssetMaterializationLeaseActive('never-touched')).toBe(false);
    expect(isAssetMaterializationLeaseActive(undefined)).toBe(false);
  });

  it('stays active until the last holder releases, then rides out the grace', () => {
    vi.useFakeTimers();
    const releaseA = acquireAssetMaterializationLease('grace');
    const releaseB = acquireAssetMaterializationLease('grace');

    releaseA();
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS * 2);
    expect(isAssetMaterializationLeaseActive('grace')).toBe(true);

    releaseB();
    expect(isAssetMaterializationLeaseActive('grace')).toBe(true);
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    expect(isAssetMaterializationLeaseActive('grace')).toBe(false);
  });

  it('ignores a repeated release from the same holder', () => {
    vi.useFakeTimers();
    const releaseA = acquireAssetMaterializationLease('double-release');
    const releaseB = acquireAssetMaterializationLease('double-release');
    releaseA();
    releaseA();

    releaseB();
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    expect(isAssetMaterializationLeaseActive('double-release')).toBe(false);
  });

  it('cancels the grace window when a new holder arrives inside it', () => {
    vi.useFakeTimers();
    acquireAssetMaterializationLease('re-acquire')();
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS / 2);

    const release = acquireAssetMaterializationLease('re-acquire');
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    expect(isAssetMaterializationLeaseActive('re-acquire')).toBe(true);

    release();
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    expect(isAssetMaterializationLeaseActive('re-acquire')).toBe(false);
  });

  it('notifies subscribers when a session becomes active and when it lapses', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeAssetMaterializationLeases(listener);

    const releaseA = acquireAssetMaterializationLease('notify');
    expect(listener).toHaveBeenCalledTimes(1);
    // Already active — a second holder changes nothing observable.
    const releaseB = acquireAssetMaterializationLease('notify');
    expect(listener).toHaveBeenCalledTimes(1);

    releaseA();
    releaseB();
    vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    acquireAssetMaterializationLease('notify-after-unsubscribe');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('is a no-op without a session id', () => {
    expect(() => acquireAssetMaterializationLease(undefined)()).not.toThrow();
  });
});
