/**
 * ModelPicker — shared model selector dropdown.
 *
 * Extracted from ChatInput so it can be reused in ChannelSettings
 * and anywhere else a model needs to be chosen.
 */

import { useMemo, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { RuntimeMode } from '@/shared/lib/runtime-model-ids';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getModelShortLabel, type ModelOption } from './ChatInput.types';
import { ModelSearchMenu } from './ModelSearchMenu';
import { useModelOptions } from './useModelOptions';

export {
  buildModelOptions,
  DEFAULT_MODEL_ID,
  getModelShortLabel,
} from './ChatInput.types';
export type { ModelOption } from './ChatInput.types';

// ── Component ──────────────────────────────────────────────────────────────────

export interface ModelPickerProps {
  /** Currently selected model ID. Null/undefined means use platform default. */
  value: string | null | undefined;
  onChange: (modelId: string | null) => void;
  /** Whether to show a "Default" option to clear the model override. */
  showDefault?: boolean;
  /** Label shown for the default option */
  defaultLabel?: string;
  /** Restrict which providers are shown. Omit to show all. */
  allowedProviders?: ModelOption['provider'][];
  /** Mode capability gate for the catalog. Defaults to 'task'. */
  mode?: RuntimeMode;
  disabled?: boolean;
  className?: string;
}

export function ModelPicker({
  value,
  onChange,
  showDefault = false,
  defaultLabel = 'Default',
  allowedProviders,
  mode = 'task',
  disabled = false,
  className,
}: ModelPickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const allOptions = useModelOptions(mode);
  const providerKey = allowedProviders?.join(',') ?? '';

  const modelOptions = useMemo(() => {
    return allowedProviders
      ? allOptions.filter((m) => allowedProviders.includes(m.provider))
      : allOptions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOptions, providerKey]);

  const activeModelId = value ?? null;
  const activeLabel = activeModelId
    ? (modelOptions.find((m) => m.id === activeModelId)?.label ??
      getModelShortLabel(activeModelId))
    : defaultLabel;

  const groupLabels = {
    claude: t.settings.modelPickerGroupClaude,
    codex: t.settings.modelPickerGroupCodex,
    other: t.settings.modelPickerGroupOther,
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'border-input bg-background text-foreground flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm focus:outline-none disabled:opacity-50',
          !activeModelId && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate font-medium">{activeLabel}</span>
        <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="z-50 w-80 overflow-hidden p-0"
      >
        <ModelSearchMenu
          options={modelOptions}
          activeModelId={activeModelId}
          onSelect={(modelId) => {
            onChange(modelId);
            setOpen(false);
          }}
          showDefault={showDefault}
          defaultLabel={defaultLabel}
          defaultDescription={t.settings.modelPickerDefaultDescription}
          groupLabels={groupLabels}
          searchPlaceholder={t.settings.modelPickerSearchPlaceholder}
          emptyLabel={t.settings.modelPickerNoResults}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
