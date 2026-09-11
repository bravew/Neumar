/**
 * Model selector dropdown for ChatInput.
 *
 * Renders one icon-bearing group per agent: Claude, Codex, each detected
 * local CLI runtime (Cursor Agent, Qwen Code, GitHub Copilot CLI), then any
 * other configured API providers. Group order and membership come from the
 * options' `provider` ids so the shared catalog stays the single source of
 * truth.
 */

import { useState, type RefObject } from 'react';

import { ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { ModelOption } from './ChatInput.types';
import { ModelSearchMenu } from './ModelSearchMenu';

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
  const [open, setOpen] = useState(false);

  const groupLabels = {
    claude: t.home.modelGroupClaude,
    codex: t.home.modelGroupCodex,
    other: t.home.modelGroupOtherProviders,
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
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
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-50 h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-hidden p-0"
      >
        <ModelSearchMenu
          fillHeight
          options={modelOptions}
          activeModelId={activeModelId}
          onSelect={(modelId) => {
            if (modelId) onModelChange(modelId);
            setOpen(false);
          }}
          groupLabels={groupLabels}
          searchPlaceholder={t.settings.modelPickerSearchPlaceholder}
          emptyLabel={t.settings.modelPickerNoResults}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
