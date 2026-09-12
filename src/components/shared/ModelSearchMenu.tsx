/**
 * ModelSearchMenu — searchable, agent-grouped model list.
 *
 * Shared by the composer selector (`ChatInputModelSelector`) and the settings
 * `ModelPicker` so the two surfaces cannot drift. Callers own the trigger and
 * the dropdown shell; this component owns the query, the filtering and the
 * grouped rows.
 *
 * Filtering is plain case-insensitive substring matching over the fields the
 * row actually shows, not cmdk's fuzzy scorer: the catalog carries hundreds of
 * runtime models, and subsequence matching floats unrelated rows above the
 * real hits (`deepseek` matching "Claude Opus 5 Medium Thinking"). Whitespace
 * separates terms, and every term must match.
 */

import { useDeferredValue, useMemo, useState } from 'react';

import { Check } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { cn } from '@/shared/lib/utils';

import { AgentRuntimeIcon } from './AgentRuntimeIcon';
import type { ModelOption } from './ChatInput.types';
import {
  groupModelOptionsByAgent,
  modelMetadataLabel,
} from './runtime-model-catalog';

export interface ModelSearchMenuProps {
  options: readonly ModelOption[];
  activeModelId: string | null;
  /** Null is only passed when a default row is shown. */
  onSelect: (modelId: string | null) => void;
  /** Show a row that clears the model override. */
  showDefault?: boolean;
  /** Required (and must be localized) when `showDefault` is true. */
  defaultLabel?: string;
  defaultDescription?: string;
  groupLabels: { claude: string; codex: string; other: string };
  searchPlaceholder: string;
  emptyLabel: string;
  /** Stretch the list to the shell height instead of capping it at 300px. */
  fillHeight?: boolean;
  autoFocus?: boolean;
  listClassName?: string;
}

/** All searchable text for one row, lowercased. */
export function modelSearchText(model: ModelOption): string {
  return [
    model.id,
    model.label,
    model.description,
    model.provider,
    modelMetadataLabel(model),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesAllTokens(
  haystack: string,
  tokens: readonly string[],
): boolean {
  return tokens.every((token) => haystack.includes(token));
}

export function ModelSearchMenu({
  options,
  activeModelId,
  onSelect,
  showDefault = false,
  defaultLabel,
  defaultDescription,
  groupLabels,
  searchPlaceholder,
  emptyLabel,
  fillHeight = false,
  autoFocus = true,
  listClassName,
}: ModelSearchMenuProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredOptions = useMemo(() => {
    const tokens = deferredQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [...options];
    return options.filter((model) =>
      matchesAllTokens(modelSearchText(model), tokens),
    );
  }, [options, deferredQuery]);

  const groups = useMemo(
    () => groupModelOptionsByAgent(filteredOptions, groupLabels),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels are plain strings
    [filteredOptions, groupLabels.claude, groupLabels.codex, groupLabels.other],
  );

  const showDefaultRow =
    showDefault &&
    matchesAllTokens(
      `${defaultLabel} ${defaultDescription ?? ''}`.toLowerCase(),
      deferredQuery.split(/\s+/).filter(Boolean),
    );
  const hasRows = showDefaultRow || groups.length > 0;

  return (
    // Keep menu key handling (cmdk) working while shielding the surrounding
    // Radix menu, which would otherwise claim arrow keys for its own items.
    <div className="h-full" onKeyDown={(event) => event.stopPropagation()}>
      <Command shouldFilter={false} label={searchPlaceholder}>
        <CommandInput
          autoFocus={autoFocus}
          value={query}
          onValueChange={setQuery}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
        <CommandList
          className={cn(fillHeight && 'max-h-none flex-1', listClassName)}
        >
          {!hasRows && <CommandEmpty>{emptyLabel}</CommandEmpty>}

          {showDefaultRow && (
            <>
              <CommandItem
                value={`${defaultLabel} ${defaultDescription ?? ''}`}
                onSelect={() => onSelect(null)}
                className="cursor-pointer gap-2 py-2"
              >
                <Check
                  className={cn(
                    'size-3.5 shrink-0',
                    activeModelId === null ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {defaultLabel}
                  </div>
                  {defaultDescription && (
                    <div className="text-muted-foreground truncate text-xs">
                      {defaultDescription}
                    </div>
                  )}
                </div>
              </CommandItem>
              {groups.length > 0 && <CommandSeparator />}
            </>
          )}

          {groups.map((group, index) => (
            <div key={group.provider}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1.5 tracking-wide uppercase">
                    {group.provider !== 'other' && (
                      <AgentRuntimeIcon
                        runtimeId={group.provider}
                        className="size-3.5"
                      />
                    )}
                    {group.label}
                  </span>
                }
              >
                {group.options.map((model) => {
                  const detail = [
                    model.description,
                    model.disabledReason || modelMetadataLabel(model),
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <CommandItem
                      key={model.id}
                      value={modelSearchText(model)}
                      disabled={model.disabled}
                      onSelect={() => {
                        if (!model.disabled) onSelect(model.id);
                      }}
                      className={cn(
                        'gap-2 py-2',
                        model.disabled ? 'opacity-60' : 'cursor-pointer',
                      )}
                    >
                      <Check
                        className={cn(
                          'size-3.5 shrink-0',
                          activeModelId === model.id
                            ? 'opacity-100'
                            : 'opacity-0',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {model.label}
                        </div>
                        {detail && (
                          <div className="text-muted-foreground truncate text-xs">
                            {detail}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}
