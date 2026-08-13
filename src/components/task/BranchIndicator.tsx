import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { GitBranch, Plus } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface BranchInfo {
  branchId: string;
  messageCount: number;
}

interface BranchIndicatorProps {
  branchCount: number;
  branches: BranchInfo[];
  onBranchFrom: () => void;
  onSelectBranch: (branchId: string) => void;
}

export function BranchIndicator({
  branchCount,
  branches,
  onBranchFrom,
  onSelectBranch,
}: BranchIndicatorProps) {
  const { t } = useLanguage();
  const branchUnit =
    branchCount !== 1
      ? (t.task.branchPlural ?? 'branches')
      : (t.task.branchSingular ?? 'branch');
  const fromPointLabel = `${branchCount} ${branchUnit} ${t.task.branchFromPoint ?? 'from this point'}`;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'text-muted-foreground hover:text-primary flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors',
            'hover:bg-primary/10',
          )}
          title={fromPointLabel}
          aria-label={fromPointLabel}
        >
          <GitBranch className="size-3.5" />
          <span>{branchCount}</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            'bg-popover text-popover-foreground border-border z-50 min-w-[180px] rounded-lg border p-1 shadow-md',
            'animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2',
          )}
          sideOffset={4}
        >
          <DropdownMenu.Label className="text-muted-foreground px-2 py-1 text-xs font-semibold">
            {fromPointLabel}
          </DropdownMenu.Label>

          <DropdownMenu.Separator className="bg-border my-1 h-px" />

          {branches.map((b, i) => (
            <DropdownMenu.Item
              key={b.branchId}
              onSelect={() => onSelectBranch(b.branchId)}
              className={cn(
                'hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
              )}
            >
              <GitBranch className="text-muted-foreground size-3.5 shrink-0" />
              <span className="flex-1">
                {(t.task.branchLabel ?? 'Branch {n}').replace(
                  '{n}',
                  String(i + 1),
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {b.messageCount}{' '}
                {b.messageCount !== 1
                  ? (t.task.branchMsgPlural ?? 'msgs')
                  : (t.task.branchMsgSingular ?? 'msg')}
              </span>
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Separator className="bg-border my-1 h-px" />

          <DropdownMenu.Item
            onSelect={onBranchFrom}
            className={cn(
              'text-primary hover:bg-primary/10 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
            )}
          >
            <Plus className="size-3.5 shrink-0" />
            {t.task.branchFrom}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
