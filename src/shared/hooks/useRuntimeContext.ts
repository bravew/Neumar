import { useCallback, useEffect, useRef, useState } from 'react';

import type { RuntimeContext } from '@/shared/types/runtime-context';

const GEO_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const GEO_TIMEOUT = 5_000; // 5 seconds

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Parse OS, version, and arch from navigator.userAgent (best-effort). */
function parsePlatform(): RuntimeContext['platform'] {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;

  let os: string | undefined;
  let version: string | undefined;
  let arch: string | undefined;

  if (/Mac OS X/.test(ua)) {
    os = 'macos';
    const m = ua.match(/Mac OS X ([\d_.]+)/);
    if (m) version = m[1].replace(/_/g, '.');
  } else if (/Windows/.test(ua)) {
    os = 'windows';
    const m = ua.match(/Windows NT ([\d.]+)/);
    if (m) version = m[1];
  } else if (/Linux/.test(ua)) {
    os = 'linux';
  }

  if (/arm64|aarch64/i.test(ua)) arch = 'arm64';
  else if (/x86_64|x64|amd64|Win64/i.test(ua)) arch = 'x86_64';

  return { os, version, arch };
}

interface GeoCache {
  geo: RuntimeContext['geolocation'];
  ts: number;
}

let geoCache: GeoCache | null = null;

async function fetchGeolocationTauri(): Promise<
  RuntimeContext['geolocation'] | undefined
> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{
      latitude: number;
      longitude: number;
      accuracy: number;
    } | null>('get_location');
    if (!result) return undefined;
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      accuracy: result.accuracy,
    };
  } catch {
    return undefined;
  }
}

function fetchGeolocationBrowser(): Promise<
  RuntimeContext['geolocation'] | undefined
> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(undefined);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(undefined),
      { timeout: GEO_TIMEOUT, enableHighAccuracy: false },
    );
  });
}

export function useRuntimeContext() {
  const [context, setContext] = useState<RuntimeContext>(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
    platform: parsePlatform(),
  }));

  const fetchingRef = useRef(false);

  const refreshGeolocation = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      // Check cache
      if (geoCache && Date.now() - geoCache.ts < GEO_CACHE_TTL) {
        setContext((prev) => ({ ...prev, geolocation: geoCache!.geo }));
        return;
      }

      const geo = isTauri()
        ? await fetchGeolocationTauri()
        : await fetchGeolocationBrowser();

      if (geo) {
        geoCache = { geo, ts: Date.now() };
      }
      setContext((prev) => ({ ...prev, geolocation: geo }));
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refreshGeolocation();
  }, [refreshGeolocation]);

  return { context, refreshGeolocation };
}
