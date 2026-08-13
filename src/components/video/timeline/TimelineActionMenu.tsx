import type { LucideIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

export interface TimelineActionMenuPoint {
  x: number;
  y: number;
}

export interface TimelineActionMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void | Promise<void>;
}

interface TimelineActionMenuProps {
  label: string;
  point: TimelineActionMenuPoint | null;
  items: TimelineActionMenuItem[];
  onClose: () => void;
}

export function TimelineActionMenu({
  label,
  point,
  items,
  onClose,
}: TimelineActionMenuProps) {
  if (!point) return null;
  return (
    <DropdownMenu
      modal={false}
      open
      onOpenChange={(open) => !open && onClose()}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="fixed z-50 size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" sideOffset={4}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.id}
              disabled={item.disabled}
              className={cn(
                'cursor-pointer',
                item.danger && 'text-destructive focus:text-destructive',
              )}
              onSelect={() => void item.onSelect()}
            >
              {Icon ? <Icon className="size-4" /> : null}
              <span>{item.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
