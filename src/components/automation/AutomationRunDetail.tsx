/**
 * AutomationRunDetail
 *
 * Single run detail view with timing, cost, result/error, and action buttons.
 */

import { code } from '@streamdown/code';
import { ArrowLeft, XCircle } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { Button } from '@/components/ui/button';
import { preprocessMarkdown } from '@/shared/lib/markdown-utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AutomationRun } from '@/shared/types/automation';

import { AutomationStatusBadge } from './AutomationStatusBadge';
import { formatDuration } from './utils';

const STREAMDOWN_PLUGINS = { code };

interface AutomationRunDetailProps {
  run: AutomationRun;
  onBack: () => void;
  onCancel?: (runId: string) => void;
}

export function AutomationRunDetail({
  run,
  onBack,
  onCancel,
}: AutomationRunDetailProps) {
  const { t } = useLanguage();
  const isActive = [
    'queued',
    'planning',
    'executing',
    'awaiting_approval',
  ].includes(run.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label={t.common.back}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h3 className="text-foreground text-base font-semibold">
              {t.automation.run.details}
            </h3>
            <p className="text-muted-foreground text-xs">
              ID: {run.id.slice(0, 8)}...
            </p>
          </div>
        </div>

        {isActive && onCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCancel(run.id)}
            aria-label={t.automation.run.cancel}
          >
            <XCircle className="mr-1.5 size-4" />
            {t.automation.run.cancel}
          </Button>
        )}
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.run.status}
          </p>
          <AutomationStatusBadge status={run.status} />
        </div>
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.run.triggeredBy}
          </p>
          <p className="text-foreground text-sm capitalize">
            {run.triggeredBy}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.run.duration}
          </p>
          <p className="text-foreground text-sm">
            {run.durationMs ? formatDuration(run.durationMs) : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.run.cost}
          </p>
          <p className="text-foreground text-sm">
            {run.cost ? `$${run.cost.toFixed(4)}` : '—'}
          </p>
        </div>
      </div>

      {/* Timing */}
      <div className="rounded-lg border p-4">
        <h4 className="text-foreground mb-2 text-sm font-semibold">
          {t.automation.run.timing}
        </h4>
        <div className="text-muted-foreground space-y-1 text-sm">
          <p>
            {t.automation.run.queued}: {new Date(run.queuedAt).toLocaleString()}
          </p>
          {run.startedAt && (
            <p>
              {t.automation.run.started}:{' '}
              {new Date(run.startedAt).toLocaleString()}
            </p>
          )}
          {run.completedAt && (
            <p>
              {t.automation.run.completed}:{' '}
              {new Date(run.completedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Result */}
      {run.result && (
        <div className="rounded-lg border p-4">
          <h4 className="text-foreground mb-2 text-sm font-semibold">
            {t.automation.run.result}
          </h4>
          <div className="prose prose-sm text-foreground [&_:not(pre)>code]:bg-muted max-w-none min-w-0 break-words [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none [&_pre]:max-w-full [&_pre]:overflow-x-auto">
            <Streamdown plugins={STREAMDOWN_PLUGINS}>
              {preprocessMarkdown(run.result)}
            </Streamdown>
          </div>
        </div>
      )}

      {/* Error */}
      {run.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <h4 className="mb-2 text-sm font-semibold text-red-700 dark:text-red-400">
            {t.automation.run.error}
          </h4>
          <p className="font-mono text-sm whitespace-pre-wrap text-red-600 dark:text-red-400">
            {run.error}
          </p>
        </div>
      )}
    </div>
  );
}
