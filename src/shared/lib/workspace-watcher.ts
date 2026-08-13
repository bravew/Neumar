/**
 * Workspace watcher bootstrap — invokes the Tauri-side `notify` watcher that
 * drives debounced graphify rebuilds and incremental RAG reindex on file
 * change.
 *
 * Calls are no-ops when not running inside Tauri (e.g. the Vite browser
 * harness used during dev for the API-only flow), so this is safe to invoke
 * unconditionally from main.tsx.
 */

import { API_BASE_URL } from '@/config';

interface WatcherStatus {
  running: boolean;
  workDir: string | null;
}

let started: { workDir: string; apiBaseUrl: string } | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke(command, args)) as T;
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[workspace-watcher] invoke ${command} failed:`, err);
    }
    return null;
  }
}

/** Start (or restart, when args differ) the workspace watcher. */
export async function startWorkspaceWatcher(workDir: string): Promise<void> {
  if (!workDir) return;
  if (
    started &&
    started.workDir === workDir &&
    started.apiBaseUrl === API_BASE_URL
  ) {
    return;
  }
  const result = await safeInvoke<WatcherStatus>('start_workspace_watcher', {
    workDir,
    apiBaseUrl: API_BASE_URL,
  });
  if (result) {
    started = { workDir, apiBaseUrl: API_BASE_URL };
  }
}

export async function stopWorkspaceWatcher(): Promise<void> {
  await safeInvoke<WatcherStatus>('stop_workspace_watcher');
  started = null;
}

export async function getWorkspaceWatcherStatus(): Promise<WatcherStatus | null> {
  return safeInvoke<WatcherStatus>('workspace_watcher_status');
}
