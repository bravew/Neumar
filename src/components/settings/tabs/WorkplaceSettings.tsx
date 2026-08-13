import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FileText,
  FolderInput,
  FolderOpen,
  Loader2,
  Shield,
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';

import { APP_SLUG } from '@/config/branding';
import { getAppDataDir, getPathSeparator } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { API_BASE_URL } from '../constants';
import { SandboxProviderBadge } from '../sandbox/SandboxProviderBadge';
import type { WorkplaceSettingsProps } from '../types';
import { useMigrateWorkspace } from './useMigrateWorkspace';

function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

const openFolderInSystem = async (folderPath: string) => {
  try {
    if (isTauri()) {
      try {
        const { openPath } = await import('@tauri-apps/plugin-opener');
        await openPath(folderPath);
        return;
      } catch {
        if (import.meta.env.DEV) {
          console.warn(
            '[Workspace] Tauri opener not available, falling back to API',
          );
        }
      }
    }

    const response = await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, expandHome: true }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      if (import.meta.env.DEV) {
        console.error('[Workspace] Failed to open folder:', data.error);
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[Workspace] Error opening folder:', err);
    }
  }
};

// Phase 7: enforcement reflects what the backend SandboxCapabilities reports.
// 'reduced' for codex (shell wrap + out-of-sandbox package install paths still
// open), 'none' for native (no OS-level boundary). Backend metadata is the
// source of truth — these labels are static UI hints that the badge tooltips
// and locale strings expand on.
const sandboxOptions = [
  {
    id: 'codex',
    icon: Shield,
    nameKey: 'sandboxCodex',
    descKey: 'sandboxCodexDescription',
    enforcement: 'reduced' as const,
    marketplaceEligible: false,
  },
  {
    id: 'native',
    icon: ShieldOff,
    nameKey: 'sandboxNative',
    descKey: 'sandboxNativeDescription',
    enforcement: 'none' as const,
    marketplaceEligible: false,
  },
];

export function WorkplaceSettings({
  settings,
  onSettingsChange,
  defaultPaths,
}: WorkplaceSettingsProps) {
  const { t } = useLanguage();
  const [pathSep, setPathSep] = useState('/');
  const [editingPath, setEditingPath] = useState(false);
  const [draftPath, setDraftPath] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const applyNewWorkDir = useCallback(
    (newDir: string) => {
      onSettingsChange({ ...settingsRef.current, workDir: newDir });
    },
    [onSettingsChange],
  );

  const {
    migrating,
    status,
    progress,
    getSessionStats,
    migrateSessions,
    abort,
  } = useMigrateWorkspace();

  // Track unmigrated sessions in other directories
  const [pendingMigration, setPendingMigration] = useState<{
    sourceDir: string;
    sessionCount: number;
    totalMB: number;
  } | null>(null);

  useEffect(() => {
    getPathSeparator().then(setPathSep);
    return () => abort();
  }, [abort]);

  // Auto-detect unmigrated sessions on mount or when workDir changes
  useEffect(() => {
    const ac = new AbortController();
    async function checkForUnmigratedSessions() {
      const currentWorkDir = settings.workDir;
      if (!currentWorkDir) return;

      const appDataDir = await getAppDataDir();
      // Only check if current workspace differs from default app data dir
      if (currentWorkDir === appDataDir) return;

      const stats = await getSessionStats(appDataDir, ac.signal);
      if (!ac.signal.aborted && stats && stats.sessionCount > 0) {
        setPendingMigration({
          sourceDir: appDataDir,
          sessionCount: stats.sessionCount,
          totalMB: stats.totalMB,
        });
      }
    }
    checkForUnmigratedSessions();
    return () => {
      ac.abort();
    };
  }, [settings.workDir, getSessionStats]);

  const startEditing = () => {
    setDraftPath(settings.workDir || defaultPaths.workDir);
    setEditingPath(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitPathEdit = () => {
    const trimmed = draftPath.trim();
    setEditingPath(false);
    if (
      trimmed &&
      trimmed !== (settingsRef.current.workDir || defaultPaths.workDir)
    ) {
      confirmAndApply(trimmed);
    }
  };

  const confirmAndApply = async (rawNewPath: string) => {
    const newPath = rawNewPath.replace(/[/\\]+$/, '');
    const currentSettings = settingsRef.current;
    const oldDir = (currentSettings.workDir || defaultPaths.workDir).replace(
      /[/\\]+$/,
      '',
    );
    if (newPath === oldDir) return;

    // Step 1: Apply new workDir immediately
    applyNewWorkDir(newPath);

    // Step 2: Check old workspace for data to migrate
    if (!oldDir) return;
    const stats = await getSessionStats(oldDir).catch(() => null);
    if (
      !stats ||
      (stats.sessionCount === 0 &&
        (!stats.folders || stats.folders.length === 0))
    ) {
      return;
    }

    // Step 3: Migrate workspace data (sessions, channels, logs, cache, skills)
    toast.info(t.settings.migrateWorkspaceMoving);
    await migrateSessions(oldDir, newPath);
  };

  const handleBrowseFolder = async () => {
    let selected: string | undefined;

    try {
      if (isTauri()) {
        let resolvedDefault: string | undefined = settings.workDir || undefined;
        if (!resolvedDefault || resolvedDefault.startsWith('~')) {
          try {
            resolvedDefault = await getAppDataDir();
          } catch {
            resolvedDefault = undefined;
          }
        }

        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({
          directory: true,
          multiple: false,
          title: t.settings.workingDirectory,
          defaultPath: resolvedDefault,
          canCreateDirectories: true,
        });
        if (typeof result === 'string') {
          selected = result;
        }
      } else {
        const path = window.prompt(
          t.settings.workingDirectory,
          settings.workDir || defaultPaths.workDir,
        );
        if (path) {
          selected = path;
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Workspace] Folder picker error:', err);
      }
      startEditing();
      return;
    }

    if (!selected) return;
    await confirmAndApply(selected);
  };

  const handleMigratePending = async () => {
    if (!pendingMigration || !settings.workDir) return;
    await migrateSessions(pendingMigration.sourceDir, settings.workDir);
    setPendingMigration(null);
  };

  const getLogFilePath = (workDir: string) => {
    return `${workDir}${pathSep}logs${pathSep}${APP_SLUG}.log`;
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.workplaceDescription}
        </p>
      </div>

      {/* Default Sandbox */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.defaultSandbox}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.defaultSandboxDescription}
        </p>
        <div className="grid max-w-md grid-cols-2 gap-2">
          {sandboxOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = settings.defaultSandboxProvider === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    sandboxEnabled: true,
                    defaultSandboxProvider: option.id,
                  })
                }
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent',
                )}
              >
                <Icon
                  className={cn(
                    'size-5 shrink-0',
                    isSelected ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <div className="min-w-0">
                  <div
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium',
                      isSelected ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    <span>
                      {t.settings[option.nameKey as keyof typeof t.settings]}
                    </span>
                    <SandboxProviderBadge
                      enforcement={option.enforcement}
                      marketplaceEligible={option.marketplaceEligible}
                    />
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {t.settings[option.descKey as keyof typeof t.settings]}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {settings.defaultSandboxProvider === 'native' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {(t.settings as Record<string, string>).sandboxNativeWarning}
          </p>
        )}
      </div>

      {/* Working Directory */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.workingDirectory}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.workingDirectoryDescription}
        </p>
        <div className="flex items-center gap-2">
          {editingPath ? (
            <input
              ref={inputRef}
              type="text"
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
              onBlur={commitPathEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitPathEdit();
                if (e.key === 'Escape') setEditingPath(false);
              }}
              className="border-input bg-background text-foreground focus:ring-primary h-10 max-w-md flex-1 rounded-lg border px-3 text-sm focus:ring-1 focus:outline-none"
              spellCheck={false}
            />
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="border-input bg-muted text-foreground hover:border-primary/50 flex h-10 max-w-md flex-1 cursor-text items-center rounded-lg border px-3 text-left text-sm transition-colors"
              title={t.settings.browseFolder}
            >
              {settings.workDir || defaultPaths.workDir || (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleBrowseFolder}
            disabled={migrating}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors disabled:opacity-50"
            title={t.settings.browseFolder}
          >
            {migrating ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <FolderInput className="size-5" />
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              openFolderInSystem(settings.workDir || defaultPaths.workDir)
            }
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
            title={t.settings.skillsOpenFolder}
          >
            <FolderOpen className="size-5" />
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.settings.directoryStructure.replace('{path}', settings.workDir)}
        </p>

        {/* Unmigrated sessions banner */}
        {pendingMigration && !migrating && (
          <div className="border-primary/20 bg-primary/5 flex max-w-md items-center justify-between rounded-lg border px-3 py-2">
            <p className="text-foreground/80 text-xs">
              {t.settings.migrateSessionsMessage
                .replace('{count}', String(pendingMigration.sessionCount))
                .replace('{size}', String(pendingMigration.totalMB))}
            </p>
            <button
              type="button"
              onClick={handleMigratePending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 ml-3 shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors"
            >
              {t.settings.migrateSessionsMove}
            </button>
          </div>
        )}

        {/* Session migration progress bar */}
        {migrating && progress && (
          <div className="max-w-md space-y-1.5">
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground truncate pr-4">
                {progress.phase === 'scan' &&
                  t.settings.migrateWorkspaceScanning}
                {progress.phase === 'copy' &&
                  t.settings.migrateSessionsCopying.replace(
                    '{percent}',
                    String(progress.percent),
                  )}
                {progress.phase === 'db' &&
                  t.settings.migrateSessionsUpdatingDb}
              </span>
              {progress.phase === 'copy' && progress.total > 0 && (
                <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                  {progress.copied}/{progress.total}
                </span>
              )}
            </div>
            {progress.phase === 'copy' && progress.currentFile && (
              <p className="text-muted-foreground/50 truncate text-[10px]">
                {progress.currentFile}
              </p>
            )}
          </div>
        )}

        {/* Final status message */}
        {!migrating && status && (
          <p
            className={cn(
              'text-xs',
              status === t.settings.migrateWorkspaceFailed
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {status}
          </p>
        )}
      </div>

      {/* Auto-play Media */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <label className="text-foreground text-sm font-medium">
              {t.settings.autoPlayMedia}
            </label>
            <p className="text-muted-foreground text-xs">
              {t.settings.autoPlayMediaDescription}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.autoPlayMedia ?? false}
            onClick={() =>
              onSettingsChange({
                ...settings,
                autoPlayMedia: !settings.autoPlayMedia,
              })
            }
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
              settings.autoPlayMedia
                ? 'bg-primary focus:ring-primary'
                : 'bg-input focus:ring-ring',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform',
                settings.autoPlayMedia ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      {/* Log File */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.logFile}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.logFileDescription}
        </p>
        <div className="flex items-center gap-2">
          <div className="border-input bg-muted text-foreground flex h-10 max-w-md flex-1 items-center rounded-lg border px-3 text-sm">
            {getLogFilePath(settings.workDir || defaultPaths.workDir)}
          </div>
          <button
            type="button"
            onClick={() =>
              openFolderInSystem(
                getLogFilePath(settings.workDir || defaultPaths.workDir),
              )
            }
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
            title={t.settings.logFileOpen}
          >
            <FileText className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
