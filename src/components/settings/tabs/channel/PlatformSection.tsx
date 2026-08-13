import { AlertTriangle, Plus } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { BotRow } from './BotRow';
import { PlatformIcon } from './PlatformIcon';
import {
  PLATFORM_LABELS,
  type ChannelStatus,
  type Platform,
  type PlatformConfig,
} from './types';

interface PlatformSectionProps {
  platform: Platform;
  configs: PlatformConfig[];
  statuses: Record<string, ChannelStatus>;
  expanded: string | null;
  saving: string | null;
  starting: string | null;
  testing: string | null;
  startErrors: Record<string, string>;
  testResults: Record<string, { valid: boolean; error?: string }>;
  botError: string | undefined;
  onAddBot: (platform: Platform) => void;
  onToggleExpanded: (configId: string) => void;
  onTest: (configId: string, creds?: Record<string, string>) => Promise<void>;
  onToggleRunning: (configId: string) => Promise<void>;
  onRequestDelete: (configId: string) => void;
  onSave: (
    configId: string,
    platform: Platform,
    creds: Record<string, string>,
    partial: Partial<PlatformConfig>,
  ) => Promise<void>;
}

export function PlatformSection({
  platform,
  configs,
  statuses,
  expanded,
  saving,
  starting,
  testing,
  startErrors,
  testResults,
  botError,
  onAddBot,
  onToggleExpanded,
  onTest,
  onToggleRunning,
  onRequestDelete,
  onSave,
}: PlatformSectionProps) {
  const { t } = useLanguage();
  const s = t.settings;

  return (
    <div>
      <div className="bg-muted/30 flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <PlatformIcon id={platform} />
          <span className="text-foreground text-sm font-medium">
            {PLATFORM_LABELS[platform]}
          </span>
          {configs.length > 0 && (
            <span className="text-muted-foreground text-xs">
              (
              {s?.channelBotCount
                ? s.channelBotCount.replace('{n}', String(configs.length))
                : `${configs.length} bot${configs.length !== 1 ? 's' : ''}`}
              )
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onAddBot(platform)}
          className="text-muted-foreground hover:text-foreground cursor-pointer rounded p-1 transition-colors hover:bg-gray-500/10"
          title={s?.channelAddBot ?? 'Add bot'}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {configs.map((cfg) => (
        <BotRow
          key={cfg.id}
          cfg={cfg}
          platform={platform}
          status={statuses[cfg.id]}
          isExpanded={expanded === cfg.id}
          starting={starting === cfg.id}
          saving={saving === cfg.id}
          testing={testing === cfg.id}
          startError={startErrors[cfg.id]}
          testResult={testResults[cfg.id] ?? null}
          onToggleExpanded={() => onToggleExpanded(cfg.id)}
          onTest={(creds) => onTest(cfg.id, creds)}
          onToggleRunning={() => onToggleRunning(cfg.id)}
          onRequestDelete={() => onRequestDelete(cfg.id)}
          onSave={(creds, partial) => onSave(cfg.id, platform, creds, partial)}
        />
      ))}

      {botError && (
        <div className="flex items-center gap-1 px-8 py-2 text-xs text-red-600">
          <AlertTriangle className="size-3 shrink-0" />
          {botError}
        </div>
      )}

      {configs.length === 0 && (
        <div className="text-muted-foreground px-8 py-3 text-sm">
          {s?.channelNoBots ?? 'No bots configured. Click + to add one.'}
        </div>
      )}
    </div>
  );
}
