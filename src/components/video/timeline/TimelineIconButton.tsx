import type { MouseEvent, ReactNode } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

interface TimelineIconButtonProps {
  label: string;
  shortcut?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}

export function TimelineIconButton({
  label,
  shortcut,
  onClick,
  disabled = false,
  pressed = false,
  children,
}: TimelineIconButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'border-border hover:bg-accent rounded-md border p-1.5',
              pressed && 'bg-accent text-accent-foreground',
              disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
            )}
            title={title}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span>{label}</span>
          {shortcut ? (
            <kbd className="ml-2 rounded bg-white/15 px-1 py-0.5 font-mono text-[10px]">
              {shortcut}
            </kbd>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
