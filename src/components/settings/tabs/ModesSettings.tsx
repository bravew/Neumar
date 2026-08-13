import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';

import {
  DEFAULT_DESIGN_MODE_SETTINGS,
  DEFAULT_MODES_SETTINGS,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { ModeRegistry } from '@/shared/modes/ModeRegistry';
import type { ModeDefinition } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';

function normalizeOrder(order: string[], modeIds: string[]) {
  const known = order.filter((id) => modeIds.includes(id));
  return [...known, ...modeIds.filter((id) => !known.includes(id))];
}

export function ModesSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t, tt } = useLanguage();
  const config = { ...DEFAULT_MODES_SETTINGS, ...settings.modes };
  const modes = ModeRegistry.list({ includeDisabled: true });
  const order = normalizeOrder(config.order ?? DEFAULT_MODES_SETTINGS.order, [
    ...modes.map((mode) => mode.id),
  ]);
  const orderedModes = order
    .map((id) => modes.find((mode) => mode.id === id))
    .filter((mode): mode is ModeDefinition => Boolean(mode));

  const updateOrder = (nextOrder: string[]) => {
    onSettingsChange({
      ...settings,
      modes: { ...config, order: nextOrder },
    });
  };

  const moveMode = (modeId: string, direction: -1 | 1) => {
    const index = order.indexOf(modeId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[nextIndex]] = [
      nextOrder[nextIndex],
      nextOrder[index],
    ];
    updateOrder(nextOrder);
  };

  const modeEnabled = (modeId: string) => {
    if (modeId === 'tasks') return true;
    if (modeId === 'design') {
      return (settings.designMode ?? DEFAULT_DESIGN_MODE_SETTINGS).enabled;
    }
    if (modeId === 'automate') return config.automateEnabled;
    if (modeId === 'chat') return config.chatEnabled;
    if (modeId === 'video') return config.videoEnabled;
    return true;
  };

  const setModeEnabled = (modeId: string, enabled: boolean) => {
    if (modeId === 'tasks') return;
    if (modeId === 'design') {
      onSettingsChange({
        ...settings,
        designMode: {
          ...DEFAULT_DESIGN_MODE_SETTINGS,
          ...settings.designMode,
          enabled,
        },
      });
      return;
    }
    onSettingsChange({
      ...settings,
      modes: {
        ...config,
        automateEnabled:
          modeId === 'automate' ? enabled : config.automateEnabled,
        chatEnabled: modeId === 'chat' ? enabled : config.chatEnabled,
        videoEnabled: modeId === 'video' ? enabled : config.videoEnabled,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t.settings.modesHeading}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.settings.modesDescription}
        </p>
      </div>

      <div className="space-y-2">
        {orderedModes.map((mode, index) => {
          const enabled = modeEnabled(mode.id);
          const locked = mode.id === 'tasks';
          const Icon = mode.icon;
          return (
            <div
              key={mode.id}
              className="border-border bg-card flex items-center gap-3 rounded-lg border p-3"
            >
              <Icon className="text-muted-foreground size-4" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{tt(mode.labelKey)}</div>
                <div className="text-muted-foreground text-xs">
                  {locked
                    ? t.settings.modeTasksLocked
                    : enabled
                      ? t.settings.enabled
                      : t.settings.disabled}
                </div>
              </div>
              <button
                type="button"
                disabled={index === 0}
                aria-label={t.settings.moveUp}
                onClick={() => moveMode(mode.id, -1)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                disabled={index === orderedModes.length - 1}
                aria-label={t.settings.moveDown}
                onClick={() => moveMode(mode.id, 1)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md disabled:opacity-30"
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                disabled={locked}
                aria-pressed={enabled}
                aria-label={t.settings.modeToggle}
                onClick={() => setModeEnabled(mode.id, !enabled)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors disabled:opacity-50',
                  enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              >
                <span
                  className={cn(
                    'bg-background absolute top-0.5 left-0.5 size-5 rounded-full transition-transform',
                    enabled && 'translate-x-5',
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => updateOrder(DEFAULT_MODES_SETTINGS.order)}
        className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
      >
        <RotateCcw className="size-4" />
        {t.settings.resetModeOrder}
      </button>
    </div>
  );
}
