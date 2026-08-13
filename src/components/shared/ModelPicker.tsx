/**
 * ModelPicker — shared model selector dropdown.
 *
 * Extracted from ChatInput so it can be reused in ChannelSettings
 * and anywhere else a model needs to be chosen.
 */

import { useDeferredValue, useMemo, useState } from 'react';

import { Check, ChevronDown } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { RuntimeMode } from '@/shared/lib/runtime-model-ids';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getModelShortLabel, type ModelOption } from './ChatInput.types';
import {
  groupModelOptionsByAgent,
  modelMetadataLabel,
} from './runtime-model-catalog';
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
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
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

  const matchesQuery = (model: ModelOption) => {
    if (!deferredQuery) return true;
    return [model.id, model.label, model.description, model.provider]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(deferredQuery));
  };

  const filteredOptions = useMemo(
    () => modelOptions.filter(matchesQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelOptions, deferredQuery],
  );

  const showDefaultOption =
    showDefault &&
    (!deferredQuery ||
      [defaultLabel, t.settings.modelPickerDefaultDescription]
        .join(' ')
        .toLowerCase()
        .includes(deferredQuery));

  const selectModel = (modelId: string | null) => {
    onChange(modelId);
    setOpen(false);
    setQuery('');
  };

  const renderItem = (model: ModelOption) => (
    <CommandItem
      key={model.id}
      value={`${model.id} ${model.label} ${model.description}`}
      disabled={model.disabled}
      onSelect={() => {
        if (!model.disabled) selectModel(model.id);
      }}
      className={cn(
        'gap-2 py-2',
        model.disabled ? 'opacity-60' : 'cursor-pointer',
      )}
    >
      <Check
        className={cn(
          'size-3.5 shrink-0',
          activeModelId === model.id ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{model.label}</span>
        {(model.disabledReason ||
          modelMetadataLabel(model) ||
          model.description) && (
          <span className="text-muted-foreground text-xs">
            {model.disabledReason ||
              modelMetadataLabel(model) ||
              model.description}
          </span>
        )}
      </div>
    </CommandItem>
  );

  // Agent-first groups shared with the composer selector so the two
  // surfaces cannot drift.
  const groups = groupModelOptionsByAgent(filteredOptions, {
    claude: t.settings.modelPickerGroupClaude,
    codex: t.settings.modelPickerGroupCodex,
    other: t.settings.modelPickerGroupOther,
  });
  const hasOptions = showDefaultOption || groups.length > 0;

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
        className="z-50 w-80 p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t.settings.modelPickerSearchPlaceholder}
          />
          <CommandList>
            {!hasOptions && (
              <CommandEmpty>{t.settings.modelPickerNoResults}</CommandEmpty>
            )}
            {showDefaultOption && (
              <>
                <CommandItem
                  value={`${defaultLabel} ${t.settings.modelPickerDefaultDescription}`}
                  onSelect={() => selectModel(null)}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Check
                    className={cn(
                      'size-3.5 shrink-0',
                      !activeModelId ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{defaultLabel}</span>
                    <span className="text-muted-foreground text-xs">
                      {t.settings.modelPickerDefaultDescription}
                    </span>
                  </div>
                </CommandItem>
                {groups.length > 0 && <CommandSeparator />}
              </>
            )}

            {groups.map((group, index) => (
              <div key={group.provider}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group.label}>
                  {group.options.map(renderItem)}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
