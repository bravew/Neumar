import { useEffect, useMemo, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  listDesignSystems,
  updateDesignProject,
} from '@/shared/hooks/useDesignMode';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignProject,
  DesignSystemRecord,
} from '@/shared/types/design-mode';

import { DesignSystemComponentsPreview } from './DesignSystemComponentsPreview';
import { Swatches } from './DesignSystemPicker';

export function ProjectDesignSystemSwitcher({
  project,
  onProjectChange,
}: {
  project: DesignProject;
  onProjectChange: (project: DesignProject) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [systems, setSystems] = useState<DesignSystemRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // The row the right preview pane reflects: a hovered system, the `none` row,
  // or (default) the currently-selected system.
  const [hoveredId, setHoveredId] = useState<string | 'none' | null>(null);

  useEffect(() => {
    if (!open) {
      // Clear hover so a re-open shows the selected system, not a stale row.
      setHoveredId(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError('');
    listDesignSystems({ signal: ac.signal })
      .then((data) => {
        if (!ac.signal.aborted) setSystems(data.designSystems);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open]);

  const selected = project.designSystemId
    ? systems.find((system) => system.id === project.designSystemId)
    : undefined;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return systems;
    return systems.filter(
      (system) =>
        system.title.toLowerCase().includes(q) ||
        system.id.toLowerCase().includes(q) ||
        system.category.toLowerCase().includes(q),
    );
  }, [query, systems]);

  // Right-pane preview target: hovered system → hovered "none" → selected.
  const hoveredSystem =
    hoveredId && hoveredId !== 'none'
      ? systems.find((s) => s.id === hoveredId)
      : undefined;
  const previewSystem =
    hoveredSystem ?? (hoveredId === 'none' ? undefined : selected);
  const previewNone = hoveredId === 'none' || (!hoveredSystem && !selected);

  const switchSystem = async (designSystemId: string | null) => {
    if (designSystemId === project.designSystemId) {
      setOpen(false);
      return;
    }
    setSavingId(designSystemId ?? '__default__');
    setError('');
    try {
      const { project: next } = await updateDesignProject(project.id, {
        designSystemId,
        inspirationDesignSystemIds: project.inspirationDesignSystemIds.filter(
          (id) => id !== designSystemId,
        ),
      });
      onProjectChange(next);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  };

  const triggerLabel =
    selected?.title ?? project.designSystemId ?? t.design.designSystemDefault;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t.design.designSystem}
          className="bg-muted hover:bg-accent flex max-w-56 items-center gap-2 rounded px-2 py-1 text-xs"
        >
          <Swatches colors={selected?.swatches ?? []} />
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronsUpDown className="text-muted-foreground size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        sideOffset={8}
        className="bg-popover text-popover-foreground z-50 flex w-[600px] max-w-[90vw] gap-3 rounded-md border p-3 shadow-md"
        onMouseLeave={() => setHoveredId(null)}
      >
        <div className="flex w-[260px] shrink-0 flex-col">
          <div className="border-input flex h-9 items-center gap-2 rounded-md border px-2">
            <Search className="text-muted-foreground size-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.design.searchSystems}
              aria-label={t.design.searchSystems}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
          <div
            role="listbox"
            className="mt-2 max-h-72 space-y-1 overflow-y-auto"
          >
            <SwitchRow
              active={!project.designSystemId}
              disabled={Boolean(savingId)}
              loading={savingId === '__default__'}
              title={t.design.designSystemDefault}
              summary={t.design.designSystem}
              swatches={[]}
              onClick={() => void switchSystem(null)}
              onHover={() => setHoveredId('none')}
            />
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t.common.loading}
              </div>
            ) : (
              filtered.map((system) => (
                <SwitchRow
                  key={system.id}
                  active={project.designSystemId === system.id}
                  disabled={Boolean(savingId)}
                  loading={savingId === system.id}
                  title={system.title}
                  summary={system.summary}
                  swatches={system.swatches}
                  onClick={() => void switchSystem(system.id)}
                  onHover={() => setHoveredId(system.id)}
                />
              ))
            )}
          </div>
          {project.designSystemId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start"
              disabled={Boolean(savingId)}
              onClick={() => void switchSystem(null)}
            >
              <X className="size-4" />
              {t.design.clearSelection}
            </Button>
          )}
        </div>
        <div className="border-border min-w-0 flex-1 overflow-hidden rounded-md border">
          {previewSystem ? (
            <div className="flex h-full flex-col">
              <DesignSystemComponentsPreview system={previewSystem} />
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                <div className="text-sm font-semibold">
                  {previewSystem.title}
                </div>
                <Swatches colors={previewSystem.swatches} />
                <p className="text-muted-foreground text-xs leading-5">
                  {previewSystem.summary}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs">
              {previewNone
                ? t.design.noDesignSystemSummary
                : t.design.searchSystems}
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

function SwitchRow({
  active,
  disabled,
  loading,
  title,
  summary,
  swatches,
  onClick,
  onHover,
}: {
  active: boolean;
  disabled: boolean;
  loading: boolean;
  title: string;
  summary: string;
  swatches: string[];
  onClick: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={disabled}
      className={cn(
        'hover:bg-accent flex w-full items-center gap-3 rounded-md p-2 text-left disabled:opacity-60',
        active && 'bg-accent',
      )}
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      <Swatches colors={swatches} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {summary}
        </span>
      </span>
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        active && <Check className="size-4" />
      )}
    </button>
  );
}
