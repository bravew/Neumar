/**
 * AutomationCard
 *
 * Card component for a single automation in the list view.
 */

import { Monitor, MoreHorizontal, Play, Power, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatAutomationTriggerSummary } from '@/shared/lib/schedule-summary';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { Automation } from '@/shared/types/automation';

import { getTriggerIcon, ORIGIN_STYLES, PLATFORM_ICONS } from './utils';

interface AutomationCardProps {
  automation: Automation;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
  onTrigger: () => void;
  onDelete: () => void;
}

/** Get human-readable trigger description */
function getTriggerDescription(
  automation: Automation,
  t: {
    automation: {
      trigger: Record<string, string>;
      scheduleSummary: Parameters<typeof formatAutomationTriggerSummary>[1];
      unknown: string;
    };
  },
): string {
  return (
    formatAutomationTriggerSummary(
      automation.trigger,
      t.automation.scheduleSummary,
    ) ??
    t.automation.trigger[automation.trigger.type] ??
    t.automation.unknown
  );
}

export function AutomationCard({
  automation,
  onClick,
  onToggle,
  onTrigger,
  onDelete,
}: AutomationCardProps) {
  const { t } = useLanguage();
  const TriggerIcon = getTriggerIcon(automation.trigger.type);
  const triggerDesc = getTriggerDescription(automation, t);

  return (
    <div
      className={cn(
        'bg-card hover:bg-muted/50 group cursor-pointer rounded-xl border p-4 transition-all',
        !automation.enabled && 'opacity-60',
      )}
      data-testid={`automation-card-${automation.id}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label={`${t.automation.title}: ${automation.name}`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-lg',
              automation.enabled
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <TriggerIcon className="size-4" />
          </div>
          <div>
            <h3 className="text-foreground text-sm font-semibold">
              {automation.name}
            </h3>
            <p className="text-muted-foreground text-xs">{triggerDesc}</p>
          </div>
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
          role="group"
          aria-label={t.automation.moreActions}
        >
          <Button
            variant="ghost"
            size="sm"
            data-testid={`automation-run-${automation.id}`}
            onClick={onTrigger}
            disabled={!automation.enabled}
            className="opacity-0 group-hover:opacity-100"
            aria-label={t.automation.runNow}
          >
            <Play className="size-3.5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.automation.moreActions}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onToggle(!automation.enabled)}>
                <Power className="mr-2 size-4" />
                {automation.enabled
                  ? t.automation.disable
                  : t.automation.enable}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-red-500 focus:text-red-500"
              >
                <Trash2 className="mr-2 size-4" />
                {t.automation.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Description */}
      {automation.description && (
        <p className="text-muted-foreground mb-2 line-clamp-2 text-xs">
          {automation.description}
        </p>
      )}

      {/* Footer: status + metadata */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-2 rounded-full',
              automation.enabled ? 'bg-green-500' : 'bg-gray-400',
            )}
            aria-label={
              automation.enabled ? t.automation.enable : t.automation.disable
            }
          />
          <span className="text-muted-foreground text-xs">
            {automation.enabled ? t.automation.active : t.automation.inactive}
          </span>
        </div>
        {automation.origin && automation.origin !== 'ui' && (
          <OriginBadge origin={automation.origin} />
        )}
        {automation.runCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {t.automation.runCountLabel.replace(
              '{count}',
              String(automation.runCount),
            )}
          </span>
        )}
        {automation.totalCost > 0 && (
          <span className="text-muted-foreground text-xs">
            {t.automation.costLabel.replace(
              '{amount}',
              automation.totalCost.toFixed(2),
            )}
          </span>
        )}
        {automation.channelDelivery && (
          <PlatformBadge platform={automation.channelDelivery.platform} />
        )}
        {automation.expiresAt && (
          <span className="text-muted-foreground text-xs">
            {t.automation.lifecycle.expiresOn.replace(
              '{date}',
              new Date(automation.expiresAt).toLocaleDateString(),
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Badge Sub-components
// ============================================================================

function PlatformBadge({ platform }: { platform: string }) {
  const Icon = PLATFORM_ICONS[platform] ?? Monitor;
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs">
      <Icon className="size-3" />
      <span className="text-muted-foreground capitalize">{platform}</span>
    </span>
  );
}

function OriginBadge({ origin }: { origin: string }) {
  const { t } = useLanguage();
  const label =
    t.automation.origin[origin as keyof typeof t.automation.origin] ?? origin;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium',
        ORIGIN_STYLES[origin] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}
