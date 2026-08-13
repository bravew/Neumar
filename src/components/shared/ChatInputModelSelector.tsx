/**
 * Model selector dropdown for ChatInput.
 *
 * Renders one icon-bearing group per agent: Claude, Codex, each detected
 * local CLI runtime (Cursor Agent, Qwen Code, GitHub Copilot CLI), then any
 * other configured API providers. Group order and membership come from the
 * options' `provider` ids so the shared catalog stays the single source of
 * truth.
 */

import type { RefObject } from 'react';

import { Check, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { AgentRuntimeIcon } from './AgentRuntimeIcon';
import type { ModelOption } from './ChatInput.types';
import {
  groupModelOptionsByAgent,
  modelMetadataLabel,
} from './runtime-model-catalog';

export interface ModelSelectorProps {
  modelOptions: ModelOption[];
  activeModelId: string;
  activeModelLabel: string;
  onModelChange: (modelId: string) => void;
  isRunning: boolean;
  disabled: boolean;
  isHome: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function ModelSelector({
  modelOptions,
  activeModelId,
  activeModelLabel,
  onModelChange,
  isRunning,
  disabled,
  isHome,
  triggerRef,
}: ModelSelectorProps) {
  const { t } = useLanguage();
  const groups = groupModelOptionsByAgent(modelOptions, {
    claude: t.home.modelGroupClaude,
    codex: t.home.modelGroupCodex,
    other: t.home.modelGroupOtherProviders,
  });

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        ref={triggerRef}
        disabled={isRunning || disabled}
        className={cn(
          'flex min-w-0 items-center gap-1 transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          isHome
            ? 'border-border/60 text-muted-foreground hover:text-foreground rounded-full border px-2.5 py-1 text-xs'
            : 'text-muted-foreground hover:text-foreground rounded-md px-1.5 py-1 text-xs',
        )}
        aria-label={`Selected model: ${activeModelLabel}`}
      >
        <span
          className="block max-w-40 truncate font-medium"
          title={activeModelLabel}
        >
          {activeModelLabel}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="z-50 w-56">
        {groups.map((group, index) => (
          <div key={group.provider}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase opacity-60">
              {group.provider !== 'other' && (
                <AgentRuntimeIcon
                  runtimeId={group.provider}
                  className="size-3.5"
                />
              )}
              {group.label}
            </DropdownMenuLabel>
            {group.options.map((model) => (
              <DropdownMenuItem
                key={model.id}
                disabled={model.disabled}
                onSelect={() => {
                  if (!model.disabled) onModelChange(model.id);
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
                  <span className="text-muted-foreground text-xs">
                    {model.disabledReason ||
                      modelMetadataLabel(model) ||
                      model.description}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
