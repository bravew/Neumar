/**
 * AutomationMetadata
 *
 * Displays origin, delivery, lifecycle, condition, and timing
 * metadata for an automation in the detail view.
 */

import {
  Calendar,
  Hash,
  MessageSquare,
  Monitor,
  Play,
  Target,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { Automation } from '@/shared/types/automation';

import { ORIGIN_STYLES, parseConversationId, PLATFORM_ICONS } from './utils';

export function AutomationMetadata({ automation }: { automation: Automation }) {
  const { t } = useLanguage();
  const originLabel =
    t.automation.origin[
      automation.origin as keyof typeof t.automation.origin
    ] ?? automation.origin;
  const deliveryPlatform = automation.channelDelivery?.platform;
  const deliveryLabel = deliveryPlatform
    ? (t.automation.channelDelivery[
        deliveryPlatform as keyof typeof t.automation.channelDelivery
      ] ?? deliveryPlatform)
    : t.automation.delivery.desktop;
  const PlatformIcon = PLATFORM_ICONS[deliveryPlatform ?? 'desktop'] ?? Monitor;
  const hasLimits =
    automation.maxRuns !== undefined || automation.costBudget !== undefined;

  const deliveryParsed = parseConversationId(
    automation.channelDelivery?.conversationId,
  );
  const originParsed = parseConversationId(
    automation.originChannel?.conversationId,
  );
  // Use delivery details, fall back to origin details
  const channelInfo = deliveryParsed ?? originParsed;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Origin & Delivery (combined) */}
      <div className="rounded-lg border p-3">
        <p className="text-muted-foreground mb-1 text-xs font-medium">
          {t.automation.detail.origin} / {t.automation.detail.delivery}
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              ORIGIN_STYLES[automation.origin ?? ''] ??
                'bg-muted text-muted-foreground',
            )}
          >
            {originLabel}
          </span>
          <PlatformIcon className="text-muted-foreground size-3.5" />
          <span className="text-foreground text-sm">{deliveryLabel}</span>
        </div>
        {channelInfo && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1.5">
              <Hash className="text-muted-foreground size-3" />
              <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
                {channelInfo.channelId}
              </code>
            </div>
            {channelInfo.threadTs && (
              <div className="flex items-center gap-1.5">
                <MessageSquare className="text-muted-foreground size-3" />
                <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
                  {channelInfo.threadTs}
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Limits / Lifecycle */}
      <div className="rounded-lg border p-3">
        <p className="text-muted-foreground mb-1 text-xs font-medium">
          {t.automation.detail.limits}
        </p>
        {hasLimits ? (
          <div className="space-y-0.5">
            {automation.maxRuns !== undefined && (
              <p className="text-foreground text-sm">
                {t.automation.detail.maxRuns
                  .replace('{count}', String(automation.runCount))
                  .replace('{max}', String(automation.maxRuns))}
              </p>
            )}
            {automation.costBudget !== undefined && (
              <p className="text-foreground text-sm">
                {t.automation.detail.costBudget
                  .replace('{used}', automation.totalCost.toFixed(2))
                  .replace('{budget}', automation.costBudget.toFixed(2))}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t.automation.detail.noLimit}
          </p>
        )}
      </div>

      {/* Condition (if set) */}
      {automation.condition && (
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.detail.condition}
          </p>
          <div className="flex items-center gap-2">
            <Target className="text-muted-foreground size-3.5 shrink-0" />
            <p className="text-foreground text-sm">
              {automation.condition.description}
            </p>
          </div>
        </div>
      )}

      {/* Created at */}
      <div className="rounded-lg border p-3">
        <p className="text-muted-foreground mb-1 text-xs font-medium">
          {t.automation.detail.createdAt}
        </p>
        <div className="flex items-center gap-2">
          <Calendar className="text-muted-foreground size-3.5" />
          <span className="text-foreground text-sm">
            {new Date(automation.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {/* Next run */}
      {automation.nextRunAt && (
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.detail.nextRun}
          </p>
          <div className="flex items-center gap-2">
            <Play className="text-muted-foreground size-3.5" />
            <span className="text-foreground text-sm">
              {new Date(automation.nextRunAt).toLocaleString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
