import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Play,
  Square,
  Trash2,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { StatusBadge } from './PlatformIcon';
import { PlatformPanel } from './PlatformPanel';
import {
  PLATFORM_LABELS,
  type ChannelStatus,
  type Platform,
  type PlatformConfig,
} from './types';

interface BotRowProps {
  cfg: PlatformConfig;
  platform: Platform;
  status: ChannelStatus | undefined;
  isExpanded: boolean;
  starting: boolean;
  saving: boolean;
  testing: boolean;
  startError: string | undefined;
  testResult: { valid: boolean; error?: string } | null;
  onToggleExpanded: () => void;
  onTest: (creds?: Record<string, string>) => Promise<void>;
  onToggleRunning: () => void;
  onRequestDelete: () => void;
  onSave: (
    creds: Record<string, string>,
    partial: Partial<PlatformConfig>,
  ) => Promise<void>;
}

export function BotRow({
  cfg,
  platform,
  status,
  isExpanded,
  starting,
  saving,
  testing,
  startError,
  testResult,
  onToggleExpanded,
  onTest,
  onToggleRunning,
  onRequestDelete,
  onSave,
}: BotRowProps) {
  const { t } = useLanguage();
  const s = t.settings;
  const state = status?.state;
  const isRunning = state === 'running';
  const runtimeClass =
    status?.runtimeClass ?? status?.capabilities?.runtimeClass;

  return (
    <div className="border-border/50 border-t">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 pl-8"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground size-3.5" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3.5" />
          )}
          <span className="text-foreground text-sm">
            {cfg.name || `${PLATFORM_LABELS[platform]} Bot`}
          </span>
          {runtimeClass && runtimeClass !== 'official' && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                runtimeClass === 'bridge'
                  ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
              )}
            >
              {runtimeClass}
            </span>
          )}
          {starting ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
              <Loader2 className="size-3 animate-spin" />
              {s?.channelStarting ?? 'starting…'}
            </span>
          ) : startError ? (
            <span
              className="inline-flex max-w-48 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600"
              title={startError}
            >
              <AlertTriangle className="size-3 shrink-0" />
              <span className="truncate">{startError}</span>
            </span>
          ) : state ? (
            <StatusBadge state={state} />
          ) : (
            <span className="text-muted-foreground text-xs">
              {s?.channelNotConfigured ?? 'Not configured'}
            </span>
          )}
        </div>

        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onTest()}
            disabled={testing || !cfg.configured}
            title={
              cfg.configured
                ? (s?.channelTestConnection ?? 'Test Connection')
                : 'Save token first'
            }
            className="text-muted-foreground hover:text-foreground cursor-pointer rounded p-1.5 transition-colors hover:bg-gray-500/10 disabled:opacity-30"
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FlaskConical className="size-3.5" />
            )}
          </button>
          {cfg.configured && (
            <button
              type="button"
              onClick={onToggleRunning}
              disabled={starting}
              title={
                isRunning
                  ? (s?.gatewayChannelStop ?? 'Stop')
                  : (s?.gatewayChannelStart ?? 'Start')
              }
              className={cn(
                'cursor-pointer rounded p-1.5 transition-colors disabled:opacity-40',
                isRunning
                  ? 'text-red-600 hover:bg-red-500/10'
                  : 'text-green-600 hover:bg-green-500/10',
              )}
            >
              {starting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isRunning ? (
                <Square className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onRequestDelete}
            title={s?.channelDeleteBot ?? 'Delete bot'}
            className="text-muted-foreground cursor-pointer rounded p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </button>

      {isExpanded && (
        <PlatformPanel
          platform={platform}
          configId={cfg.id}
          config={cfg}
          onSave={onSave}
          onTest={(creds) => onTest(creds)}
          saving={saving}
          testing={testing}
          testResult={testResult}
        />
      )}
    </div>
  );
}
