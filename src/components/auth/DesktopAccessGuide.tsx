/**
 * Desktop Access Guide
 *
 * Guides users through granting macOS system permissions needed for
 * the AI agent to interact with desktop applications like Chrome,
 * iMessage, Notes, and Notion.
 *
 * These permissions are managed at the OS level (System Settings > Privacy & Security).
 * The app can only check status and direct the user to grant access.
 */

import { useMemo, useState } from 'react';

import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Globe,
  HardDrive,
  Info,
  Loader2,
  MessageCircle,
  Mic,
  Monitor,
  Mouse,
  RefreshCw,
  StickyNote,
} from 'lucide-react';

import { APP_DISPLAY_NAME } from '@/config/branding';
import { usePermissions } from '@/shared/hooks/usePermissions';
import type {
  PermissionStatus,
  PermissionType,
} from '@/shared/hooks/usePermissions';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Permission Groups
// ============================================================================

interface PermissionGroup {
  id: string;
  title: string;
  description: string;
  permissionType: PermissionType;
  icon: React.ElementType;
  apps: Array<{
    name: string;
    icon: React.ElementType;
    requires: string;
  }>;
  howToGrant: string;
}

// Static config — only non-translated values. Titles, descriptions, and
// howToGrant strings are built at render time from the active locale.
const PERMISSION_CONFIG = [
  {
    id: 'accessibility',
    permissionType: 'accessibility' as PermissionType,
    icon: Mouse,
    apps: [
      { name: 'Chrome', icon: Globe },
      { name: 'Notes', icon: StickyNote },
      { name: 'Notion', icon: FileText },
    ],
  },
  {
    id: 'screenRecording',
    permissionType: 'screenRecording' as PermissionType,
    icon: Monitor,
    apps: [{ name: 'Any app', icon: Monitor }],
  },
  {
    id: 'microphone',
    permissionType: 'microphone' as PermissionType,
    icon: Mic,
    apps: [],
  },
  {
    id: 'fullDiskAccess',
    permissionType: 'fullDiskAccess' as PermissionType,
    icon: HardDrive,
    apps: [
      { name: 'iMessage', icon: MessageCircle },
      { name: 'Mail', icon: FileText },
    ],
  },
] as const;

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({
  status,
  isNative,
}: {
  status: PermissionStatus;
  isNative: boolean;
}) {
  const { t } = useLanguage();

  if (!isNative) {
    return (
      <span className="text-muted-foreground/50 flex items-center gap-1 text-[10px]">
        <Info className="size-2.5" />
        {t.settings.permDesktopOnly}
      </span>
    );
  }

  if (status === 'authorized') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
        <Check className="size-2.5" />
        {t.settings.permGranted}
      </span>
    );
  }
  if (status === 'denied') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
        <AlertTriangle className="size-2.5" />
        {t.settings.permDenied}
      </span>
    );
  }
  if (status === 'not_determined') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
        {t.settings.permNotRequested}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground flex items-center gap-1 rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium">
      {t.settings.permNotChecked}
    </span>
  );
}

// ============================================================================
// Permission Row
// ============================================================================

function PermissionRow({
  group,
  status,
  isNative,
  onRequest,
  onOpenSettings,
}: {
  group: PermissionGroup;
  status: PermissionStatus;
  isNative: boolean;
  onRequest: (type: PermissionType) => Promise<boolean>;
  onOpenSettings: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [requesting, setRequesting] = useState(false);
  const [lastResult, setLastResult] = useState<'granted' | 'denied' | null>(
    null,
  );
  const isGranted = status === 'authorized';
  const Icon = group.icon;

  const handleGrant = async () => {
    setRequesting(true);
    setLastResult(null);
    try {
      const granted = await onRequest(group.permissionType);
      setLastResult(granted ? 'granted' : 'denied');
      if (!granted) {
        await onOpenSettings();
      }
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div
      className={cn(
        'border-border rounded-lg border transition-all',
        isGranted ? 'bg-muted/20' : 'bg-background',
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg',
            isGranted ? 'text-green-500' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-sm font-medium">
              {group.title}
            </span>
            <StatusBadge status={status} isNative={isNative} />
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {group.description}
          </p>

          {/* Apps that need this permission */}
          {group.apps.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.apps.map((app) => {
                const AppIcon = app.icon;
                return (
                  <span
                    key={app.name}
                    className="bg-muted text-muted-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                    title={app.requires}
                  >
                    <AppIcon className="size-2.5" />
                    {app.name}
                  </span>
                );
              })}
            </div>
          )}

          {/* How to grant — shown when not granted */}
          {!isGranted && isNative && (
            <p className="text-muted-foreground/70 mt-2 font-mono text-[10px]">
              {group.howToGrant}
            </p>
          )}

          {/* Feedback after grant attempt */}
          {lastResult === 'denied' && !isGranted && (
            <p className="mt-1.5 text-[10px] text-red-500 dark:text-red-400">
              {t.settings.permNotGrantedMessage}
            </p>
          )}
        </div>

        {/* Action button */}
        <div className="shrink-0">
          {!isNative ? (
            <span className="text-muted-foreground/40 text-[10px]">—</span>
          ) : !isGranted ? (
            <button
              onClick={handleGrant}
              disabled={requesting}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              aria-label={`${t.settings.permGrant} ${group.title}`}
            >
              {requesting ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {t.settings.permRequesting}
                </>
              ) : (
                t.settings.permGrant
              )}
            </button>
          ) : (
            <button
              onClick={onOpenSettings}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
              aria-label={`${t.settings.permManage} ${group.title}`}
            >
              <ExternalLink className="size-3" />
              {t.settings.permManage}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DesktopAccessGuide() {
  const {
    permissions,
    loading,
    isNative,
    request,
    refreshAll,
    openSystemSettings,
  } = usePermissions();
  const { t } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);

  const permissionGroups = useMemo((): PermissionGroup[] => {
    const appReqMap: Record<string, Record<string, string>> = {
      accessibility: {
        Chrome: t.settings.permAccessibilityChromeReq,
        Notes: t.settings.permAccessibilityNotesReq,
        Notion: t.settings.permAccessibilityNotionReq,
      },
      screenRecording: {
        'Any app': t.settings.permScreenRecordingAnyAppReq,
      },
      fullDiskAccess: {
        iMessage: t.settings.permFullDiskiMessageReq,
        Mail: t.settings.permFullDiskMailReq,
      },
    };

    const meta: Record<
      string,
      { title: string; description: string; howToGrant: string }
    > = {
      accessibility: {
        title: t.settings.permAccessibilityTitle,
        description: t.settings.permAccessibilityDesc,
        howToGrant: t.settings.permAccessibilityHowToGrant.replace(
          '{app}',
          APP_DISPLAY_NAME,
        ),
      },
      screenRecording: {
        title: t.settings.permScreenRecordingTitle,
        description: t.settings.permScreenRecordingDesc,
        howToGrant: t.settings.permScreenRecordingHowToGrant.replace(
          '{app}',
          APP_DISPLAY_NAME,
        ),
      },
      microphone: {
        title: t.settings.permMicrophoneTitle,
        description: t.settings.permMicrophoneDesc,
        howToGrant: t.settings.permMicrophoneHowToGrant.replace(
          '{app}',
          APP_DISPLAY_NAME,
        ),
      },
      fullDiskAccess: {
        title: t.settings.permFullDiskAccessTitle,
        description: t.settings.permFullDiskAccessDesc,
        howToGrant: t.settings.permFullDiskAccessHowToGrant.replace(
          '{app}',
          APP_DISPLAY_NAME,
        ),
      },
    };

    return PERMISSION_CONFIG.map((config) => ({
      ...config,
      ...meta[config.id],
      apps: config.apps.map((app) => ({
        ...app,
        requires: appReqMap[config.id]?.[app.name] ?? '',
      })),
    }));
  }, [t.settings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  return (
    <div className="space-y-3">
      {/* Web mode notice */}
      {!isNative && (
        <div className="border-border bg-muted/30 flex items-start gap-2 rounded-lg border p-3">
          <Info className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t.settings.permWebModeNotice.replace('{app}', APP_DISPLAY_NAME)}
          </p>
        </div>
      )}

      {/* Refresh button (only useful in Tauri) */}
      {isNative && (
        <div className="flex justify-end">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
            aria-label={t.settings.permRefreshStatus}
          >
            {refreshing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {t.settings.permRefreshStatus}
          </button>
        </div>
      )}

      {permissionGroups.map((group) => (
        <PermissionRow
          key={group.id}
          group={group}
          status={permissions[group.permissionType]}
          isNative={isNative}
          onRequest={request}
          onOpenSettings={openSystemSettings}
        />
      ))}
    </div>
  );
}
