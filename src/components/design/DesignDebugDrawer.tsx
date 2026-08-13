import { useState, type ReactNode } from 'react';

import { Copy, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignDebugSnapshot } from '@/shared/types/design-mode';

import { HfRenderLog } from './HfRenderLog';

type DebugTab = 'overview' | 'prompts' | 'provenance' | 'history' | 'log';

export function DesignDebugDrawer({
  snapshot,
  loading,
  error,
  onClose,
}: {
  snapshot: DesignDebugSnapshot | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<DebugTab>('overview');
  const tabs: Array<{ id: DebugTab; label: string }> = [
    { id: 'overview', label: t.design.debugOverview },
    { id: 'prompts', label: t.design.debugPrompts },
    { id: 'provenance', label: t.design.debugProvenance },
    { id: 'history', label: t.design.debugHistory },
    { id: 'log', label: t.design.debugRenderLog },
  ];

  return (
    <aside
      className="border-border bg-card flex h-full w-[30rem] shrink-0 flex-col border-l"
      data-testid="design-debug-drawer"
    >
      <header className="border-border flex items-center justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t.design.projectDebug}</h2>
          {snapshot && (
            <p className="text-muted-foreground truncate text-xs">
              {snapshot.project.id}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.design.close}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="border-border flex shrink-0 gap-1 overflow-x-auto border-b p-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs ${
              tab === item.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-muted-foreground text-sm">
            {t.design.loadingDebug}
          </p>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : !snapshot ? (
          <p className="text-muted-foreground text-sm">
            {t.design.noDebugData}
          </p>
        ) : (
          <DebugPanel snapshot={snapshot} tab={tab} />
        )}
      </div>
    </aside>
  );
}

function DebugPanel({
  snapshot,
  tab,
}: {
  snapshot: DesignDebugSnapshot;
  tab: DebugTab;
}) {
  const { t } = useLanguage();
  if (tab === 'prompts') {
    return (
      <div className="space-y-4">
        <JsonBlock
          title={t.design.systemPrompt}
          value={snapshot.prompts.system}
        />
        <JsonBlock title={t.design.userPrompt} value={snapshot.prompts.user} />
        <JsonBlock
          title={t.design.debugPromptTemplate}
          value={snapshot.prompts.template ?? t.design.notResolvedYet}
        />
        <JsonBlock
          title={t.design.debugPromptStack}
          value={snapshot.prompts.stack ?? t.design.notResolvedYet}
        />
      </div>
    );
  }
  if (tab === 'provenance') {
    return (
      <div className="space-y-4">
        <div className="text-muted-foreground rounded-md border p-3 text-xs">
          {t.design.debugInvalidLines}:{' '}
          {snapshot.provenance.invalidLines.assets} {t.design.debugAssets} ·{' '}
          {snapshot.provenance.invalidLines.tasks} {t.design.debugTasks} ·{' '}
          {snapshot.provenance.invalidLines.history} {t.design.debugHistory}
        </div>
        <JsonBlock
          title={t.design.debugAssets}
          value={snapshot.provenance.assets}
        />
        <JsonBlock
          title={t.design.debugTasks}
          value={snapshot.provenance.tasks}
        />
      </div>
    );
  }
  if (tab === 'history') {
    return (
      <div className="space-y-3">
        {snapshot.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t.design.noDebugData}
          </p>
        ) : (
          snapshot.history
            .slice()
            .reverse()
            .map((event, index) => (
              <EventRow key={index} event={event} index={index} />
            ))
        )}
      </div>
    );
  }
  if (tab === 'log') {
    return snapshot.renderLog.length > 0 ? (
      <HfRenderLog lines={snapshot.renderLog} />
    ) : (
      <p className="text-muted-foreground text-sm">{t.design.noRenderLog}</p>
    );
  }

  const metrics = snapshot.metrics;
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold uppercase">
          {t.design.debugMetrics}
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricItem label={t.design.debugAssets} value={metrics.assetCount} />
          <MetricItem
            label={t.design.debugExports}
            value={metrics.exportCount}
          />
          <MetricItem
            label={t.design.debugLint}
            value={metrics.lintFindingCount}
          />
          <MetricItem
            label={t.design.debugEdits}
            value={metrics.targetedEditCount}
          />
          <MetricItem
            label={t.design.debugFirstPreview}
            value={formatDuration(metrics.timeToFirstPreviewMs)}
          />
          <MetricItem
            label={t.design.debugFirstExport}
            value={formatDuration(metrics.timeToFirstExportMs)}
          />
        </div>
      </section>
      <JsonBlock title={t.design.debugManifest} value={snapshot.project} />
      <JsonBlock title={t.design.debugExports} value={snapshot.exports} />
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function EventRow({ event, index }: { event: unknown; index: number }) {
  const record = asRecord(event);
  const timestamp =
    typeof record.at === 'string' || typeof record.at === 'number'
      ? String(record.at)
      : '';
  return (
    <div className="rounded-md border p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          {String(record.type ?? `event.${index + 1}`)}
        </span>
        {timestamp && (
          <span className="text-muted-foreground">{timestamp}</span>
        )}
      </div>
      <pre className="text-muted-foreground mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
        {formatJson(event)}
      </pre>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const { t } = useLanguage();
  const copy = () => navigator.clipboard?.writeText(formatJson(value));
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.design.copy}
          onClick={() => void copy()}
        >
          <Copy className="size-4" />
        </Button>
      </div>
      <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
        {formatJson(value) || t.design.noDebugData}
      </pre>
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function formatJson(value: unknown) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formatDuration(value: number | null) {
  if (value === null) return 'n/a';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}
