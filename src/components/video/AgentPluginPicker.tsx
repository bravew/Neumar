import { ShieldAlert, WandSparkles } from 'lucide-react';

import {
  useVideoPlugins,
  type VideoPluginSummary,
} from '@/shared/hooks/useVideoPlugins';

export interface AgentPluginPickerLabels {
  title: string;
  loading: string;
  empty: string;
  use: string;
  reviewRequired: string;
  reviewConfirm: string;
  capabilities: string;
  applyFailed: string;
  applyNetworkError: string;
  retry: string;
}

interface AgentPluginPickerProps {
  labels: AgentPluginPickerLabels;
  disabled: boolean;
  onSelect: (plugin: VideoPluginSummary) => void;
}

export function AgentPluginPicker({
  labels,
  disabled,
  onSelect,
}: AgentPluginPickerProps) {
  const { plugins, loading, error } = useVideoPlugins();

  if (loading) {
    return (
      <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-xs">
        {labels.loading}
      </div>
    );
  }

  if (error || plugins.length === 0) {
    return (
      <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-xs">
        {labels.empty}
      </div>
    );
  }

  return (
    <section className="space-y-2" aria-label={labels.title}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium uppercase">
        <WandSparkles className="size-3" />
        {labels.title}
      </div>
      <div className="grid gap-2">
        {plugins.map((plugin) => (
          <button
            key={`${plugin.id}:${plugin.version}`}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(plugin)}
            className="border-border hover:bg-accent disabled:text-muted-foreground block min-w-0 rounded-md border px-3 py-2 text-left disabled:opacity-50"
          >
            <span className="flex min-w-0 gap-2">
              <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded">
                <WandSparkles className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-xs font-medium">
                  {plugin.title}
                </span>
                <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-[11px] leading-4">
                  {plugin.description}
                </span>
                <span className="text-muted-foreground mt-1 flex min-w-0 items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">
                    {plugin.mode} / {plugin.engine.id} /{' '}
                    {labels.capabilities.replace(
                      '{count}',
                      String(plugin.impliedCapabilities.length),
                    )}
                  </span>
                  <span className="text-foreground shrink-0 font-medium">
                    {labels.use}
                  </span>
                </span>
              </span>
              {plugin.requiresReview ? (
                <span className="inline-flex shrink-0 items-start pt-0.5 text-amber-600 dark:text-amber-300">
                  <ShieldAlert
                    className="size-3.5"
                    aria-label={labels.reviewRequired}
                  />
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
