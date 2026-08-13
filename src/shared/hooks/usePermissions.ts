/**
 * macOS Permissions Hook
 *
 * Provides a React hook for checking and requesting macOS system permissions
 * (microphone, screen recording, accessibility) via the tauri-plugin-macos-permissions
 * plugin. Falls back gracefully when not running in Tauri.
 */

import { useCallback, useEffect, useState } from 'react';

export type PermissionType =
  | 'microphone'
  | 'screenRecording'
  | 'accessibility'
  | 'camera'
  | 'fullDiskAccess'
  | 'inputMonitoring';

export type PermissionStatus =
  | 'authorized'
  | 'denied'
  | 'not_determined'
  | 'unknown';

export interface PermissionState {
  microphone: PermissionStatus;
  screenRecording: PermissionStatus;
  accessibility: PermissionStatus;
  camera: PermissionStatus;
  fullDiskAccess: PermissionStatus;
  inputMonitoring: PermissionStatus;
}

interface PermissionsHookReturn {
  permissions: PermissionState;
  loading: boolean;
  /** Whether we're running inside the Tauri desktop shell (can actually check permissions) */
  isNative: boolean;
  /** Check a specific permission's current status */
  check: (type: PermissionType) => Promise<PermissionStatus>;
  /** Request a specific permission (triggers OS dialog) */
  request: (type: PermissionType) => Promise<boolean>;
  /** Refresh all permission statuses */
  refreshAll: () => Promise<void>;
  /** Open macOS System Settings to the Privacy & Security pane */
  openSystemSettings: () => Promise<void>;
}

const DEFAULT_STATE: PermissionState = {
  microphone: 'unknown',
  screenRecording: 'unknown',
  accessibility: 'unknown',
  camera: 'unknown',
  fullDiskAccess: 'unknown',
  inputMonitoring: 'unknown',
};

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Dynamically import the macOS permissions plugin.
 * Returns null if not in Tauri or plugin not available.
 */
async function getPlugin() {
  if (!isTauri()) return null;
  try {
    return await import('tauri-plugin-macos-permissions-api');
  } catch {
    return null;
  }
}

// Map permission types to plugin method names
const CHECK_METHODS: Record<PermissionType, string> = {
  microphone: 'checkMicrophonePermission',
  screenRecording: 'checkScreenRecordingPermission',
  accessibility: 'checkAccessibilityPermission',
  camera: 'checkCameraPermission',
  fullDiskAccess: 'checkFullDiskAccessPermission',
  inputMonitoring: 'checkInputMonitoringPermission',
};

const REQUEST_METHODS: Record<PermissionType, string> = {
  microphone: 'requestMicrophonePermission',
  screenRecording: 'requestScreenRecordingPermission',
  accessibility: 'requestAccessibilityPermission',
  camera: 'requestCameraPermission',
  fullDiskAccess: 'requestFullDiskAccessPermission',
  inputMonitoring: 'requestInputMonitoringPermission',
};

export function usePermissions(): PermissionsHookReturn {
  const [permissions, setPermissions] =
    useState<PermissionState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);

  const check = useCallback(
    async (type: PermissionType): Promise<PermissionStatus> => {
      const plugin = await getPlugin();
      if (!plugin) return 'unknown';

      try {
        const method = CHECK_METHODS[type];
        const fn = (plugin as unknown as Record<string, () => Promise<string>>)[
          method
        ];
        if (typeof fn !== 'function') return 'unknown';

        const result = await fn();
        const status = mapStatus(result);

        setPermissions((prev) => ({ ...prev, [type]: status }));
        return status;
      } catch {
        return 'unknown';
      }
    },
    [],
  );

  const request = useCallback(
    async (type: PermissionType): Promise<boolean> => {
      const plugin = await getPlugin();
      if (!plugin) return false;

      try {
        const method = REQUEST_METHODS[type];
        const fn = (
          plugin as unknown as Record<string, () => Promise<boolean>>
        )[method];
        if (typeof fn !== 'function') return false;

        const granted = await fn();

        // Re-check after requesting
        await check(type);
        return granted;
      } catch {
        return false;
      }
    },
    [check],
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    const types: PermissionType[] = [
      'microphone',
      'screenRecording',
      'accessibility',
      'camera',
      'fullDiskAccess',
      'inputMonitoring',
    ];
    await Promise.all(types.map((t) => check(t)));
    setLoading(false);
  }, [check]);

  const openSystemSettings = useCallback(async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(
        'x-apple.systempreferences:com.apple.preference.security?Privacy',
      );
    } catch {
      // Not in Tauri — try window.open as fallback
      window.open(
        'x-apple.systempreferences:com.apple.preference.security?Privacy',
        '_blank',
      );
    }
  }, []);

  // Check all permissions on mount
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return {
    permissions,
    loading,
    isNative: isTauri(),
    check,
    request,
    refreshAll,
    openSystemSettings,
  };
}

/**
 * Map plugin result string to our standardized status enum.
 */
function mapStatus(result: string): PermissionStatus {
  const lower = result.toLowerCase();
  if (lower === 'authorized' || lower === 'granted' || lower === 'true') {
    return 'authorized';
  }
  if (lower === 'denied' || lower === 'restricted') {
    return 'denied';
  }
  if (lower === 'not_determined' || lower === 'notdetermined') {
    return 'not_determined';
  }
  return 'unknown';
}
