import { AlertTriangle, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/shared/providers/language-provider';
import { useVideoEngines } from '@/shared/video/useVideoEngines';

import { EngineOptionRow } from './EngineOptionRow';
import { EngineSetupPrompt } from './EngineSetupPrompt';

interface EnginePickerProps {
  engineId?: string;
  label?: string;
  /** Omit for a read-only presentation of the active engine. */
  onSelect?: (engineId: string) => void;
}

/**
 * Runtime-selection contract (P2-6): with `remotion`, `html`, and
 * `hyperframes` all real, the picker presents every candidate with its honest
 * tradeoffs. An unavailable engine stays visible and selectable-to-inspect —
 * choosing it opens the setup prompt rather than quietly falling back to
 * another engine.
 */
export function EnginePicker({
  engineId = 'html',
  label,
  onSelect,
}: EnginePickerProps) {
  const { t } = useLanguage();
  const e = t.video.engines;
  const resolvedLabel = label ?? e.label;
  const { engines, loading, error, refresh } = useVideoEngines();
  const active =
    engines.find((engine) => engine.id === engineId) ?? engines[0] ?? null;

  return (
    <div className="space-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="border-border text-foreground hover:bg-muted flex items-center gap-1 rounded border px-2 py-1 text-xs"
            aria-label={resolvedLabel}
            data-testid="engine-picker"
          >
            <span className="font-medium">{resolvedLabel}:</span>
            <span>{active?.name ?? engineId}</span>
            {active && !active.installed ? (
              <AlertTriangle className="text-destructive size-3" />
            ) : null}
            <ChevronDown className="text-muted-foreground size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-sm">
          <DropdownMenuLabel className="text-[11px]">
            {e.pickerHint}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <DropdownMenuItem disabled className="text-xs">
              {e.loading}
            </DropdownMenuItem>
          ) : error ? (
            <DropdownMenuItem disabled className="text-xs">
              {e.loadError.replace('{error}', error)}
            </DropdownMenuItem>
          ) : engines.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs">
              {e.none}
            </DropdownMenuItem>
          ) : (
            engines.map((engine) => (
              <DropdownMenuItem
                key={engine.id}
                className="flex-col items-start gap-0.5 text-xs"
                onSelect={() => onSelect?.(engine.id)}
              >
                <EngineOptionRow
                  engine={engine}
                  active={engine.id === active?.id}
                  unavailableLabel={e.unavailable}
                />
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {active && !active.installed ? (
        <EngineSetupPrompt engine={active} onRecheck={refresh} />
      ) : null}
    </div>
  );
}
